/**
 * Runtime retention enforcement (G-913).
 *
 * Before this the per-tenant retention config was stored but only acted on
 * when someone called `POST /audit-logs/archival/execute`. The scheduler runs
 * `AuditService.runRetentionSweep()` on an interval so configured retention is
 * actually applied. The gateway starts it once per process and stops it on
 * close; tests drive `runOnce()` directly.
 */
import type { AuditService } from './audit-service.js';

export interface RetentionSchedulerLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface RetentionSchedulerOptions {
  service: AuditService;
  /** Sweep interval; default 6h. Minimum 1s (tests). */
  intervalMs?: number;
  /** Delay before the first sweep; default = intervalMs. */
  initialDelayMs?: number;
  logger?: RetentionSchedulerLogger;
}

export interface RetentionScheduler {
  start(): void;
  stop(): void;
  runOnce(): Promise<Awaited<ReturnType<AuditService['runRetentionSweep']>>>;
  readonly running: boolean;
  readonly lastRun: { at: string; tenants: number; archived: number; failures: number } | null;
}

export const DEFAULT_RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function createRetentionScheduler(options: RetentionSchedulerOptions): RetentionScheduler {
  const intervalMs = Math.max(1000, options.intervalMs ?? DEFAULT_RETENTION_INTERVAL_MS);
  const initialDelayMs = Math.max(0, options.initialDelayMs ?? intervalMs);
  const logger = options.logger;
  let timer: NodeJS.Timeout | null = null;
  let inFlight = false;
  let lastRun: RetentionScheduler['lastRun'] = null;

  const runOnce = async () => {
    if (inFlight) {
      return { tenants: 0, archived: 0, failures: [] };
    }
    inFlight = true;
    try {
      const result = await options.service.runRetentionSweep();
      lastRun = {
        at: new Date().toISOString(),
        tenants: result.tenants,
        archived: result.archived,
        failures: result.failures.length,
      };
      if (result.failures.length > 0) {
        logger?.error({ ...lastRun, failures: result.failures }, 'audit retention sweep had failures');
      } else if (result.tenants > 0) {
        logger?.info(lastRun, 'audit retention sweep complete');
      }
      return result;
    } finally {
      inFlight = false;
    }
  };

  const schedule = (delay: number) => {
    timer = setTimeout(() => {
      void runOnce()
        .catch((error) => {
          logger?.error(
            { error: error instanceof Error ? error.message : String(error) },
            'audit retention sweep failed',
          );
        })
        .finally(() => {
          if (timer) schedule(intervalMs);
        });
    }, delay);
    timer.unref?.();
  };

  return {
    start() {
      if (timer) return;
      schedule(initialDelayMs);
      logger?.info({ intervalMs, initialDelayMs }, 'audit retention scheduler started');
    },
    stop() {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
    },
    runOnce,
    get running() {
      return timer !== null;
    },
    get lastRun() {
      return lastRun;
    },
  };
}
