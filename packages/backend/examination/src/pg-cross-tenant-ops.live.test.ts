/**
 * PRC-M620 — live Postgres: exam_sessions / exam_marks_entries /
 * examination_candidates must be isolated by real row-level security, not
 * just the in-memory repository's tenant filter already exercised by
 * cross-tenant-authz.test.ts. Tenant B creates a session, double-enters
 * marks, and gets an examination_candidates row (via recordMarks); tenant A
 * (a different tenantId) must see none of it through PgExamOpsStore /
 * PrismaResultRepository, which bind `app.tenant_id` via withPgTenant on
 * every query.
 */
import { randomUUID } from 'node:crypto';

import { getSharedPgPool } from '@proctira/database';
import { ensurePgTestStudent, ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { describe, expect, it } from 'vitest';

import { ExaminationService } from './examination-service.js';
import { InMemoryExaminationRepository } from './in-memory-repository.js';
import { ExamOpsService } from './ops-service.js';
import { PgExamOpsStore } from './ops-store.js';
import { createResultRepository } from './repository-factory.js';
import type { CreateExaminationInput } from './schemas.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'pg-cross-tenant-ops.live.test' });
const pool = DATABASE_URL ? getSharedPgPool(DATABASE_URL) : null;
const live = Boolean(DATABASE_URL) && pool !== null;

function futureDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function examBody(): CreateExaminationInput {
  return {
    name: 'Cross-Tenant Ops Live Exam',
    code: `CTO-${randomUUID().slice(0, 8).toUpperCase()}`,
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

describe('cross-tenant ops isolation under real RLS (live Postgres, PRC-M620)', () => {
  it.skipIf(!live)(
    'tenant A sees no rows of tenant B exam_sessions/exam_marks_entries/examination_candidates',
    async () => {
      const tenantA = randomUUID();
      const tenantB = randomUUID();
      await ensurePgTestTenant(pool!, tenantA);
      const studentId = randomUUID();
      await ensurePgTestStudent(pool!, tenantB, studentId);

      // Exam shells stay in-memory (per-tenant repository instance), same as
      // pg-exam-marks.live.test.ts; only the ops store and result repository
      // (the tables with RLS) are shared Postgres connections.
      const repoB = new InMemoryExaminationRepository();
      const examsB = new ExaminationService(repoB);
      const storeB = new PgExamOpsStore(pool!);
      const opsB = new ExamOpsService({ store: storeB, examinations: repoB });

      repoB.setStudentEnrollment({
        studentId,
        status: 'enrolled',
        institutionId: randomUUID(),
        completedSubjectCodes: ['MATH'],
      });

      const exam = await examsB.create(tenantB, examBody());
      const subjectId = exam.subjects[0]!.id;
      const centerId = exam.centers[0]!.id;
      const registration = await examsB.registerCandidate(tenantB, exam.id, {
        studentId,
        centerId,
        subjectIds: [subjectId],
      });

      const actor = { userId: randomUUID(), roles: ['Administrator'] };
      const session = await opsB.createSession(
        tenantB,
        exam.id,
        {
          subjectId,
          date: futureDate(8),
          startTime: '09:00',
          endTime: '11:00',
          roomId: 'HALL-B',
          centerId,
        },
        actor,
      );
      if (!session.ok) throw new Error('session creation unexpectedly conflicted');

      const marker1 = { userId: randomUUID(), roles: ['Teacher'] };
      const marker2 = { userId: randomUUID(), roles: ['Teacher'] };
      await opsB.recordDoubleEntry(
        tenantB,
        exam.id,
        { candidateId: registration.id, subjectId, entryNo: 1, marks: 70 },
        marker1,
      );
      await opsB.recordDoubleEntry(
        tenantB,
        exam.id,
        { candidateId: registration.id, subjectId, entryNo: 2, marks: 71 },
        marker2,
      );

      const resultRepoB = createResultRepository({ databaseUrl: DATABASE_URL! });
      await resultRepoB.upsertCandidates(tenantB, [
        {
          id: randomUUID(),
          examinationId: exam.id,
          studentId,
          centerId,
          gender: 'other',
          areaId: '00000000-0000-0000-0000-000000000000',
          subjectResults: [{ candidateId: '', subjectId, score: 70, isComplete: true }],
        },
      ]);

      // --- Tenant A reads scoped to exam.id (which it never created). ---
      const repoA = new InMemoryExaminationRepository();
      const storeA = new PgExamOpsStore(pool!);
      const resultRepoA = createResultRepository({ databaseUrl: DATABASE_URL! });

      expect(await storeA.listSessions(tenantA, exam.id)).toHaveLength(0);
      expect(await storeA.findSession(tenantA, session.session.id)).toBeNull();
      expect(await storeA.listMarksEntries(tenantA, exam.id)).toHaveLength(0);
      expect(await storeA.findMarksPair(tenantA, exam.id, registration.id, subjectId)).toHaveLength(
        0,
      );
      const candidatesA = await resultRepoA.getCandidates(exam.id, tenantA);
      expect(candidatesA).toHaveLength(0);

      // --- Tenant B's own reads are unaffected (still see everything). ---
      expect(await storeB.listSessions(tenantB, exam.id)).toHaveLength(1);
      expect(await storeB.findSession(tenantB, session.session.id)).not.toBeNull();
      const marksB = await storeB.listMarksEntries(tenantB, exam.id);
      expect(marksB).toHaveLength(2);
      const candidatesB = await resultRepoB.getCandidates(exam.id, tenantB);
      expect(candidatesB).toHaveLength(1);
      expect(candidatesB[0]!.studentId).toBe(studentId);

      // ExamOpsService built against tenant A's own (empty) in-memory exam
      // repository must 404 — the examination itself does not exist for A,
      // which is the same real-world shape as the HTTP routes returning 404.
      const opsA = new ExamOpsService({ store: storeA, examinations: repoA });
      await expect(opsA.listSessions(tenantA, exam.id)).rejects.toThrow(/not found/i);
    },
  );
});
