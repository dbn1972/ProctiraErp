/**
 * PRC-H094 — live Postgres: a student transfer is one transaction. A failing
 * destination insert (duplicate ENROLLED in the period) must leave the source
 * ENROLLED with no new history row and no transfer record.
 */
import { randomUUID } from 'node:crypto';
import { BusinessRuleError, ConflictError, EnrollmentStatus } from '@proctira/common';
import { getSharedPgPool, withPgTenant } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { describe, expect, it } from 'vitest';
import { EnrollmentService } from './enrollment-service.js';
import { PgEnrollmentRepository } from './pg-enrollment-repository.js';

const DATABASE_URL = requireLiveDatabaseUrl({
  suite: 'pg-enrollment-transfer-atomicity.live.test',
});
const pool = DATABASE_URL ? getSharedPgPool(DATABASE_URL) : null;
const live = Boolean(DATABASE_URL) && pool !== null;

interface Fixture {
  tenantId: string;
  studentId: string;
  srcInstitutionId: string;
  dstInstitutionId: string;
  gradeId: string;
  p1: string;
  p2: string;
  srcClassP1: string;
  dstClassP1: string;
  dstClassP2: string;
}

async function seed(): Promise<Fixture> {
  const fx: Fixture = {
    tenantId: randomUUID(),
    studentId: randomUUID(),
    srcInstitutionId: randomUUID(),
    dstInstitutionId: randomUUID(),
    gradeId: randomUUID(),
    p1: randomUUID(),
    p2: randomUUID(),
    srcClassP1: randomUUID(),
    dstClassP1: randomUUID(),
    dstClassP2: randomUUID(),
  };
  const areaId = randomUUID();
  const sfx = fx.tenantId.slice(0, 8);
  await ensurePgTestTenant(pool!, fx.tenantId);
  await withPgTenant(pool!, fx.tenantId, async (c) => {
    await c.query(
      `INSERT INTO geographic_areas (id, tenant_id, name, code, level, parent_id, path, lft, rgt)
       VALUES ($1, $2, 'Root', 'ROOT', 0, NULL, '/', 1, 2)`,
      [areaId, fx.tenantId],
    );
    for (const [id, code] of [
      [fx.srcInstitutionId, `SRC-${sfx}`],
      [fx.dstInstitutionId, `DST-${sfx}`],
    ] as const) {
      await c.query(
        `INSERT INTO institutions (id, tenant_id, name, code, area_id, type, sector, ownership, status)
         VALUES ($1, $2, $3, $3, $4, 'SCHOOL', 'PUBLIC', 'GOVERNMENT', 'active')`,
        [id, fx.tenantId, code, areaId],
      );
    }
    await c.query(
      `INSERT INTO academic_periods (id, tenant_id, name, code, start_date, end_date, status)
       VALUES ($1, $2, 'AY 1', $3, '2026-04-01', '2027-03-31', 'active'),
              ($4, $2, 'AY 2', $5, '2027-04-01', '2028-03-31', 'active')`,
      [fx.p1, fx.tenantId, `P1-${sfx}`, fx.p2, `P2-${sfx}`],
    );
    await c.query(
      `INSERT INTO grades (id, tenant_id, name, code, "order") VALUES ($1, $2, 'Grade 6', $3, 6)`,
      [fx.gradeId, fx.tenantId, `G6-${sfx}`],
    );
    for (const [id, inst, period] of [
      [fx.srcClassP1, fx.srcInstitutionId, fx.p1],
      [fx.dstClassP1, fx.dstInstitutionId, fx.p1],
      [fx.dstClassP2, fx.dstInstitutionId, fx.p2],
    ] as const) {
      await c.query(
        `INSERT INTO classes (id, tenant_id, institution_id, grade_id, academic_period_id, name, capacity)
         VALUES ($1, $2, $3, $4, $5, '6-A', 40)`,
        [id, fx.tenantId, inst, fx.gradeId, period],
      );
    }
    await c.query(
      `INSERT INTO students (id, tenant_id, first_name, last_name, date_of_birth, gender)
       VALUES ($1, $2, 'Transfer', 'Student', '2012-01-01', 'female')`,
      [fx.studentId, fx.tenantId],
    );
  });
  return fx;
}

async function counts(fx: Fixture): Promise<{ history: number; transfers: number }> {
  return withPgTenant(pool!, fx.tenantId, async (c) => {
    const h = await c.query(
      `SELECT COUNT(*)::int AS n FROM enrollment_history eh
         JOIN enrollments e ON e.id = eh.enrollment_id
        WHERE e.student_id = $1`,
      [fx.studentId],
    );
    const t = await c.query(
      `SELECT COUNT(*)::int AS n FROM transfer_records WHERE student_id = $1`,
      [fx.studentId],
    );
    return {
      history: Number((h.rows[0] as { n: number }).n),
      transfers: Number((t.rows[0] as { n: number }).n),
    };
  });
}

describe('PRC-H094 transfer atomicity (live Postgres)', () => {
  it.skipIf(!live)(
    'failed destination insert (duplicate ENROLLED) rolls back the source update',
    async () => {
      const fx = await seed();
      const repo = new PgEnrollmentRepository(pool!);
      const service = new EnrollmentService(repo);
      const source = await service.createEnrollment(fx.tenantId, {
        studentId: fx.studentId,
        institutionId: fx.srcInstitutionId,
        gradeId: fx.gradeId,
        classId: fx.srcClassP1,
        academicPeriodId: fx.p1,
        enrolledAt: '2026-04-01',
      });
      await service.createEnrollment(fx.tenantId, {
        studentId: fx.studentId,
        institutionId: fx.dstInstitutionId,
        gradeId: fx.gradeId,
        classId: fx.dstClassP2,
        academicPeriodId: fx.p2,
        enrolledAt: '2027-04-01',
      });
      const before = await counts(fx);
      const date = new Date('2026-06-01');
      const destinationId = randomUUID();
      // Bypass the service pre-check to force the DB unique index to fail mid-transaction.
      await expect(
        repo.transferEnrollment({
          tenantId: fx.tenantId,
          sourceEnrollmentId: source.id,
          expectedSourceStatus: EnrollmentStatus.ENROLLED,
          sourceUpdate: { status: EnrollmentStatus.TRANSFERRED, exitedAt: date },
          sourceHistory: { reason: 'forced failure', effectiveDate: date },
          destination: {
            id: destinationId,
            tenantId: fx.tenantId,
            studentId: fx.studentId,
            institutionId: fx.dstInstitutionId,
            gradeId: fx.gradeId,
            classId: fx.dstClassP2,
            academicPeriodId: fx.p2,
            status: EnrollmentStatus.ENROLLED,
            enrolledAt: date,
            exitedAt: null,
          },
          destinationHistory: { reason: 'forced failure', effectiveDate: date },
          transfer: {
            id: randomUUID(),
            tenantId: fx.tenantId,
            studentId: fx.studentId,
            sourceInstitutionId: fx.srcInstitutionId,
            sourceEnrollmentId: source.id,
            destinationInstitutionId: fx.dstInstitutionId,
            destinationEnrollmentId: destinationId,
            transferDate: date,
            reason: 'forced failure',
          },
        }),
      ).rejects.toBeInstanceOf(ConflictError);
      const after = await repo.findEnrollmentById(source.id, fx.tenantId);
      expect(after?.status).toBe(EnrollmentStatus.ENROLLED);
      expect(after?.exitedAt).toBeNull();
      expect(await counts(fx)).toEqual(before);
    },
  );

  it.skipIf(!live)('service transfer commits source, destination and record together', async () => {
    const fx = await seed();
    const repo = new PgEnrollmentRepository(pool!);
    const service = new EnrollmentService(repo);
    const source = await service.createEnrollment(fx.tenantId, {
      studentId: fx.studentId,
      institutionId: fx.srcInstitutionId,
      gradeId: fx.gradeId,
      classId: fx.srcClassP1,
      academicPeriodId: fx.p1,
      enrolledAt: '2026-04-01',
    });
    const before = await counts(fx);
    const result = await service.transferStudent(fx.tenantId, {
      studentId: fx.studentId,
      sourceEnrollmentId: source.id,
      destinationInstitutionId: fx.dstInstitutionId,
      destinationGradeId: fx.gradeId,
      destinationClassId: fx.dstClassP1,
      academicPeriodId: fx.p1,
      transferDate: '2026-06-01',
      reason: 'Relocation',
    });
    expect(result.sourceEnrollment.status).toBe(EnrollmentStatus.TRANSFERRED);
    expect(result.destinationEnrollment.status).toBe(EnrollmentStatus.ENROLLED);
    const after = await counts(fx);
    expect(after.transfers).toBe(before.transfers + 1);
    expect(after.history).toBe(before.history + 2);
  });

  it.skipIf(!live)(
    'destination class outside the destination institution is rejected with no writes',
    async () => {
      const fx = await seed();
      const repo = new PgEnrollmentRepository(pool!);
      const service = new EnrollmentService(repo);
      const source = await service.createEnrollment(fx.tenantId, {
        studentId: fx.studentId,
        institutionId: fx.srcInstitutionId,
        gradeId: fx.gradeId,
        classId: fx.srcClassP1,
        academicPeriodId: fx.p1,
        enrolledAt: '2026-04-01',
      });
      const before = await counts(fx);
      await expect(
        service.transferStudent(fx.tenantId, {
          studentId: fx.studentId,
          sourceEnrollmentId: source.id,
          destinationInstitutionId: fx.dstInstitutionId,
          destinationGradeId: fx.gradeId,
          destinationClassId: fx.srcClassP1, // belongs to the source institution
          academicPeriodId: fx.p1,
          transferDate: '2026-06-01',
          reason: 'Relocation',
        }),
      ).rejects.toBeInstanceOf(BusinessRuleError);
      expect((await repo.findEnrollmentById(source.id, fx.tenantId))?.status).toBe(
        EnrollmentStatus.ENROLLED,
      );
      expect(await counts(fx)).toEqual(before);
    },
  );
});
