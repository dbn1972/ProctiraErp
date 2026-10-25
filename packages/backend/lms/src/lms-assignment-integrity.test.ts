/**
 * PRC-M300: assignment create/update writes the assignment row and its quiz
 * questions all-or-nothing, validates before writing, and refuses to replace
 * the questions of a quiz that already has submissions.
 */
import { randomUUID } from 'node:crypto';

import { BusinessRuleError, ConflictError } from '@proctira/common';
import { describe, expect, it } from 'vitest';

import { InMemoryLmsRepository } from './in-memory-repository.js';
import type { QuizQuestionEntity } from './lms-repository.js';
import { LmsService } from './lms-service.js';

const TENANT = randomUUID();
const SCHOOL = randomUUID();
const teacher = { userId: randomUUID(), roles: ['teacher'], institutions: [SCHOOL] };

/** Fails every question write, simulating a constraint violation mid-save. */
class FailingQuestionsRepository extends InMemoryLmsRepository {
  async replaceQuestions(): Promise<QuizQuestionEntity[]> {
    throw new Error('simulated question insert failure');
  }
}

const mcq = (prompt: string) => ({
  prompt,
  options: ['A', 'B'],
  correctOptionIndex: 0,
  points: 1,
});

describe('PRC-M300 — atomic assignment + questions', () => {
  it('create rolls back the assignment row when the question write fails', async () => {
    const repo = new FailingQuestionsRepository();
    const svc = new LmsService(repo);
    const spyIds: string[] = [];
    const originalCreate = repo.createAssignment.bind(repo);
    repo.createAssignment = async (data) => {
      spyIds.push(data.id);
      return originalCreate(data);
    };

    await expect(
      svc.createAssignment(
        TENANT,
        {
          scope: 'school',
          institutionId: SCHOOL,
          kind: 'quiz',
          title: 'Fractions quiz',
          subject: 'Maths',
          questions: [mcq('1/2 + 1/2')],
        },
        teacher,
      ),
    ).rejects.toThrow('simulated question insert failure');

    expect(spyIds).toHaveLength(1);
    expect(await repo.findAssignmentById(TENANT, spyIds[0]!)).toBeNull();
    const listed = await repo.listAssignments(TENANT, {}, { page: 1, pageSize: 10 });
    expect(listed.meta.totalItems).toBe(0);
  });

  it('update validates the publish rule before replacing questions', async () => {
    const repo = new InMemoryLmsRepository();
    const svc = new LmsService(repo);
    const quiz = await svc.createAssignment(
      TENANT,
      {
        scope: 'school',
        institutionId: SCHOOL,
        kind: 'quiz',
        title: 'Draft quiz',
        subject: 'Maths',
        questions: [mcq('Q1')],
      },
      teacher,
    );
    expect(quiz.questions).toHaveLength(1);

    await expect(
      svc.updateAssignment(TENANT, quiz.id, { questions: [], status: 'published' }, teacher),
    ).rejects.toBeInstanceOf(BusinessRuleError);

    const questions = await repo.listQuestions(TENANT, quiz.id);
    expect(questions).toHaveLength(1);
    expect(questions[0]?.id).toBe(quiz.questions[0]?.id);
    expect((await repo.findAssignmentById(TENANT, quiz.id))?.status).toBe('draft');
  });

  it('update refuses to replace questions once submissions exist', async () => {
    const repo = new InMemoryLmsRepository();
    const svc = new LmsService(repo);
    const quiz = await svc.createAssignment(
      TENANT,
      {
        scope: 'school',
        institutionId: SCHOOL,
        kind: 'quiz',
        title: 'Published quiz',
        subject: 'Maths',
        publish: true,
        questions: [mcq('Q1')],
      },
      teacher,
    );
    const studentId = randomUUID();
    await svc.submit(
      TENANT,
      quiz.id,
      {
        studentId,
        institutionId: SCHOOL,
        answers: [{ questionId: quiz.questions[0]!.id, selectedOptionIndex: 0 }],
      },
      { userId: studentId, roles: ['student'], institutions: [SCHOOL] },
    );

    await expect(
      svc.updateAssignment(TENANT, quiz.id, { questions: [mcq('Q1 rewritten')] }, teacher),
    ).rejects.toBeInstanceOf(ConflictError);

    const questions = await repo.listQuestions(TENANT, quiz.id);
    expect(questions.map((q) => q.id)).toEqual([quiz.questions[0]!.id]);
    expect(questions[0]?.prompt).toBe('Q1');

    // Non-question edits on the same quiz still succeed.
    const renamed = await svc.updateAssignment(TENANT, quiz.id, { title: 'Renamed' }, teacher);
    expect(renamed.title).toBe('Renamed');
    expect(renamed.questions).toHaveLength(1);
  });
});
