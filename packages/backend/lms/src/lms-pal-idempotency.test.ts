/**
 * PRC-M295: Spiral PAL mastery is fed once per submission.
 *  - submit(): PAL is applied only after the submission insert succeeds, so a
 *    failed or duplicate submission never moves mastery.
 */
import { randomUUID } from 'node:crypto';

import { ConflictError } from '@proctira/common';
import { describe, expect, it } from 'vitest';

import { InMemoryLmsRepository } from './in-memory-repository.js';
import type { SubmissionEntity } from './lms-repository.js';
import { LmsService } from './lms-service.js';

const TENANT = randomUUID();
const SCHOOL = randomUUID();
const teacher = { userId: randomUUID(), roles: ['teacher'], institutions: [SCHOOL] };

class FailingSubmissionRepository extends InMemoryLmsRepository {
  async createSubmission(): Promise<SubmissionEntity> {
    throw new Error('simulated submission insert failure');
  }
}

async function seedSkill(svc: LmsService, code: string) {
  return svc.createSkill(
    TENANT,
    { scope: 'school', institutionId: SCHOOL, code, name: code, subject: 'Maths' },
    teacher,
  );
}

async function seedTaggedQuiz(svc: LmsService) {
  const skillA = await seedSkill(svc, 'FRACTIONS');
  const skillB = await seedSkill(svc, 'DECIMALS');
  const quiz = await svc.createAssignment(
    TENANT,
    {
      scope: 'school',
      institutionId: SCHOOL,
      kind: 'quiz',
      title: 'Skill quiz',
      subject: 'Maths',
      skillIds: [skillA.id],
      publish: true,
      questions: [
        { prompt: 'Q1', options: ['A', 'B'], correctOptionIndex: 0, skillId: skillA.id },
        { prompt: 'Q2', options: ['A', 'B'], correctOptionIndex: 1, skillId: skillB.id },
      ],
    },
    teacher,
  );
  return { quiz, skillA, skillB };
}

function studentActor(studentId: string) {
  return { userId: studentId, roles: ['student'], institutions: [SCHOOL] };
}

async function attemptsFor(repo: InMemoryLmsRepository, studentId: string) {
  return (await repo.listAttempts(TENANT, studentId, { page: 1, pageSize: 100 })).data;
}

describe('PRC-M295 — quiz submit applies PAL only after the submission is stored', () => {
  it('a failed submission insert leaves mastery and attempts untouched', async () => {
    const repo = new FailingSubmissionRepository();
    const svc = new LmsService(repo);
    const { quiz, skillA, skillB } = await seedTaggedQuiz(svc);
    const studentId = randomUUID();

    await expect(
      svc.submit(
        TENANT,
        quiz.id,
        {
          studentId,
          institutionId: SCHOOL,
          answers: quiz.questions.map((q) => ({ questionId: q.id, selectedOptionIndex: 0 })),
        },
        studentActor(studentId),
      ),
    ).rejects.toThrow('simulated submission insert failure');

    expect(await attemptsFor(repo, studentId)).toEqual([]);
    expect(await repo.findMastery(TENANT, studentId, skillA.id)).toBeNull();
    expect(await repo.findMastery(TENANT, studentId, skillB.id)).toBeNull();
  });

  it('two concurrent submits store one submission and count PAL once', async () => {
    const repo = new InMemoryLmsRepository();
    const svc = new LmsService(repo);
    const { quiz, skillA } = await seedTaggedQuiz(svc);
    const studentId = randomUUID();
    const input = {
      studentId,
      institutionId: SCHOOL,
      answers: quiz.questions.map((q) => ({ questionId: q.id, selectedOptionIndex: 0 })),
    };

    const results = await Promise.allSettled([
      svc.submit(TENANT, quiz.id, input, studentActor(studentId)),
      svc.submit(TENANT, quiz.id, input, studentActor(studentId)),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(ConflictError);

    // One attempt per skill-tagged question, not twice that.
    expect(await attemptsFor(repo, studentId)).toHaveLength(quiz.questions.length);
    expect((await repo.findMastery(TENANT, studentId, skillA.id))?.attempts).toBe(1);
  });
});
