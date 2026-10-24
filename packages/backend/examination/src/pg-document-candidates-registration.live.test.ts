/**
 * PRC-M510 (registration-join bug) — live Postgres: admit cards (and every
 * other `getDocumentCandidates` consumer) must include every registered
 * student, not just the ones with an `examination_candidates` row (created
 * only once marks exist). `PrismaDocumentRepository.getDocumentCandidates`
 * used to drive its row set from `examination_candidates`, so a registered
 * student who had not yet been marked silently disappeared — printing admit
 * cards straight after registration would drop them entirely.
 */
import { randomUUID } from 'node:crypto';

import { getSharedPgPool, withPgTenant } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { describe, expect, it } from 'vitest';

import { ExaminationService } from './examination-service.js';
import {
  createDocumentRepository,
  createExaminationRepository,
  createResultRepository,
} from './repository-factory.js';
import type { CreateExaminationInput } from './schemas.js';

const DATABASE_URL = requireLiveDatabaseUrl({
  suite: 'pg-document-candidates-registration.live.test',
});
const pool = DATABASE_URL ? getSharedPgPool(DATABASE_URL) : null;
const live = Boolean(DATABASE_URL) && pool !== null;

function futureDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function examBody(): CreateExaminationInput {
  return {
    name: 'Registration Join Live Exam',
    code: `RJ-${randomUUID().slice(0, 8).toUpperCase()}`,
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

/** Minimal parent chain so `enrollments` FKs resolve + registerCandidate's eligibility read succeeds. */
async function seedEnrolledStudent(tenantId: string, institutionId: string): Promise<string> {
  const studentId = randomUUID();
  const areaId = randomUUID();
  const academicPeriodId = randomUUID();
  const gradeId = randomUUID();
  const classId = randomUUID();
  const suffix = studentId.slice(0, 8);

  await withPgTenant(pool!, tenantId, async (client) => {
    await client.query(
      `INSERT INTO geographic_areas (id, tenant_id, name, code, level, parent_id, path, lft, rgt)
       VALUES ($1, $2, 'Root', $3, 0, NULL, '/', 1, 2)`,
      [areaId, tenantId, `ROOT-${suffix}`],
    );
    await client.query(
      `INSERT INTO institutions (id, tenant_id, name, code, area_id, type, sector, ownership, status)
       VALUES ($1, $2, 'Doc Candidates School', $3, $4, 'SCHOOL', 'PUBLIC', 'GOVERNMENT', 'active')
       ON CONFLICT (id) DO NOTHING`,
      [institutionId, tenantId, `DOC-${suffix}`, areaId],
    );
    await client.query(
      `INSERT INTO academic_periods (id, tenant_id, name, code, start_date, end_date, status)
       VALUES ($1, $2, 'AY 2026-27', $3, '2026-04-01', '2027-03-31', 'active')`,
      [academicPeriodId, tenantId, `AY-${suffix}`],
    );
    await client.query(
      `INSERT INTO grades (id, tenant_id, name, code, "order")
       VALUES ($1, $2, 'Grade 9', $3, 9)`,
      [gradeId, tenantId, `G9-${suffix}`],
    );
    await client.query(
      `INSERT INTO classes (id, tenant_id, institution_id, grade_id, academic_period_id, name, capacity)
       VALUES ($1, $2, $3, $4, $5, '9-A', 40)`,
      [classId, tenantId, institutionId, gradeId, academicPeriodId],
    );
    await client.query(
      `INSERT INTO students (id, tenant_id, first_name, last_name, date_of_birth, gender)
       VALUES ($1, $2, 'Live', 'Candidate', '2011-01-01', 'female')`,
      [studentId, tenantId],
    );
    await client.query(
      `INSERT INTO enrollments
         (id, tenant_id, student_id, institution_id, grade_id, class_id, academic_period_id, status, enrolled_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'ENROLLED',$8::date)`,
      [
        randomUUID(),
        tenantId,
        studentId,
        institutionId,
        gradeId,
        classId,
        academicPeriodId,
        '2026-04-01',
      ],
    );
  });
  return studentId;
}

describe('getDocumentCandidates registration join (live Postgres, PRC-M510)', () => {
  it.skipIf(!live)(
    'returns every registered student, including one with zero examination_candidates rows',
    async () => {
      const tenantId = randomUUID();
      const institutionId = randomUUID();
      await ensurePgTestTenant(pool!, tenantId);
      const markedStudentId = await seedEnrolledStudent(tenantId, institutionId);
      const unmarkedStudentId = await seedEnrolledStudent(tenantId, institutionId);

      const examRepo = createExaminationRepository({ databaseUrl: DATABASE_URL! });
      const resultRepo = createResultRepository({ databaseUrl: DATABASE_URL! });
      const exams = new ExaminationService(examRepo, resultRepo);
      // Shares the same cached Prisma client as examRepo/resultRepo (repository-factory.ts
      // caches per databaseUrl), so no second pool is opened.
      const docRepo = createDocumentRepository({ databaseUrl: DATABASE_URL! });

      const exam = await exams.create(tenantId, examBody());
      const subjectId = exam.subjects[0]!.id;
      const centerId = exam.centers[0]!.id;

      // PRC-M234: eligibility now enforces prerequisite completion against
      // examination_academic_records — seed a passed record for both
      // students so registration succeeds (this test is about the
      // registration-join bug, not eligibility).
      await withPgTenant(pool!, tenantId, (client) =>
        client.query(
          `INSERT INTO examination_academic_records
             (tenant_id, student_id, examination_id, subject_id, score, grade, passed, published_at)
           VALUES ($1,$2,$3,$4,85,'A',true, now()), ($1,$5,$3,$4,85,'A',true, now())`,
          [tenantId, markedStudentId, exam.id, subjectId, unmarkedStudentId],
        ),
      );

      const markedRegistration = await exams.registerCandidate(tenantId, exam.id, {
        studentId: markedStudentId,
        centerId,
        subjectIds: [subjectId],
      });
      const unmarkedRegistration = await exams.registerCandidate(tenantId, exam.id, {
        studentId: unmarkedStudentId,
        centerId,
        subjectIds: [subjectId],
      });

      // Only the marked student gets an examination_candidates row (marks entry).
      await resultRepo.upsertCandidates(tenantId, [
        {
          id: randomUUID(),
          examinationId: exam.id,
          studentId: markedStudentId,
          centerId,
          gender: 'other',
          areaId: '00000000-0000-0000-0000-000000000000',
          subjectResults: [{ candidateId: '', subjectId, score: 72, isComplete: true }],
        },
      ]);

      const candidates = await docRepo.getDocumentCandidates(exam.id, tenantId);
      const studentIds = candidates.map((c) => c.studentId).sort();
      expect(studentIds).toEqual([markedStudentId, unmarkedStudentId].sort());
      const unmarked = candidates.find((c) => c.studentId === unmarkedStudentId);
      expect(unmarked).toBeDefined();
      expect(unmarked!.id).toBe(unmarkedRegistration.id);
      const marked = candidates.find((c) => c.studentId === markedStudentId);
      expect(marked).toBeDefined();
      expect(marked!.studentId).toBe(markedRegistration.studentId);
    },
  );
});
