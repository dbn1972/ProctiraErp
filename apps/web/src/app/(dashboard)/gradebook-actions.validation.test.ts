/**
 * PRC-L239 — gradebook / board-export actions validate at the web boundary
 * and never reach the gateway with out-of-range or malformed input.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  upsertGradeEntry: vi.fn(),
  computeGpa: vi.fn(),
  issueTranscript: vi.fn(),
  createReportCardJob: vi.fn(),
  createBoardExportJob: vi.fn(),
  bulkTransitionGradeEntries: vi.fn(),
  computeClassRank: vi.fn(),
  createCommentsBank: vi.fn(),
  transitionGradeEntry: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/api/gradebook', () => api);
vi.mock('@/lib/auth/server', () => ({
  getSession: vi.fn(async () => ({
    accessToken: 't',
    refreshToken: null,
    isExpired: false,
    user: { sub: 'u1', tenantId: 't', email: 'e', roles: [{ roleId: 'registrar' }] },
  })),
}));

import {
  computeGpaAction,
  createReportCardJobAction,
  issueTranscriptAction,
  upsertGradeEntryAction,
} from './gradebook-actions';
import { createBoardExportJobAction } from './examinations/board-exports/actions';

const ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('gradebook action boundary validation (PRC-L239)', () => {
  it('rejects numericScore 1e9 without a gateway request', async () => {
    const r = await upsertGradeEntryAction({ studentId: ID, numericScore: 1e9 });
    expect(r).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });
    expect(api.upsertGradeEntry).not.toHaveBeenCalled();
  });

  it('rejects non-uuid ids for every action', async () => {
    expect((await upsertGradeEntryAction({ studentId: '../x' })).ok).toBe(false);
    expect((await computeGpaAction({ studentId: 'nope' })).ok).toBe(false);
    expect((await issueTranscriptAction({ studentId: 'nope' })).ok).toBe(false);
    expect((await createReportCardJobAction({ studentId: ID, boardId: 'x' })).ok).toBe(false);
    expect(api.upsertGradeEntry).not.toHaveBeenCalled();
    expect(api.computeGpa).not.toHaveBeenCalled();
    expect(api.issueTranscript).not.toHaveBeenCalled();
    expect(api.createReportCardJob).not.toHaveBeenCalled();
  });

  it('rejects unknown keys (.strict)', async () => {
    const r = await issueTranscriptAction({ studentId: ID, tenantId: 'other' } as never);
    expect(r.ok).toBe(false);
    expect(api.issueTranscript).not.toHaveBeenCalled();
  });

  it('forwards valid input and strips institutionId from the gpa body', async () => {
    api.computeGpa.mockResolvedValue({
      id: 'g1',
      weightedGpa: 3,
      unweightedGpa: 3,
      creditsEarned: 1,
    });
    const r = await computeGpaAction({ studentId: ID, institutionId: ID });
    expect(r.ok).toBe(true);
    expect(api.computeGpa).toHaveBeenCalledWith({ studentId: ID });
  });

  it('board export rejects >500 students and non-uuid institution', async () => {
    const many = Array.from({ length: 501 }, () => ID);
    expect((await createBoardExportJobAction({ institutionId: ID, studentIds: many })).ok).toBe(
      false,
    );
    expect((await createBoardExportJobAction({ institutionId: 'x' })).ok).toBe(false);
    expect(api.createBoardExportJob).not.toHaveBeenCalled();
  });
});
