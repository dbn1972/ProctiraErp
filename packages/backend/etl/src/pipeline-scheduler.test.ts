/**
 * Pipeline Scheduler Unit Tests
 */
import { describe, it, expect } from 'vitest';
import {
  PipelineScheduler,
  normalizeCronExpression,
  isValidCronExpression,
  cronMatchesDate,
  getNextRunTime,
} from './pipeline-scheduler.js';

describe('normalizeCronExpression', () => {
  it('should normalize @hourly alias', () => {
    expect(normalizeCronExpression('@hourly')).toBe('0 * * * *');
  });

  it('should normalize @daily alias', () => {
    expect(normalizeCronExpression('@daily')).toBe('0 0 * * *');
  });

  it('should normalize @weekly alias', () => {
    expect(normalizeCronExpression('@weekly')).toBe('0 0 * * 0');
  });

  it('should normalize @monthly alias', () => {
    expect(normalizeCronExpression('@monthly')).toBe('0 0 1 * *');
  });

  it('should return custom expressions unchanged', () => {
    expect(normalizeCronExpression('*/15 * * * *')).toBe('*/15 * * * *');
  });

  it('should be case-insensitive for aliases', () => {
    expect(normalizeCronExpression('@HOURLY')).toBe('0 * * * *');
  });
});

describe('isValidCronExpression', () => {
  it('should accept valid 5-field cron expressions', () => {
    expect(isValidCronExpression('0 * * * *')).toBe(true);
    expect(isValidCronExpression('*/15 * * * *')).toBe(true);
    expect(isValidCronExpression('0 0 * * 0')).toBe(true);
    expect(isValidCronExpression('30 6 * * 1-5')).toBe(true);
    expect(isValidCronExpression('0 0 1 * *')).toBe(true);
  });

  it('should accept known aliases', () => {
    expect(isValidCronExpression('@hourly')).toBe(true);
    expect(isValidCronExpression('@daily')).toBe(true);
    expect(isValidCronExpression('@weekly')).toBe(true);
    expect(isValidCronExpression('@monthly')).toBe(true);
    expect(isValidCronExpression('@yearly')).toBe(true);
  });

  it('should reject invalid expressions', () => {
    expect(isValidCronExpression('')).toBe(false);
    expect(isValidCronExpression('invalid')).toBe(false);
    expect(isValidCronExpression('* * *')).toBe(false); // too few fields
    expect(isValidCronExpression('* * * * * *')).toBe(false); // too many fields
  });
});

describe('cronMatchesDate', () => {
  it('should match wildcard expression to any date', () => {
    const date = new Date('2024-06-15T10:30:00Z');
    expect(cronMatchesDate('* * * * *', date)).toBe(true);
  });

  it('should match @hourly at minute 0', () => {
    const date = new Date('2024-06-15T10:00:00Z');
    expect(cronMatchesDate('@hourly', date)).toBe(true);
  });

  it('should not match @hourly at minute 30', () => {
    const date = new Date('2024-06-15T10:30:00Z');
    expect(cronMatchesDate('@hourly', date)).toBe(false);
  });

  it('should match @daily at midnight', () => {
    const date = new Date('2024-06-15T00:00:00Z');
    expect(cronMatchesDate('@daily', date)).toBe(true);
  });

  it('should not match @daily at noon', () => {
    const date = new Date('2024-06-15T12:00:00Z');
    expect(cronMatchesDate('@daily', date)).toBe(false);
  });

  it('should match specific minute and hour', () => {
    const date = new Date('2024-06-15T06:30:00Z');
    expect(cronMatchesDate('30 6 * * *', date)).toBe(true);
  });

  it('should match step values', () => {
    const date = new Date('2024-06-15T10:15:00Z');
    expect(cronMatchesDate('*/15 * * * *', date)).toBe(true);
  });

  it('should not match step values for non-matching minutes', () => {
    const date = new Date('2024-06-15T10:07:00Z');
    expect(cronMatchesDate('*/15 * * * *', date)).toBe(false);
  });

  it('should match day-of-week (Sunday = 0)', () => {
    // June 16, 2024 is a Sunday
    const date = new Date('2024-06-16T00:00:00Z');
    expect(cronMatchesDate('0 0 * * 0', date)).toBe(true);
  });

  it('should match range values', () => {
    // Monday = 1, within 1-5 range
    const date = new Date('2024-06-17T06:30:00Z'); // Monday
    expect(cronMatchesDate('30 6 * * 1-5', date)).toBe(true);
  });

  it('should not match range values outside range', () => {
    // Sunday = 0, outside 1-5 range
    const date = new Date('2024-06-16T06:30:00Z'); // Sunday
    expect(cronMatchesDate('30 6 * * 1-5', date)).toBe(false);
  });
});

describe('getNextRunTime', () => {
  it('should find next hourly run time', () => {
    const after = new Date('2024-06-15T10:30:00Z');
    const next = getNextRunTime('@hourly', after);
    expect(next).not.toBeNull();
    expect(next!.getUTCMinutes()).toBe(0);
    expect(next!.getUTCHours()).toBe(11);
  });

  it('should find next daily run time', () => {
    const after = new Date('2024-06-15T10:30:00Z');
    const next = getNextRunTime('@daily', after);
    expect(next).not.toBeNull();
    expect(next!.getUTCHours()).toBe(0);
    expect(next!.getUTCMinutes()).toBe(0);
    expect(next!.getUTCDate()).toBe(16);
  });

  it('should find next run for step expression', () => {
    const after = new Date('2024-06-15T10:14:00Z');
    const next = getNextRunTime('*/15 * * * *', after);
    expect(next).not.toBeNull();
    expect(next!.getUTCMinutes()).toBe(15);
  });
});

describe('PipelineScheduler', () => {
  it('should register a schedule entry', () => {
    const scheduler = new PipelineScheduler();
    const entry = scheduler.registerSchedule('pipe-1', 'tenant-1', '@hourly');

    expect(entry.pipelineId).toBe('pipe-1');
    expect(entry.tenantId).toBe('tenant-1');
    expect(entry.cronExpression).toBe('@hourly');
    expect(entry.enabled).toBe(true);
    expect(entry.nextRunAt).not.toBeNull();
  });

  it('should throw for invalid cron expression', () => {
    const scheduler = new PipelineScheduler();
    expect(() => scheduler.registerSchedule('pipe-1', 'tenant-1', 'invalid')).toThrow(
      'Invalid cron expression',
    );
  });

  it('should unregister a schedule', () => {
    const scheduler = new PipelineScheduler();
    scheduler.registerSchedule('pipe-1', 'tenant-1', '@hourly');
    scheduler.unregisterSchedule('pipe-1');

    expect(scheduler.getSchedule('pipe-1')).toBeUndefined();
  });

  it('should get all schedules', () => {
    const scheduler = new PipelineScheduler();
    scheduler.registerSchedule('pipe-1', 'tenant-1', '@hourly');
    scheduler.registerSchedule('pipe-2', 'tenant-1', '@daily');

    const all = scheduler.getAllSchedules();
    expect(all).toHaveLength(2);
  });

  it('should find due pipelines', () => {
    const scheduler = new PipelineScheduler();
    scheduler.registerSchedule('pipe-1', 'tenant-1', '@hourly');

    // Set nextRunAt to the past
    const entry = scheduler.getSchedule('pipe-1')!;
    entry.nextRunAt = new Date(Date.now() - 60000);

    const due = scheduler.getDuePipelines();
    expect(due).toHaveLength(1);
    expect(due[0]!.pipelineId).toBe('pipe-1');
  });

  it('should not find disabled pipelines as due', () => {
    const scheduler = new PipelineScheduler();
    scheduler.registerSchedule('pipe-1', 'tenant-1', '@hourly', false);

    const due = scheduler.getDuePipelines();
    expect(due).toHaveLength(0);
  });

  it('should mark pipeline as executed and update next run time', () => {
    const scheduler = new PipelineScheduler();
    scheduler.registerSchedule('pipe-1', 'tenant-1', '@hourly');

    scheduler.markExecuted('pipe-1');

    const entry = scheduler.getSchedule('pipe-1')!;
    expect(entry.lastRunAt).not.toBeNull();
    expect(entry.nextRunAt).not.toBeNull();
    expect(entry.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('should invoke onDue callback during tick', async () => {
    const scheduler = new PipelineScheduler();
    scheduler.registerSchedule('pipe-1', 'tenant-1', '@hourly');

    // Force nextRunAt to the past
    const entry = scheduler.getSchedule('pipe-1')!;
    entry.nextRunAt = new Date(Date.now() - 60000);

    const executed: string[] = [];
    scheduler.onDue(async (e) => {
      executed.push(e.pipelineId);
    });

    await scheduler.tick();

    expect(executed).toContain('pipe-1');
  });
});
