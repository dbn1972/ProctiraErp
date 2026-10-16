/**
 * @vitest-environment node
 *
 * PRC-L411 — curriculum write-action unit tests. Covers uuid-id validation on
 * delete/unmark actions (ids are interpolated into gateway paths), success
 * mapping, and GatewayError → user message mapping.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GatewayError } from '@/lib/api/gateway';

const api = vi.hoisted(() => ({
  createLearningOutcome: vi.fn(),
  createLessonPlan: vi.fn(),
  createSyllabusUnit: vi.fn(),
  deleteLearningOutcome: vi.fn(),
  deleteLessonPlan: vi.fn(),
  markUnitTaught: vi.fn(),
  unmarkUnitTaught: vi.fn(),
  updateLearningOutcome: vi.fn(),
  updateLessonPlan: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/api/curriculum', () => api);

import { deleteLessonPlanAction, markUnitTaughtAction, unmarkUnitTaughtAction } from './actions';

const INST = '88888888-8888-4888-8888-888888888888';
const UNIT = '99999999-9999-4999-8999-999999999999';

describe('curriculum actions (PRC-L411)', () => {
  beforeEach(() => {
    for (const m of Object.values(api)) m.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  it('deleteLessonPlanAction rejects a non-uuid id before the gateway', async () => {
    const res = await deleteLessonPlanAction(INST, 'not-a-uuid');
    expect(res.ok).toBe(false);
    expect(api.deleteLessonPlan).not.toHaveBeenCalled();
  });

  it('deleteLessonPlanAction rejects a non-uuid institution id', async () => {
    const res = await deleteLessonPlanAction('nope', UNIT);
    expect(res.ok).toBe(false);
    expect(api.deleteLessonPlan).not.toHaveBeenCalled();
  });

  it('unmarkUnitTaughtAction succeeds for a valid uuid', async () => {
    api.unmarkUnitTaught.mockResolvedValue(undefined);
    const res = await unmarkUnitTaughtAction(INST, UNIT);
    expect(res).toEqual({ ok: true, id: UNIT });
    expect(api.unmarkUnitTaught).toHaveBeenCalledWith(UNIT);
  });

  it('markUnitTaughtAction maps a GatewayError to its message', async () => {
    api.markUnitTaught.mockRejectedValue(
      new GatewayError({ status: 409, code: 'CONFLICT', message: 'already taught' }),
    );
    const res = await markUnitTaughtAction(INST, { unitId: UNIT });
    expect(res).toEqual({ ok: false, error: 'already taught' });
  });

  it('markUnitTaughtAction returns the row id and taughtAt extra on success', async () => {
    api.markUnitTaught.mockResolvedValue({ id: UNIT, taughtAt: '2026-10-12T00:00:00Z' });
    const res = await markUnitTaughtAction(INST, { unitId: UNIT });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.extra?.taughtAt).toBe('2026-10-12T00:00:00Z');
  });
});
