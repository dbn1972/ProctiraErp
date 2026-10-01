import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/api/lms', () => ({
  closeAssignment: vi.fn(),
  createAssignment: vi.fn(),
  createSkill: vi.fn(),
  getStudentPlan: vi.fn(),
  getStudentProgress: vi.fn(),
  gradeSubmission: vi.fn(),
  publishAssignment: vi.fn(),
  createBankQuestion: vi.fn(),
  createRubric: vi.fn(),
  createContentItem: vi.fn(),
}));

import * as lmsApi from '@/lib/api/lms';
import {
  closeAssignmentAction,
  createAssignmentAction,
  createSkillAction,
  gradeSubmissionAction,
  lookupStudentPalAction,
  publishAssignmentAction,
} from './actions';
import { createBankItemAction } from './depth-actions';
import type { LmsBankItemValues } from '@/lib/validation/lms-depth-schema';
import type { CreateAssignmentInput } from '@/lib/api/lms';

const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';

type Mocked = ReturnType<typeof vi.fn>;
function api() {
  return lmsApi as unknown as Record<
    'createAssignment' | 'createBankQuestion' | (string & {}),
    Mocked
  > & { createAssignment: Mocked; createBankQuestion: Mocked };
}

const quiz: CreateAssignmentInput = {
  scope: 'school',
  institutionId: ID,
  kind: 'quiz',
  title: 'Fractions',
  subject: 'Maths',
  questions: [{ prompt: 'Half of 4?', options: ['1', '2'], correctOptionIndex: 1 }],
};

describe('LMS server action validation (PRC-L245)', () => {
  beforeEach(() => {
    for (const fn of Object.values(api())) fn.mockReset();
  });

  it('createAssignmentAction rejects a school scope without institutionId', async () => {
    const result = await createAssignmentAction({ ...quiz, institutionId: undefined });
    expect(result.status).toBe('error');
    expect(lmsApi.createAssignment).not.toHaveBeenCalled();
  });

  it('createAssignmentAction rejects a board scope without boardId', async () => {
    const result = await createAssignmentAction({ ...quiz, scope: 'board' });
    expect(result.status).toBe('error');
    expect(lmsApi.createAssignment).not.toHaveBeenCalled();
  });

  it('createAssignmentAction rejects a correct index outside the options', async () => {
    const result = await createAssignmentAction({
      ...quiz,
      questions: [{ prompt: 'Q', options: ['a', 'b'], correctOptionIndex: 2 }],
    });
    expect(result).toMatchObject({ status: 'error' });
    expect(lmsApi.createAssignment).not.toHaveBeenCalled();
  });

  it('createAssignmentAction forwards a valid quiz', async () => {
    api().createAssignment.mockResolvedValue({ id: ID2 });
    const result = await createAssignmentAction(quiz);
    expect(result).toEqual({ status: 'success', id: ID2 });
    expect(lmsApi.createAssignment).toHaveBeenCalledTimes(1);
  });

  it('publish/close reject a non-uuid id', async () => {
    expect((await publishAssignmentAction('../x')).status).toBe('error');
    expect((await closeAssignmentAction('nope')).status).toBe('error');
    expect(lmsApi.publishAssignment).not.toHaveBeenCalled();
    expect(lmsApi.closeAssignment).not.toHaveBeenCalled();
  });

  it('gradeSubmissionAction rejects NaN/negative scores and bad ids', async () => {
    expect((await gradeSubmissionAction(ID, ID2, { score: Number.NaN })).status).toBe('error');
    expect((await gradeSubmissionAction(ID, ID2, { score: -1 })).status).toBe('error');
    expect((await gradeSubmissionAction('x', ID2, { score: 5 })).status).toBe('error');
    expect(lmsApi.gradeSubmission).not.toHaveBeenCalled();
  });

  it('createSkillAction rejects a scope without its owning id', async () => {
    const result = await createSkillAction({
      scope: 'board',
      code: 'FR1',
      name: 'Fractions',
      subject: 'Maths',
    });
    expect(result.status).toBe('error');
    expect(lmsApi.createSkill).not.toHaveBeenCalled();
  });

  it('lookupStudentPalAction rejects a non-uuid learner id', async () => {
    const result = await lookupStudentPalAction('abc');
    expect(result.status).toBe('error');
    expect(lmsApi.getStudentPlan).not.toHaveBeenCalled();
  });
});

describe('createBankItemAction answer keys (PRC-L245)', () => {
  const base: LmsBankItemValues = {
    scope: 'school',
    institutionId: ID,
    subject: 'Maths',
    questionType: 'mcq',
    prompt: 'Pick one',
    options: 'a\nb\nc',
  };

  beforeEach(() => api().createBankQuestion.mockReset());

  it('rejects an MCQ whose correct index is outside the options', async () => {
    const result = await createBankItemAction({ ...base, correctOptionIndex: 5 });
    expect(result.status).toBe('error');
    expect(lmsApi.createBankQuestion).not.toHaveBeenCalled();
  });

  it('rejects an MSQ with no or invalid correct indexes instead of defaulting', async () => {
    for (const correctIndexes of ['', '0,x', '0,7']) {
      const result = await createBankItemAction({ ...base, questionType: 'msq', correctIndexes });
      expect(result.status).toBe('error');
    }
    expect(lmsApi.createBankQuestion).not.toHaveBeenCalled();
  });

  it('rejects a board-scoped item without boardId', async () => {
    const result = await createBankItemAction({ ...base, scope: 'board', correctOptionIndex: 0 });
    expect(result.status).toBe('error');
  });

  it('forwards valid MSQ indexes', async () => {
    api().createBankQuestion.mockResolvedValue({ id: ID2 });
    const result = await createBankItemAction({
      ...base,
      questionType: 'msq',
      correctIndexes: '0, 2',
    });
    expect(result.status).toBe('success');
    const call = api().createBankQuestion.mock.calls[0]?.[0] as { payload: unknown };
    expect(call.payload).toMatchObject({ correctOptionIndexes: [0, 2] });
  });
});
