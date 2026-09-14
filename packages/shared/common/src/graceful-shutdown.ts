/**
 * W1-ARCH-07 — ordered process graceful shutdown.
 *
 * Coordinates SIGINT/SIGTERM: run named close steps in order, enforce a
 * wall-clock timeout, and force-exit on a second signal. Entry points compose
 * steps (HTTP drain → queues/timers via Fastify onClose → DB pools → tracing)
 * rather than inventing a second lifecycle framework.
 */

export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 15_000;

export type ShutdownStep = {
  /** Stable name for logs / tests. */
  name: string;
  close: () => void | Promise<void>;
};

export type GracefulShutdownLogger = {
  info?: (obj: Record<string, unknown>, msg: string) => void;
  error?: (obj: Record<string, unknown>, msg: string) => void;
  warn?: (obj: Record<string, unknown>, msg: string) => void;
};

export type RegisterGracefulShutdownOptions = {
  steps: ShutdownStep[];
  /** Override timeout (default SHUTDOWN_TIMEOUT_MS env or 15s). */
  timeoutMs?: number;
  signals?: NodeJS.Signals[];
  logger?: GracefulShutdownLogger;
  /** Injected for tests (default process.exit). */
  exit?: (code: number) => void;
  /** Injected for tests (default process). */
  processRef?: NodeJS.Process;
};

export type GracefulShutdownHandle = {
  /** True after the first signal starts the close sequence. */
  readonly shuttingDown: boolean;
  /** Run the same close path without a signal (tests / programmatic stop). */
  shutdown: (reason?: string) => Promise<void>;
  /** Remove signal listeners registered by this handle. */
  unregister: () => void;
};

type ShutdownEnv = Record<string, string | undefined>;

/** Resolve wall-clock shutdown budget from env (bounded 1s..5m). */
export function resolveShutdownTimeoutMs(
  env: ShutdownEnv = process.env,
  override?: number,
): number {
  if (typeof override === 'number' && Number.isFinite(override) && override > 0) {
    return Math.min(Math.max(Math.floor(override), 1_000), 300_000);
  }
  const raw = env['SHUTDOWN_TIMEOUT_MS']?.trim();
  if (!raw) return DEFAULT_SHUTDOWN_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1_000) return DEFAULT_SHUTDOWN_TIMEOUT_MS;
  return Math.min(parsed, 300_000);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Shutdown timed out after ${ms}ms (${label})`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Run close steps in order. Continues after individual step failures so later
 * resources (DB / tracing) still attempt cleanup. Throws if the overall budget
 * is exceeded.
 */
export async function runShutdownSteps(
  steps: ShutdownStep[],
  options: {
    timeoutMs?: number;
    logger?: GracefulShutdownLogger;
    reason?: string;
    env?: ShutdownEnv;
  } = {},
): Promise<void> {
  const timeoutMs = resolveShutdownTimeoutMs(options.env, options.timeoutMs);
  const logger = options.logger;
  const reason = options.reason ?? 'shutdown';

  logger?.info?.({ reason, timeoutMs, stepCount: steps.length }, 'graceful shutdown started');

  const runAll = async () => {
    for (const step of steps) {
      const started = Date.now();
      try {
        await step.close();
        logger?.info?.(
          { step: step.name, durationMs: Date.now() - started },
          'shutdown step completed',
        );
      } catch (err) {
        logger?.error?.(
          {
            step: step.name,
            durationMs: Date.now() - started,
            err: err instanceof Error ? err.message : String(err),
          },
          'shutdown step failed',
        );
      }
    }
  };

  await withTimeout(runAll(), timeoutMs, reason);
  logger?.info?.({ reason }, 'graceful shutdown completed');
}

/**
 * Register SIGINT/SIGTERM handlers that run ordered close steps then exit.
 * A second signal during shutdown forces immediate exit(1).
 */
export function registerGracefulShutdown(
  options: RegisterGracefulShutdownOptions,
): GracefulShutdownHandle {
  const proc = options.processRef ?? process;
  const exitFn = options.exit ?? ((code: number) => proc.exit(code));
  const signals = options.signals ?? (['SIGINT', 'SIGTERM'] as NodeJS.Signals[]);
  const timeoutMs = resolveShutdownTimeoutMs(undefined, options.timeoutMs);

  let shuttingDown = false;
  let forceExitRequested = false;
  const listeners = new Map<NodeJS.Signals, () => void>();

  const finish = async (reason: string): Promise<void> => {
    if (shuttingDown) {
      if (!forceExitRequested) {
        forceExitRequested = true;
        options.logger?.warn?.(
          { reason },
          'second shutdown signal — forcing exit',
        );
        exitFn(1);
      }
      return;
    }
    shuttingDown = true;

    try {
      await runShutdownSteps(options.steps, {
        timeoutMs,
        logger: options.logger,
        reason,
      });
      exitFn(0);
    } catch (err) {
      options.logger?.error?.(
        {
          reason,
          err: err instanceof Error ? err.message : String(err),
        },
        'graceful shutdown failed',
      );
      exitFn(1);
    }
  };

  for (const signal of signals) {
    const listener = () => {
      void finish(signal);
    };
    listeners.set(signal, listener);
    proc.on(signal, listener);
  }

  return {
    get shuttingDown() {
      return shuttingDown;
    },
    shutdown: (reason = 'manual') => finish(reason),
    unregister: () => {
      for (const [signal, listener] of listeners) {
        proc.off(signal, listener);
      }
      listeners.clear();
    },
  };
}
