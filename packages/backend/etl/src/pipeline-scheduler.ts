/**
 * Pipeline Scheduler
 *
 * Manages scheduled execution of ETL pipelines using cron expressions.
 * Supports hourly, daily, weekly, and custom cron schedules.
 */

export interface ScheduleEntry {
  pipelineId: string;
  tenantId: string;
  cronExpression: string;
  enabled: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
}

export interface SchedulerConfig {
  /** Interval in ms to check for due pipelines (default: 60000 = 1 minute) */
  checkIntervalMs: number;
  /** Timezone for cron evaluation (default: 'UTC') */
  timezone: string;
  /** PRC-M226: max due pipelines started concurrently per tick (default 4). */
  maxConcurrentRuns: number;
  /** PRC-M226: receives tick / per-run errors (default: console.error). */
  onError?: (error: unknown, entry?: ScheduleEntry) => void;
}

/**
 * Parses a cron expression and determines if it matches a given date.
 * Supports standard 5-field cron: minute hour day-of-month month day-of-week
 *
 * Predefined schedules:
 * - '@hourly'  → '0 * * * *'
 * - '@daily'   → '0 0 * * *'
 * - '@weekly'  → '0 0 * * 0'
 */
export function normalizeCronExpression(expression: string): string {
  const aliases: Record<string, string> = {
    '@hourly': '0 * * * *',
    '@daily': '0 0 * * *',
    '@weekly': '0 0 * * 0',
    '@monthly': '0 0 1 * *',
    '@yearly': '0 0 1 1 *',
  };

  return aliases[expression.toLowerCase()] ?? expression;
}

/**
 * PRC-M228: a parsed 5-field cron expression. Each field is the explicit set of
 * allowed values; `domRestricted` / `dowRestricted` follow Vixie cron: when both
 * day fields are restricted (do not start with `*`) a date matches if EITHER
 * matches; otherwise both must match.
 */
export interface ParsedCron {
  minutes: ReadonlySet<number>;
  hours: ReadonlySet<number>;
  daysOfMonth: ReadonlySet<number>;
  months: ReadonlySet<number>;
  daysOfWeek: ReadonlySet<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
}

const FIELD_BOUNDS: ReadonlyArray<readonly [number, number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 7], // day of week (0 and 7 = Sunday)
];

/**
 * Parse one cron field into its value set. Supports `*`, `n`, `n-m`, and an
 * optional `/step` on `*`, `n` (= n-max) or `n-m`, combined with commas.
 * Returns null for anything out of range or malformed.
 */
export function parseCronField(field: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>();
  for (const item of field.split(',')) {
    const m = /^(\*|(\d{1,2})(?:-(\d{1,2}))?)(?:\/(\d{1,2}))?$/.exec(item);
    if (!m) return null;
    let lo: number;
    let hi: number;
    if (m[1] === '*') {
      lo = min;
      hi = max;
    } else {
      lo = Number(m[2]);
      // `n/s` means n..max stepping by s; plain `n` is a single value.
      hi = m[3] !== undefined ? Number(m[3]) : m[4] !== undefined ? max : lo;
    }
    const step = m[4] !== undefined ? Number(m[4]) : 1;
    if (lo < min || hi > max || lo > hi || step < 1) return null;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

const parsedCache = new Map<string, ParsedCron | null>();

/** Parse (and cache) a cron expression or alias; null when invalid. */
export function parseCronExpression(expression: string): ParsedCron | null {
  const normalized = normalizeCronExpression(expression.trim());
  if (parsedCache.has(normalized)) return parsedCache.get(normalized)!;
  const parts = normalized.split(/\s+/);
  let parsed: ParsedCron | null = null;
  if (parts.length === 5) {
    const sets = parts.map((part, i) => parseCronField(part, FIELD_BOUNDS[i]![0], FIELD_BOUNDS[i]![1]));
    if (sets.every((x) => x !== null)) {
      const dow = new Set<number>([...sets[4]!].map((d) => (d === 7 ? 0 : d)));
      parsed = {
        minutes: sets[0]!,
        hours: sets[1]!,
        daysOfMonth: sets[2]!,
        months: sets[3]!,
        daysOfWeek: dow,
        domRestricted: !parts[2]!.startsWith('*'),
        dowRestricted: !parts[4]!.startsWith('*'),
      };
    }
  }
  if (parsedCache.size > 1000) parsedCache.clear();
  parsedCache.set(normalized, parsed);
  return parsed;
}

/**
 * Validates a cron expression: a known alias or 5 fields whose values are all
 * within range (minute 0-59, hour 0-23, day 1-31, month 1-12, weekday 0-7).
 */
export function isValidCronExpression(expression: string): boolean {
  return parseCronExpression(expression) !== null;
}

/** Wall-clock fields of an instant in an IANA timezone. */
interface WallClock {
  minute: number;
  hour: number;
  day: number;
  month: number;
  weekday: number;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function wallClock(date: Date, timezone: string): WallClock {
  if (timezone === 'UTC') {
    return {
      minute: date.getUTCMinutes(),
      hour: date.getUTCHours(),
      day: date.getUTCDate(),
      month: date.getUTCMonth() + 1,
      weekday: date.getUTCDay(),
    };
  }
  let fmt = formatterCache.get(timezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      minute: 'numeric',
      hour: 'numeric',
      day: 'numeric',
      month: 'numeric',
      weekday: 'short',
    });
    formatterCache.set(timezone, fmt);
  }
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  return {
    minute: Number(parts['minute']),
    hour: Number(parts['hour']) % 24,
    day: Number(parts['day']),
    month: Number(parts['month']),
    weekday: WEEKDAYS[parts['weekday'] ?? ''] ?? -1,
  };
}

/** Throws a RangeError for an unknown IANA timezone. */
export function assertValidTimezone(timezone: string): void {
  if (timezone === 'UTC') return;
  new Intl.DateTimeFormat('en-US', { timeZone: timezone });
}

/**
 * Determines if a cron expression matches a given instant, evaluated in
 * `timezone` (IANA name, default UTC).
 */
export function cronMatchesDate(
  cronExpression: string,
  date: Date,
  timezone: string = 'UTC',
): boolean {
  const cron = parseCronExpression(cronExpression);
  if (!cron) return false;
  const t = wallClock(date, timezone);
  if (!cron.minutes.has(t.minute) || !cron.hours.has(t.hour) || !cron.months.has(t.month)) {
    return false;
  }
  const domOk = cron.daysOfMonth.has(t.day);
  const dowOk = cron.daysOfWeek.has(t.weekday);
  if (cron.domRestricted && cron.dowRestricted) return domOk || dowOk;
  return domOk && dowOk;
}

/**
 * Calculates the next run time for a cron expression after a given date.
 * Searches forward minute-by-minute (wall clock in `timezone`) up to 366 days.
 */
export function getNextRunTime(
  cronExpression: string,
  after: Date,
  timezone: string = 'UTC',
): Date | null {
  if (!parseCronExpression(cronExpression)) return null;
  const maxIterations = 366 * 24 * 60; // 1 year of minutes
  const candidate = new Date(after.getTime());
  // Start from the next minute
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);

  for (let i = 0; i < maxIterations; i++) {
    if (cronMatchesDate(cronExpression, candidate, timezone)) {
      return candidate;
    }
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }

  return null;
}

/**
 * Pipeline Scheduler manages the lifecycle of scheduled pipeline executions.
 * It tracks schedule entries and determines which pipelines are due for execution.
 */
export class PipelineScheduler {
  private schedules: Map<string, ScheduleEntry> = new Map();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly config: SchedulerConfig;
  private onDueCallback: ((entry: ScheduleEntry) => Promise<void>) | null = null;
  /** In-flight tick promise (W1-ARCH-07 drain on stop). */
  private tickInFlight: Promise<void> | null = null;
  private stopping = false;

  constructor(config: Partial<SchedulerConfig> = {}) {
    this.config = {
      checkIntervalMs: config.checkIntervalMs ?? 60000,
      timezone: config.timezone ?? 'UTC',
      maxConcurrentRuns: Math.max(1, config.maxConcurrentRuns ?? 4),
      onError:
        config.onError ??
        ((error, entry) =>
          console.error('[etl-scheduler] scheduled run failed', {
            pipelineId: entry?.pipelineId,
            tenantId: entry?.tenantId,
            error: error instanceof Error ? error.message : String(error),
          })),
    };
    // PRC-M228: fail fast on an unknown IANA timezone instead of silently using UTC.
    assertValidTimezone(this.config.timezone);
  }

  /**
   * Register a callback to be invoked when a pipeline is due for execution.
   */
  onDue(callback: (entry: ScheduleEntry) => Promise<void>): void {
    this.onDueCallback = callback;
  }

  /**
   * Add or update a schedule entry for a pipeline.
   */
  registerSchedule(
    pipelineId: string,
    tenantId: string,
    cronExpression: string,
    enabled: boolean = true,
  ): ScheduleEntry {
    if (!isValidCronExpression(cronExpression)) {
      throw new Error(`Invalid cron expression: ${cronExpression}`);
    }

    const nextRunAt = enabled
      ? getNextRunTime(cronExpression, new Date(), this.config.timezone)
      : null;

    const entry: ScheduleEntry = {
      pipelineId,
      tenantId,
      cronExpression,
      enabled,
      lastRunAt: null,
      nextRunAt,
    };

    this.schedules.set(pipelineId, entry);
    return entry;
  }

  /**
   * Remove a schedule entry for a pipeline.
   */
  unregisterSchedule(pipelineId: string): void {
    this.schedules.delete(pipelineId);
  }

  /**
   * Get a schedule entry by pipeline ID.
   */
  getSchedule(pipelineId: string): ScheduleEntry | undefined {
    return this.schedules.get(pipelineId);
  }

  /**
   * Get all registered schedule entries.
   */
  getAllSchedules(): ScheduleEntry[] {
    return Array.from(this.schedules.values());
  }

  /**
   * Get all pipelines that are due for execution at the given time.
   */
  getDuePipelines(now: Date = new Date()): ScheduleEntry[] {
    const due: ScheduleEntry[] = [];

    for (const entry of this.schedules.values()) {
      if (!entry.enabled) continue;
      if (entry.nextRunAt && entry.nextRunAt <= now) {
        due.push(entry);
      }
    }

    return due;
  }

  /**
   * Mark a pipeline as executed and calculate the next run time.
   */
  markExecuted(pipelineId: string): void {
    const entry = this.schedules.get(pipelineId);
    if (!entry) return;

    const now = new Date();
    entry.lastRunAt = now;
    entry.nextRunAt = getNextRunTime(entry.cronExpression, now, this.config.timezone);
  }

  /**
   * Start the scheduler loop.
   */
  start(): void {
    if (this.timer) return;
    this.stopping = false;

    this.timer = setInterval(() => {
      if (this.stopping || this.tickInFlight) return;
      this.tickInFlight = this.tick()
        // PRC-M226: never swallow tick failures silently.
        .catch((error: unknown) => this.config.onError?.(error))
        .finally(() => {
          this.tickInFlight = null;
        });
    }, this.config.checkIntervalMs);
  }

  /**
   * Stop accepting new ticks. Does not wait for an in-flight tick.
   * Prefer `stopAndDrain()` from Fastify onClose / process shutdown.
   */
  stop(): void {
    this.stopping = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * W1-ARCH-07: clear the interval and await the current tick (if any)
   * so in-flight scheduled pipeline work can finish before DB/pool close.
   */
  async stopAndDrain(): Promise<void> {
    this.stop();
    if (this.tickInFlight) {
      await this.tickInFlight;
    }
  }

  /**
   * Perform a single scheduler tick - check for due pipelines and invoke callback.
   */
  async tick(): Promise<void> {
    const duePipelines = this.getDuePipelines();
    for (const entry of duePipelines) this.markExecuted(entry.pipelineId);
    const callback = this.onDueCallback;
    if (!callback) return;

    // PRC-M226: bounded concurrency; one slow/failing pipeline neither blocks
    // the others nor aborts the tick, and every failure is reported.
    let next = 0;
    const worker = async () => {
      while (next < duePipelines.length) {
        const entry = duePipelines[next++]!;
        try {
          await callback(entry);
        } catch (error: unknown) {
          this.config.onError?.(error, entry);
        }
      }
    };
    const width = Math.min(this.config.maxConcurrentRuns, duePipelines.length);
    await Promise.all(Array.from({ length: width }, worker));
  }
}
