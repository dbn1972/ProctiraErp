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
import { createExaminationRepository, createResultRepository } from './repository-factory.js';
import { ResultPublicationService } from './result-publication-service.js';
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
    'rejects registration when the student attempted the subject before but never passed it',
    async () => {
      // PRC-M234 follow-up: this scenario used to be "zero completed
      // prerequisite subjects, zero history at all" -- but that is a
      // student's first-ever attempt at the subject, which the bootstrap
      // exemption now correctly allows (see "a student can register, pass,
      // and publish a subject for the very first time" below and
      // examination-service.test.ts's two new bootstrap-exemption cases).
      // The rule must still reject a student who HAS attempted the subject
      // before and failed/never completed it -- a real prior attempt with
      // no passed record, not a brand-new attempt.
      const fx = await seedEnrolledStudent();
      const repository = createExaminationRepository({ databaseUrl: DATABASE_URL! });
      const service = new ExaminationService(repository);

      const priorExam = await service.create(fx.tenantId, examBody('ADV-MATH'));
      await service.registerCandidate(fx.tenantId, priorExam.id, {
        studentId: fx.studentId,
        centerId: priorExam.centers[0]!.id,
        subjectIds: [priorExam.subjects[0]!.id],
      });
      // No marks/publish for priorExam: the student attempted ADV-MATH (has a
      // registration) but has no passed examination_academic_records row.

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

  /**
   * PRC-M234 follow-up: the fix above makes completedSubjectCodes real
   * against Postgres, which exposed a second, pre-existing bug the rule
   * never had to answer for while it was fail-open — "every exam subject
   * must already be completed" is circular on a student's first-ever
   * attempt at that subject, since even the FIRST exam that teaches it also
   * demands it already be completed. This drives the real
   * register -> marks -> publish -> re-register pipeline end to end
   * (no direct SQL seed) to prove the bootstrap exemption actually closes
   * the gap, not just in the unit-test fixture.
   */
  it.skipIf(!live)(
    'a student can register, pass, and publish a subject for the very first time, through the real pipeline',
    async () => {
      const fx = await seedEnrolledStudent();
      const repository = createExaminationRepository({ databaseUrl: DATABASE_URL! });
      const resultRepository = createResultRepository({ databaseUrl: DATABASE_URL! });
      const service = new ExaminationService(repository);
      const publicationService = new ResultPublicationService(repository, resultRepository);

      const firstExam = await service.create(fx.tenantId, examBody('FIRST-TIME'));
      await service.update(fx.tenantId, firstExam.id, { status: 'SCHEDULED' });
      const subjectId = firstExam.subjects[0]!.id;
      const centerId = firstExam.centers[0]!.id;

      // The student has never attempted FIRST-TIME before -- this must succeed,
      // not be rejected as "has not completed prerequisite subjects".
      await service.registerCandidate(fx.tenantId, firstExam.id, {
        studentId: fx.studentId,
        centerId,
        subjectIds: [subjectId],
      });

      await publicationService.recordMarks(fx.tenantId, firstExam.id, {
        entries: [{ studentId: fx.studentId, marks: [{ subjectId, score: 85 }] }],
      });
      await service.update(fx.tenantId, firstExam.id, { status: 'IN_PROGRESS' });
      await publicationService.publishResults(fx.tenantId, firstExam.id);

      // A second FIRST-TIME exam now requires the (now-completed) prerequisite
      // and must succeed via completedSubjectCodes, same as the direct-SQL test above.
      const secondExam = await service.create(fx.tenantId, examBody('FIRST-TIME'));
      const registration = await service.registerCandidate(fx.tenantId, secondExam.id, {
        studentId: fx.studentId,
        centerId: secondExam.centers[0]!.id,
        subjectIds: [secondExam.subjects[0]!.id],
      });
      expect(registration.studentId).toBe(fx.studentId);
    },
  );
});
