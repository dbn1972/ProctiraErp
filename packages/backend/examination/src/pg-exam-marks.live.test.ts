/**
 * W3-TEST-01 — live Postgres invariants for double marks entry (G-908).
 * Exam shell stays in-memory; marks persist via PgExamOpsStore.
 */
import { randomUUID } from 'node:crypto';

import { getSharedPgPool } from '@proctira/database';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { describe, expect, it } from 'vitest';

import { ExaminationService } from './examination-service.js';
import { InMemoryExaminationRepository } from './in-memory-repository.js';
import { ExamOpsService } from './ops-service.js';
import { PgExamOpsStore } from './ops-store.js';
import type { CreateExaminationInput } from './schemas.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'pg-exam-marks.live.test' });
const pool = DATABASE_URL ? getSharedPgPool(DATABASE_URL) : null;
const live = Boolean(DATABASE_URL) && pool !== null;

function futureDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function examBody(): CreateExaminationInput {
  return {
    name: 'Live Marks Exam',
    code: `LM-${randomUUID().slice(0, 8).toUpperCase()}`,
    academicPeriodId: randomUUID(),
    startDate: futureDate(7),
    endDate: futureDate(9),
    subjects: [{ name: 'Mathematics', code: 'MATH', maxScore: 100 }],
    centers: [{ name: 'Center A', code: 'CTR-A', institutionId: randomUUID(), capacity: 50 }],
    gradingSchemes: [
      {
        name: 'Standard',
        minScore: 0,
        maxScore: 100,
        passThreshold: 40,
        thresholds: [
          { grade: 'A', minScore: 80, maxScore: 100 },
          { grade: 'F', minScore: 0, maxScore: 79 },
        ],
      },
    ],
  };
}

describe('exam marks (live Postgres)', () => {
  it.skipIf(!live)(
    'double entry persists variance and moderator resolution under Postgres',
    async () => {
      const tenantId = randomUUID();
      const repository = new InMemoryExaminationRepository();
      const store = new PgExamOpsStore(pool!);
      const exams = new ExaminationService(repository);
      const ops = new ExamOpsService({ store, examinations: repository });

      const studentId = randomUUID();
      repository.setStudentEnrollment({
        studentId,
        status: 'enrolled',
        institutionId: randomUUID(),
        completedSubjectCodes: ['MATH'],
      });

      const exam = await exams.create(tenantId, examBody());
      const subjectId = exam.subjects[0]!.id;
      const centerId = exam.centers[0]!.id;
      const registration = await exams.registerCandidate(tenantId, exam.id, {
        studentId,
        centerId,
        subjectIds: [subjectId],
      });

      const marker1 = { userId: randomUUID(), roles: ['Teacher'] };
      const marker2 = { userId: randomUUID(), roles: ['Teacher'] };
      const moderator = { userId: randomUUID(), roles: ['Administrator'] };

      const first = await ops.recordDoubleEntry(
        tenantId,
        exam.id,
        { candidateId: registration.id, subjectId, entryNo: 1, marks: 72 },
        marker1,
      );
      expect(first.varianceFlag).toBe(false);

      const second = await ops.recordDoubleEntry(
        tenantId,
        exam.id,
        { candidateId: registration.id, subjectId, entryNo: 2, marks: 88, tolerance: 2 },
        marker2,
      );
      expect(second.varianceFlag).toBe(true);

      const pairBefore = await store.findMarksPair(
        tenantId,
        exam.id,
        registration.id,
        subjectId,
      );
      expect(pairBefore).toHaveLength(2);
      expect(pairBefore.every((e) => e.varianceFlag)).toBe(true);
      expect(pairBefore.map((e) => e.marks).sort()).toEqual([72, 88]);

      const resolved = await ops.resolveMarks(
        tenantId,
        exam.id,
        { candidateId: registration.id, subjectId, finalMarks: 80 },
        moderator,
      );
      expect(resolved.finalMarks).toBe(80);
      expect(resolved.resolved).toBe(true);

      const pairAfter = await store.findMarksPair(
        tenantId,
        exam.id,
        registration.id,
        subjectId,
      );
      expect(pairAfter.every((e) => e.finalMarks === 80)).toBe(true);
      expect(pairAfter.every((e) => e.resolvedBy === moderator.userId)).toBe(true);
    },
  );

  it.skipIf(!live)(
    'unique (tenant, exam, candidate, subject, entry_no) is enforced by Postgres',
    async () => {
      const tenantId = randomUUID();
      const repository = new InMemoryExaminationRepository();
      const store = new PgExamOpsStore(pool!);
      const exams = new ExaminationService(repository);
      const ops = new ExamOpsService({ store, examinations: repository });

      const studentId = randomUUID();
      repository.setStudentEnrollment({
        studentId,
        status: 'enrolled',
        institutionId: randomUUID(),
        completedSubjectCodes: ['MATH'],
      });
      const exam = await exams.create(tenantId, examBody());
      const subjectId = exam.subjects[0]!.id;
      const registration = await exams.registerCandidate(tenantId, exam.id, {
        studentId,
        centerId: exam.centers[0]!.id,
        subjectIds: [subjectId],
      });
      const marker = { userId: randomUUID(), roles: ['Teacher'] };

      await ops.recordDoubleEntry(
        tenantId,
        exam.id,
        { candidateId: registration.id, subjectId, entryNo: 1, marks: 60 },
        marker,
      );
      await expect(
        ops.recordDoubleEntry(
          tenantId,
          exam.id,
          { candidateId: registration.id, subjectId, entryNo: 1, marks: 61 },
          { userId: randomUUID(), roles: ['Teacher'] },
        ),
      ).rejects.toThrow();
    },
  );
});
