/**
 * PRC-M234 — live Postgres: prerequisite-subject eligibility must not
 * fail open. `PrismaExaminationRepository.getStudentEnrollment` used to
 * hard-code `completedSubjectCodes: null`, which made
 * `ExaminationService.validateCandidateEligibility` skip the
 * prerequisite-completion rule entirely against real Postgres — any
 * student could register for any examination regardless of prior subject
 * completion. This now resolves completed subjects from
 * `examination_academic_records` (passed rows), joined back to the
 * originating examination's JSONB `subjects` array for the subject code.
 */
import { randomUUID } from 'node:crypto';

import { getSharedPgPool, withPgTenant } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { describe, expect, it } from 'vitest';

import { ExaminationService } from './examination-service.js';
import { createExaminationRepository } from './repository-factory.js';
import type { CreateExaminationInput } from './schemas.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'pg-eligibility-prerequisite.live.test' });
const pool = DATABASE_URL ? getSharedPgPool(DATABASE_URL) : null;
const live = Boolean(DATABASE_URL) && pool !== null;

function futureDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function examBody(subjectCode: string): CreateExaminationInput {
  return {
    name: 'Prerequisite Live Exam',
    code: `PR-${randomUUID().slice(0, 8).toUpperCase()}`,
    academicPeriodId: randomUUID(),
    startDate: futureDate(7),
    endDate: futureDate(9),
    subjects: [{ name: 'Advanced Mathematics', code: subjectCode, maxScore: 100 }],
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

interface EnrollmentFixture {
  tenantId: string;
  studentId: string;
  institutionId: string;
}

/** Minimal parent chain so `enrollments` FKs resolve (mirrors pg-enrollment-uniqueness.live.test.ts). */
async function seedEnrolledStudent(): Promise<EnrollmentFixture> {
  const tenantId = randomUUID();
  const areaId = randomUUID();
  const institutionId = randomUUID();
  const academicPeriodId = randomUUID();
  const gradeId = randomUUID();
  const classId = randomUUID();
  const studentId = randomUUID();
  const suffix = tenantId.slice(0, 8);

  await ensurePgTestTenant(pool!, tenantId);
  await withPgTenant(pool!, tenantId, async (client) => {
    await client.query(
      `INSERT INTO geographic_areas (id, tenant_id, name, code, level, parent_id, path, lft, rgt)
       VALUES ($1, $2, 'Root', 'ROOT', 0, NULL, '/', 1, 2)`,
      [areaId, tenantId],
    );
    await client.query(
      `INSERT INTO institutions (id, tenant_id, name, code, area_id, type, sector, ownership, status)
       VALUES ($1, $2, 'Eligibility School', $3, $4, 'SCHOOL', 'PUBLIC', 'GOVERNMENT', 'active')`,
      [institutionId, tenantId, `ELG-${suffix}`, areaId],
    );
    await client.query(
      `INSERT INTO academic_periods (id, tenant_id, name, code, start_date, end_date, status)
       VALUES ($1, $2, 'AY 2026-27', $3, '2026-04-01', '2027-03-31', 'active')`,
      [academicPeriodId, tenantId, `AY-${suffix}`],
    );
    await client.query(
      `INSERT INTO grades (id, tenant_id, name, code, "order")
       VALUES ($1, $2, 'Grade 10', $3, 10)`,
      [gradeId, tenantId, `G10-${suffix}`],
    );
    await client.query(
      `INSERT INTO classes (id, tenant_id, institution_id, grade_id, academic_period_id, name, capacity)
       VALUES ($1, $2, $3, $4, $5, '10-A', 40)`,
      [classId, tenantId, institutionId, gradeId, academicPeriodId],
    );
    await client.query(
      `INSERT INTO students (id, tenant_id, first_name, last_name, date_of_birth, gender)
       VALUES ($1, $2, 'Live', 'Candidate', '2010-01-01', 'female')`,
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

  return { tenantId, studentId, institutionId };
}

describe('candidate eligibility prerequisite completion (live Postgres, PRC-M234)', () => {
  it.skipIf(!live)(
    'rejects registration when the student has zero completed prerequisite subjects',
    async () => {
      const fx = await seedEnrolledStudent();
      const repository = createExaminationRepository({ databaseUrl: DATABASE_URL! });
      const service = new ExaminationService(repository);

      const exam = await service.create(fx.tenantId, examBody('ADV-MATH'));

      await expect(
        service.registerCandidate(fx.tenantId, exam.id, {
          studentId: fx.studentId,
          centerId: exam.centers[0]!.id,
          subjectIds: [exam.subjects[0]!.id],
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        errors: [expect.objectContaining({ field: 'prerequisiteSubjects' })],
      });
    },
  );

  it.skipIf(!live)(
    'allows registration once a passed examination_academic_records row exists for the subject code',
    async () => {
      const fx = await seedEnrolledStudent();
      const repository = createExaminationRepository({ databaseUrl: DATABASE_URL! });
      const service = new ExaminationService(repository);

      // A prior examination the student already passed ADV-MATH in.
      const priorExam = await service.create(fx.tenantId, examBody('ADV-MATH'));
      const priorSubjectId = priorExam.subjects[0]!.id;
      await withPgTenant(pool!, fx.tenantId, (client) =>
        client.query(
          `INSERT INTO examination_academic_records
             (tenant_id, student_id, examination_id, subject_id, score, grade, passed, published_at)
           VALUES ($1,$2,$3,$4,85,'A',true, now())`,
          [fx.tenantId, fx.studentId, priorExam.id, priorSubjectId],
        ),
      );

      const exam = await service.create(fx.tenantId, examBody('ADV-MATH'));
      const registration = await service.registerCandidate(fx.tenantId, exam.id, {
        studentId: fx.studentId,
        centerId: exam.centers[0]!.id,
        subjectIds: [exam.subjects[0]!.id],
      });
      expect(registration.studentId).toBe(fx.studentId);
    },
  );
});
