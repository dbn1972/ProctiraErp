/**
 * W3-RACE-02 — live Postgres invariants for enrollment uniqueness (B3).
 * Partial unique index uq_enrollments_active_student_period plus service guard.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ConflictError } from '@proctira/common';
import { getSharedPgPool, withPgTenant } from '@proctira/database';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { describe, expect, it } from 'vitest';

import { EnrollmentService } from './enrollment-service.js';
import { PgEnrollmentRepository } from './pg-enrollment-repository.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'pg-enrollment-uniqueness.live.test' });
const pool = DATABASE_URL ? getSharedPgPool(DATABASE_URL) : null;
const live = Boolean(DATABASE_URL) && pool !== null;

let indexEnsured = false;

async function ensureEnrollmentUniquenessIndex(): Promise<void> {
  if (!pool || indexEnsured) return;
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
  const sql = readFileSync(
    path.join(root, 'db/sql/065_enrollment_active_uniqueness.sql'),
    'utf8',
  );
  await pool.query(sql);
  indexEnsured = true;
}

interface EnrollmentFixture {
  tenantId: string;
  studentId: string;
  institutionId: string;
  gradeId: string;
  classId: string;
  academicPeriodId: string;
}

async function seedEnrollmentFixture(): Promise<EnrollmentFixture> {
  const tenantId = randomUUID();
  const areaId = randomUUID();
  const institutionId = randomUUID();
  const academicPeriodId = randomUUID();
  const gradeId = randomUUID();
  const classId = randomUUID();
  const studentId = randomUUID();
  const suffix = tenantId.slice(0, 8);

  await withPgTenant(pool!, tenantId, async (client) => {
    await client.query(
      `INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [tenantId, `enrollment-uniq-${suffix}`, `enrollment-uniq-${tenantId}`],
    );
    await client.query(
      `INSERT INTO geographic_areas (id, tenant_id, name, code, level, parent_id, path, lft, rgt)
       VALUES ($1, $2, 'Root', 'ROOT', 0, NULL, '/', 1, 2)`,
      [areaId, tenantId],
    );
    await client.query(
      `INSERT INTO institutions (id, tenant_id, name, code, area_id, type, sector, ownership, status)
       VALUES ($1, $2, 'Enrollment School', $3, $4, 'SCHOOL', 'PUBLIC', 'GOVERNMENT', 'active')`,
      [institutionId, tenantId, `ENR-${suffix}`, areaId],
    );
    await client.query(
      `INSERT INTO academic_periods (id, tenant_id, name, code, start_date, end_date, status)
       VALUES ($1, $2, 'AY 2026-27', $3, '2026-04-01', '2027-03-31', 'active')`,
      [academicPeriodId, tenantId, `AY-${suffix}`],
    );
    await client.query(
      `INSERT INTO grades (id, tenant_id, name, code, "order")
       VALUES ($1, $2, 'Grade 6', $3, 6)`,
      [gradeId, tenantId, `G6-${suffix}`],
    );
    await client.query(
      `INSERT INTO classes (id, tenant_id, institution_id, grade_id, academic_period_id, name, capacity)
       VALUES ($1, $2, $3, $4, $5, '6-A', 40)`,
      [classId, tenantId, institutionId, gradeId, academicPeriodId],
    );
    await client.query(
      `INSERT INTO students (id, tenant_id, first_name, last_name, date_of_birth, gender)
       VALUES ($1, $2, 'Live', 'Student', '2012-01-01', 'female')`,
      [studentId, tenantId],
    );
  });

  return {
    tenantId,
    studentId,
    institutionId,
    gradeId,
    classId,
    academicPeriodId,
  };
}

describe('enrollment uniqueness (live Postgres)', () => {
  it.skipIf(!live)(
    'EnrollmentService rejects a second active enrollment for the same student/period',
    async () => {
      await ensureEnrollmentUniquenessIndex();
      const fx = await seedEnrollmentFixture();
      const repo = new PgEnrollmentRepository(pool!);
      const service = new EnrollmentService(repo);

      const input = {
        studentId: fx.studentId,
        institutionId: fx.institutionId,
        gradeId: fx.gradeId,
        classId: fx.classId,
        academicPeriodId: fx.academicPeriodId,
        enrolledAt: '2026-04-01',
      };

      await service.createEnrollment(fx.tenantId, input);
      await expect(service.createEnrollment(fx.tenantId, input)).rejects.toThrow(ConflictError);
    },
  );

  it.skipIf(!live)(
    'concurrent ENROLLED inserts: Postgres partial unique index allows only one row',
    async () => {
      await ensureEnrollmentUniquenessIndex();
      const fx = await seedEnrollmentFixture();
      const idA = randomUUID();
      const idB = randomUUID();

      const insert = (id: string) =>
        withPgTenant(pool!, fx.tenantId, (client) =>
          client.query(
            `INSERT INTO enrollments (
               id, tenant_id, student_id, institution_id, grade_id, class_id,
               academic_period_id, status, enrolled_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,'ENROLLED',$8::date)`,
            [
              id,
              fx.tenantId,
              fx.studentId,
              fx.institutionId,
              fx.gradeId,
              fx.classId,
              fx.academicPeriodId,
              '2026-04-01',
            ],
          ),
        );

      const results = await Promise.allSettled([insert(idA), insert(idB)]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: '23505' });

      const count = await withPgTenant(pool!, fx.tenantId, async (client) => {
        const row = await client.query(
          `SELECT COUNT(*)::int AS count FROM enrollments
             WHERE tenant_id = $1 AND student_id = $2 AND academic_period_id = $3
               AND status = 'ENROLLED'::enrollment_status`,
          [fx.tenantId, fx.studentId, fx.academicPeriodId],
        );
        return Number((row.rows[0] as { count: number }).count);
      });
      expect(count).toBe(1);
    },
  );
});
