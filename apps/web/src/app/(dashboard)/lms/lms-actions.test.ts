/**
 * PRC-M573: LMS server-action payload mapping (bank item, rubric, assignment
 * dueAt) against a mocked LMS client.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/datetime/tenant-timezone.server', () => ({
  toTenantUtcIso: async (v?: string) => (v ? `${v}:00.000Z@tenant` : undefined),
}));
const lms = {
  createBankQuestion: vi.fn(),
  createRubric: vi.fn(),
  createAssignment: vi.fn(),
};
vi.mock('@/lib/api/lms', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/lms')>('@/lib/api/lms');
  return {
    ...actual,
    createBankQuestion: (...a: unknown[]) => lms.createBankQuestion(...a),
    createRubric: (...a: unknown[]) => lms.createRubric(...a),
    createAssignment: (...a: unknown[]) => lms.createAssignment(...a),
  };
});
import { createAssignmentAction } from './actions';
import { createBankItemAction, createRubricAction } from './depth-actions';
const BOARD = '11111111-1111-4111-8111-111111111111';
beforeEach(() => {
  for (const fn of Object.values(lms)) {
    fn.mockReset();
    fn.mockResolvedValue({ id: 'created-1' });
  }
});
const bankBase = {
  scope: 'board' as const,
  boardId: BOARD,
  subject: 'Maths',
  difficulty: 'easy',
  prompt: 'Pick one',
  points: 1,
};
describe('createBankItemAction', () => {
  it('mcq: blank lines do not shift the correct option index', async () => {
    const res = await createBankItemAction({
      ...bankBase,
      questionType: 'mcq',
      options: 'Alpha\n\n  \nBeta\nGamma',
      correctOptionIndex: 1,
    } as never);
    expect(res.status).toBe('success');
    const payload = lms.createBankQuestion.mock.calls[0]![0].payload;
    expect(payload.options).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(payload.options[payload.correctOptionIndex]).toBe('Beta');
  });
  it('msq maps "0,2" to correctOptionIndexes with partial credit', async () => {
    await createBankItemAction({
      ...bankBase,
      questionType: 'msq',
      options: 'A\nB\nC',
      correctIndexes: '0,2',
    } as never);
    const payload = lms.createBankQuestion.mock.calls[0]![0].payload;
    expect(payload).toMatchObject({ correctOptionIndexes: [0, 2], partialCredit: true });
  });
  it('rejects an out-of-range answer key without calling the gateway', async () => {
    const res = await createBankItemAction({
      ...bankBase,
      questionType: 'mcq',
      options: 'A\nB',
      correctOptionIndex: 2,
    } as never);
    expect(res.status).toBe('error');
    expect(lms.createBankQuestion).not.toHaveBeenCalled();
  });
  it('numeric defaults tolerance and match keeps only complete pairs', async () => {
    await createBankItemAction({ ...bankBase, questionType: 'numeric', correctValue: 4 } as never);
    expect(lms.createBankQuestion.mock.calls[0]![0].payload).toEqual({
      correctValue: 4,
      tolerance: 0.01,
    });
    await createBankItemAction({
      ...bankBase,
      questionType: 'match',
      pairs: 'a|1\nbroken\nb | 2',
    } as never);
    expect(lms.createBankQuestion.mock.calls[1]![0].payload.pairs).toEqual([
      { left: 'a', right: '1' },
      { left: 'b', right: '2' },
    ]);
  });
});
describe('createRubricAction', () => {
  it('builds Developing/Secure levels from maxPoints', async () => {
    await createRubricAction({
      scope: 'board',
      boardId: BOARD,
      name: 'Essay',
      criterionName: 'Clarity',
      maxPoints: 5,
    } as never);
    const criteria = lms.createRubric.mock.calls[0]![0].criteria;
    expect(criteria).toEqual([
      {
        name: 'Clarity',
        maxPoints: 5,
        levels: [
          { label: 'Developing', points: 3 },
          { label: 'Secure', points: 5 },
        ],
      },
    ]);
  });
});
describe('createAssignmentAction', () => {
  it('passes the tenant-resolved dueAt instead of dropping it', async () => {
    await createAssignmentAction({
      scope: 'board',
      boardId: BOARD,
      kind: 'homework',
      title: 'Worksheet',
      subject: 'Maths',
      dueAt: '2026-01-10T17:00',
    } as never);
    expect(lms.createAssignment.mock.calls[0]![0].dueAt).toBe('2026-01-10T17:00:00.000Z@tenant');
  });
});
