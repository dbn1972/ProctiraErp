/**
 * LMS repository factory + Postgres smoke (G-801 / G-807).
 * The Pg block runs only when DATABASE_URL is set (CI integration job).
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createLmsRepository, isPgLmsEnabled } from './create-lms-repository.js';
import { InMemoryLmsRepository } from './in-memory-repository.js';
import { getSharedLmsPool, PgLmsRepository } from './pg-lms-repository.js';

describe('createLmsRepository', () => {
  it('falls back to in-memory when DATABASE_URL is unset', () => {
    const prev = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(isPgLmsEnabled()).toBe(false);
      expect(createLmsRepository()).toBeInstanceOf(InMemoryLmsRepository);
    } finally {
      if (prev !== undefined) process.env.DATABASE_URL = prev;
      else delete process.env.DATABASE_URL;
    }
  });
});

describe('PgLmsRepository', () => {
  it.skipIf(!isPgLmsEnabled())(
    'persists skills, assignments, questions, submissions and mastery under RLS',
    async () => {
      const pool = getSharedLmsPool();
      expect(pool).not.toBeNull();
      const repo = new PgLmsRepository(pool!);
      const tenantA = randomUUID();
      const tenantB = randomUUID();
      const boardId = randomUUID();
      const schoolId = randomUUID();
      const studentId = randomUUID();

      const skill = await repo.createSkill({
        id: randomUUID(),
        tenantId: tenantA,
        scope: 'board',
        boardId,
        institutionId: null,
        code: `SK-${randomUUID().slice(0, 8)}`,
        name: 'Fractions',
        subject: 'Maths',
        gradeLevel: '5',
        description: null,
        prerequisiteSkillIds: [],
      });

      const assignment = await repo.createAssignment({
        id: randomUUID(),
        tenantId: tenantA,
        scope: 'school',
        boardId: null,
        institutionId: schoolId,
        kind: 'quiz',
        title: 'Quiz',
        description: null,
        subject: 'Maths',
        gradeLevel: '5',
        sectionId: null,
        skillIds: [skill.id],
        maxScore: 2,
        dueAt: new Date('2030-01-01T00:00:00Z'),
        timeLimitMinutes: 15,
        allowLate: false,
        status: 'published',
        createdBy: null,
        publishedAt: new Date(),
      });
      expect(assignment.skillIds).toEqual([skill.id]);

      const questions = await repo.replaceQuestions(tenantA, assignment.id, [
        {
          id: randomUUID(),
          tenantId: tenantA,
          assignmentId: assignment.id,
          position: 0,
          prompt: '1/2 + 1/2',
          options: ['1', '2'],
          correctOptionIndex: 0,
          points: 2,
          skillId: skill.id,
          explanation: null,
        },
      ]);
      expect(questions).toHaveLength(1);
      expect((await repo.listQuestions(tenantA, assignment.id))[0]?.options).toEqual(['1', '2']);

      // Board-shared + own-school visibility predicate.
      const visible = await repo.listAssignments(
        tenantA,
        { institutionId: schoolId, boardId },
        { page: 1, pageSize: 10 },
      );
      expect(visible.meta.totalItems).toBe(1);
      const otherSchool = await repo.listAssignments(
        tenantA,
        { institutionId: randomUUID(), boardId },
        { page: 1, pageSize: 10 },
      );
      expect(otherSchool.meta.totalItems).toBe(0);

      const submission = await repo.createSubmission({
        id: randomUUID(),
        tenantId: tenantA,
        assignmentId: assignment.id,
        studentId,
        institutionId: schoolId,
        status: 'graded',
        content: null,
        attachments: [],
        answers: [{ questionId: questions[0]!.id, selectedOptionIndex: 0 }],
        score: 2,
        autoGraded: true,
        feedback: null,
        submittedAt: new Date(),
        gradedAt: new Date(),
        gradedBy: null,
      });
      expect(submission.answers[0]?.selectedOptionIndex).toBe(0);

      const mastery = await repo.upsertMastery({
        id: randomUUID(),
        tenantId: tenantA,
        studentId,
        skillId: skill.id,
        institutionId: schoolId,
        mastery: 0.3,
        attempts: 1,
        correct: 1,
        streak: 1,
        intervalDays: 1,
        dueAt: new Date('2030-01-02T00:00:00Z'),
        lastReviewedAt: new Date(),
      });
      const again = await repo.upsertMastery({
        ...mastery,
        id: randomUUID(),
        mastery: 0.51,
        streak: 2,
      });
      expect(again.id).toBe(mastery.id);
      expect(again.mastery).toBeCloseTo(0.51, 4);

      await repo.recordAttempt({
        id: randomUUID(),
        tenantId: tenantA,
        studentId,
        skillId: skill.id,
        source: 'quiz',
        sourceId: assignment.id,
        correct: true,
        responseTimeMs: 1200,
        masteryAfter: 0.51,
      });
      expect(
        (await repo.listAttempts(tenantA, studentId, { page: 1, pageSize: 5 })).meta.totalItems,
      ).toBe(1);

      // RLS: tenant B cannot read tenant A rows by UUID.
      expect(await repo.findAssignmentById(tenantB, assignment.id)).toBeNull();
      expect(await repo.findSkillById(tenantB, skill.id)).toBeNull();
      expect(await repo.findSubmissionById(tenantB, submission.id)).toBeNull();
      expect(await repo.listMastery(tenantB, { studentId })).toEqual([]);
    },
  );
});
