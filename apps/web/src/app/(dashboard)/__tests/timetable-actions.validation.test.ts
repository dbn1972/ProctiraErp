import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createBellSchedule, createPeriod } = vi.hoisted(() => ({
  createBellSchedule: vi.fn(),
  createPeriod: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/api/timetable', () => ({
  createBellSchedule: (...args: unknown[]) => createBellSchedule(...args),
  createPeriod: (...args: unknown[]) => createPeriod(...args),
}));

import { GatewayError } from '@/lib/api/gateway';
import { createBellScheduleAction, createPeriodAction } from '../timetable-actions';

const base = { institutionId: 'i1', academicPeriodId: 'ap1' };

describe('timetable actions validation (PRC-L260)', () => {
  beforeEach(() => {
    createBellSchedule.mockReset().mockResolvedValue({ id: 'bs1' });
    createPeriod.mockReset().mockResolvedValue({ id: 'p1' });
  });

  it("rejects day pattern '1,2,9' without calling the gateway", async () => {
    const result = await createBellScheduleAction({ ...base, name: 'Day', dayPattern: '1,2,9' });
    expect(result.ok).toBe(false);
    expect(createBellSchedule).not.toHaveBeenCalled();
  });

  it('accepts a valid weekday pattern', async () => {
    const result = await createBellScheduleAction({ ...base, name: 'Day', dayPattern: '1,2,3' });
    expect(result).toEqual({ ok: true, id: 'bs1' });
  });

  it('rejects 09:00–08:00 and out-of-range 99:99', async () => {
    const input = { bellScheduleId: 'bs1', academicPeriodId: 'ap1', name: 'P1', periodOrder: 1 };
    const reversed = await createPeriodAction({ ...input, startTime: '09:00', endTime: '08:00' });
    expect(reversed.ok).toBe(false);
    const bogus = await createPeriodAction({ ...input, startTime: '08:00', endTime: '99:99' });
    expect(bogus.ok).toBe(false);
    expect(createPeriod).not.toHaveBeenCalled();
    const ok = await createPeriodAction({ ...input, startTime: '08:00', endTime: '08:45' });
    expect(ok).toEqual({ ok: true, id: 'p1' });
  });

  it('does not leak the migration file name to users', async () => {
    createBellSchedule.mockRejectedValue(
      new GatewayError({
        message: 'Timetable schema missing',
        status: 503,
        code: 'TIMETABLE_SCHEMA_MISSING',
      }),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await createBellScheduleAction({ ...base, name: 'Day', dayPattern: '1,2' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toMatch(/db\/sql|\.sql/);
      expect(result.code).toBe('TIMETABLE_SCHEMA_MISSING');
    }
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
