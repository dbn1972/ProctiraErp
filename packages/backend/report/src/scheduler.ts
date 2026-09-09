import type { ScheduleCadence } from './report-store.js';

export interface ScheduleTicker {
  tickDueSchedules(now: Date): Promise<{ due: number; completed: number; failed: number }>;
}

export function computeNextRunAt(cadence: ScheduleCadence, from: Date): Date {
  const next = new Date(from.getTime());
  if (cadence === 'daily') {
    next.setUTCDate(next.getUTCDate() + 1);
  } else if (cadence === 'weekly') {
    next.setUTCDate(next.getUTCDate() + 7);
  } else {
    const day = next.getUTCDate();
    next.setUTCMonth(next.getUTCMonth() + 1);
    if (next.getUTCDate() < day) {
      next.setUTCDate(0);
    }
  }
  return next;
}

export interface ReportSchedulerLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface ReportSchedulerOptions {
  service: ScheduleTicker;
  intervalMs?: number;
  initialDelayMs?: number;
  logger?: ReportSchedulerLogger;
}

export interface ReportScheduler {
  start(): void;
  stop(): void;
  runOnce(now?: Date): Promise<{ due: number; completed: number; failed: number }>;
  readonly running: boolean;
}

export const DEFAULT_REPORT_SCHEDULER_INTERVAL_MS = 60_000;

export function createReportScheduler(options: ReportSchedulerOptions): ReportScheduler {
  const intervalMs = Math.max(1000, options.intervalMs ?? DEFAULT_REPORT_SCHEDULER_INTERVAL_MS);
  const initialDelayMs = Math.max(0, options.initialDelayMs ?? intervalMs);
  let timer: NodeJS.Timeout | null = null;
  let inFlight = false;

  const runOnce = async (now = new Date()) => {
    if (inFlight) return { due: 0, completed: 0, failed: 0 };
    inFlight = true;
    try {
      const result = await options.service.tickDueSchedules(now);
      if (result.due > 0) {
        options.logger?.info(result, 'report scheduler tick');
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
          options.logger?.error(
            { error: error instanceof Error ? error.message : String(error) },
            'report scheduler tick failed',
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
      options.logger?.info({ intervalMs, initialDelayMs }, 'report scheduler started');
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
  };
}
