/**
 * PRC-L241 — hostel/library, infrastructure and curriculum actions reject
 * path-traversal ids and out-of-range numbers before any gateway request.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const gatewayFetch = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true, status: 200, data: { id: 'x' }, error: null })),
);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/api/gateway', async (orig) => ({
  ...(await orig<typeof import('@/lib/api/gateway')>()),
  gatewayFetch,
}));

import {
  createHostelRoomAction,
  decideHostelLeaveAction,
  returnLibraryLoanAction,
  createHostelLeaveAction,
} from '@/app/(dashboard)/campus-actions';
import {
  createRoomAction,
  updateFacilityAction,
} from '@/app/(dashboard)/institutions/[id]/infrastructure/actions';
import {
  deleteLessonPlanAction,
  updateLearningOutcomeAction,
} from '@/app/(dashboard)/institutions/[id]/curriculum/actions';
import { deleteLessonPlan } from '@/lib/api/curriculum';

const ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  gatewayFetch.mockClear();
});

describe('campus-actions boundary validation (PRC-L241)', () => {
  it("rejects id '../x' without calling gatewayFetch", async () => {
    expect((await decideHostelLeaveAction('../x', 'approved')).status).toBe('error');
    expect((await returnLibraryLoanAction('../x')).status).toBe('error');
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it('rejects capacity -1 without calling gatewayFetch', async () => {
    const r = await createHostelRoomAction({ blockId: ID, roomNumber: '101', capacity: -1 });
    expect(r).toMatchObject({ status: 'error', message: expect.stringMatching(/capacity/) });
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it('rejects malformed and inverted leave dates', async () => {
    const base = { studentId: ID, hostelId: ID, startDate: '2026-05-10', endDate: '2026-05-01' };
    expect((await createHostelLeaveAction(base)).status).toBe('error');
    expect((await createHostelLeaveAction({ ...base, startDate: 'tomorrow' })).status).toBe(
      'error',
    );
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it('valid input reaches the gateway', async () => {
    await createHostelRoomAction({ blockId: ID, roomNumber: '101', capacity: 2 });
    expect(gatewayFetch).toHaveBeenCalledTimes(1);
  });
});

describe('infrastructure actions (PRC-L241)', () => {
  it("rejects id '../x' and capacity -1", async () => {
    const room = {
      institutionId: ID,
      floorId: ID,
      name: 'Lab',
      capacity: -1,
      condition: 'Good' as const,
    };
    expect((await createRoomAction(room)).ok).toBe(false);
    expect((await updateFacilityAction({ ...room, id: '../x', capacity: 10 })).ok).toBe(false);
    expect(gatewayFetch).not.toHaveBeenCalled();
  });
});

describe('curriculum actions and API path encoding (PRC-L241)', () => {
  it("rejects id '../x' without calling gatewayFetch", async () => {
    expect((await deleteLessonPlanAction(ID, '../x')).ok).toBe(false);
    expect(
      (await updateLearningOutcomeAction(ID, { id: '../x', code: 'C1', statement: 'S' })).ok,
    ).toBe(false);
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it('encodes path params in lib/api/curriculum', async () => {
    await deleteLessonPlan('a/../b', ID).catch(() => undefined);
    expect(gatewayFetch).toHaveBeenCalledWith(
      `/curriculum/lesson-plans/a%2F..%2Fb?institutionId=${ID}`,
      expect.anything(),
    );
  });
  it('lesson-plan actions name the route institution (PRC-H022)', async () => {
    const PLAN = '22222222-2222-4222-8222-222222222222';
    await deleteLessonPlanAction(ID, PLAN);
    expect(gatewayFetch).toHaveBeenCalledWith(
      `/curriculum/lesson-plans/${PLAN}?institutionId=${ID}`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
