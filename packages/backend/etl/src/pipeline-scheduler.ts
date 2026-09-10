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
 * Validates a cron expression format.
 * Returns true if the expression is a valid 5-field cron or a known alias.
 */
export function isValidCronExpression(expression: string): boolean {
  const aliases = ['@hourly', '@daily', '@weekly', '@monthly', '@yearly'];
  if (aliases.includes(expression.toLowerCase())) {
    return true;
  }

  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    return false;
  }

  // Pattern matches: *, */n, n, n-m, n,m, n-m/s, and combinations
  const fieldPattern =
    /^(\*|\d{1,2}(-\d{1,2})?)(\/\d{1,2})?(,(\*|\d{1,2}(-\d{1,2})?)(\/\d{1,2})?)*$/;

  for (let i = 0; i < 5; i++) {
    if (!fieldPattern.test(parts[i]!)) {
      return false;
    }
  }

  return true;
}

/**
 * Determines if a cron expression matches a given date.
 * Evaluates minute, hour, day-of-month, month, and day-of-week fields.
 */
export function cronMatchesDate(cronExpression: string, date: Date): boolean {
  const normalized = normalizeCronExpression(cronExpression);
  const parts = normalized.trim().split(/\s+/);

  if (parts.length !== 5) {
    return false;
  }

  const minute = date.getUTCMinutes();
  const hour = date.getUTCHours();
  const dayOfMonth = date.getUTCDate();
  const month = date.getUTCMonth() + 1; // 1-indexed
  const dayOfWeek = date.getUTCDay(); // 0 = Sunday

  return (
    fieldMatches(parts[0]!, minute, 0, 59) &&
    fieldMatches(parts[1]!, hour, 0, 23) &&
    fieldMatches(parts[2]!, dayOfMonth, 1, 31) &&
    fieldMatches(parts[3]!, month, 1, 12) &&
    fieldMatches(parts[4]!, dayOfWeek, 0, 6)
  );
}

/**
 * Checks if a cron field matches a given value.
 */
function fieldMatches(field: string, value: number, _min: number, _max: number): boolean {
  if (field === '*') {
    return true;
  }

  // Handle step values: */n or start/n
  if (field.includes('/')) {
    const [rangeStr, stepStr] = field.split('/');
    const step = parseInt(stepStr!, 10);
    if (isNaN(step) || step <= 0) return false;

    if (rangeStr === '*') {
      return value % step === 0;
    }
    const start = parseInt(rangeStr!, 10);
    if (isNaN(start)) return false;
    return value >= start && (value - start) % step === 0;
  }

  // Handle comma-separated values
  const values = field.split(',');
  for (const v of values) {
    // Handle ranges: a-b
    if (v.includes('-')) {
      const [startStr, endStr] = v.split('-');
      const start = parseInt(startStr!, 10);
      const end = parseInt(endStr!, 10);
      if (!isNaN(start) && !isNaN(end) && value >= start && value <= end) {
        return true;
      }
    } else {
      const num = parseInt(v, 10);
      if (!isNaN(num) && num === value) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Calculates the next run time for a cron expression after a given date.
 * Searches forward minute-by-minute up to 366 days.
 */
export function getNextRunTime(cronExpression: string, after: Date): Date | null {
  const maxIterations = 366 * 24 * 60; // 1 year of minutes
  const candidate = new Date(after.getTime());
  // Start from the next minute
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);

  for (let i = 0; i < maxIterations; i++) {
    if (cronMatchesDate(cronExpression, candidate)) {
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

  constructor(config: Partial<SchedulerConfig> = {}) {
    this.config = {
      checkIntervalMs: config.checkIntervalMs ?? 60000,
      timezone: config.timezone ?? 'UTC',
    };
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

    const nextRunAt = enabled ? getNextRunTime(cronExpression, new Date()) : null;

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
    entry.nextRunAt = getNextRunTime(entry.cronExpression, now);
  }

  /**
   * Start the scheduler loop.
   */
  start(): void {
    if (this.timer) return;

    this.timer = setInterval(async () => {
      await this.tick();
    }, this.config.checkIntervalMs);
  }

  /**
   * Stop the scheduler loop.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Perform a single scheduler tick - check for due pipelines and invoke callback.
   */
  async tick(): Promise<void> {
    const duePipelines = this.getDuePipelines();

    for (const entry of duePipelines) {
      this.markExecuted(entry.pipelineId);
      if (this.onDueCallback) {
        await this.onDueCallback(entry);
      }
    }
  }
}
