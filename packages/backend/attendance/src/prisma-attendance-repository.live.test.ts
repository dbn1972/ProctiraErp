/**
 * Live Postgres proof for {@link PrismaAttendanceRepository}'s raw-SQL-backed
 * methods added by this batch:
 *
 *  - PRC-M169: getInstitutionAttendanceConfig / getAbsenceThresholdConfig now
 *    read db/sql/231's new tables instead of hardcoding `null`.
 *  - PRC-L275: getClassRoster's `date` parameter now bounds the roster by
 *    enrollment window instead of being unused.
 *
 * Skipped without DATABASE_URL (no live Postgres reachable in this sandbox).
 */
import { randomUUID } from 'node:crypto';

import { createPrismaClient, getSharedPgPool, withPgTenant } from '@proctira/database';
import type { PrismaClient } from '@proctira/database';
import { ensurePgTestStudent, ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { afterAll, describe, expect, it } from 'vitest';

import { PrismaAttendanceRepository } from './prisma-attendance-repository.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'prisma-attendance-repository.live.test' });
const pool = DATABASE_URL ? getSharedPgPool(DATABASE_URL) : null;
const live = Boolean(DATABASE_URL) && pool !== null;

let prisma: PrismaClient | null = null;
function sharedPrisma(): PrismaClient {
  if (!prisma) prisma = createPrismaClient({ datasourceUrl: DATABASE_URL! });
  return prisma;
}

afterAll(async () => {
  await prisma?.$disconnect();
});

interface RosterFixture {
  tenantId: string;
  institutionId: string;
  academicPeriodId: string;
  gradeId: string;
  classId: string;
}

/** tenant -> area -> institution -> academic period -> grade -> class (the FK chain `enrollments` needs). */
async function seedRosterFixture(): Promise<RosterFixture> {
  const tenantId = randomUUID();
  const areaId = randomUUID();
  const institutionId = randomUUID();
  const academicPeriodId = randomUUID();
  const gradeId = randomUUID();
  const classId = randomUUID();
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
       VALUES ($1, $2, 'Attendance School', $3, $4, 'SCHOOL', 'PUBLIC', 'GOVERNMENT', 'active')`,
      [institutionId, tenantId, `ATT-${suffix}`, areaId],
    );
    await client.query(
      `INSERT INTO academic_periods (id, tenant_id, name, code, start_date, end_date, status)
       VALUES ($1, $2, 'AY 2026-27', $3, '2026-04-01', '2027-03-31', 'active')`,
      [academicPeriodId, tenantId, `AY-${suffix}`],
    );
    await client.query(
      `INSERT INTO grades (id, tenant_id, name, code, "order")
       VALUES ($1, $2, 'Grade 8', $3, 8)`,
      [gradeId, tenantId, `G8-${suffix}`],
    );
    await client.query(
      `INSERT INTO classes (id, tenant_id, institution_id, grade_id, academic_period_id, name, capacity)
       VALUES ($1, $2, $3, $4, $5, '8-A', 40)`,
      [classId, tenantId, institutionId, gradeId, academicPeriodId],
    );
  });
  return { tenantId, institutionId, academicPeriodId, gradeId, classId };
}

async function seedEnrollment(
  fx: RosterFixture,
  studentId: string,
  enrolledAt: string,
  exitedAt: string | null,
): Promise<void> {
  await ensurePgTestStudent(pool!, fx.tenantId, studentId);
  await withPgTenant(pool!, fx.tenantId, async (client) => {
    await client.query(
      `INSERT INTO enrollments
         (id, tenant_id, student_id, institution_id, grade_id, class_id,
          academic_period_id, status, enrolled_at, exited_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'ENROLLED', $8::date, $9::date)`,
      [
        randomUUID(),
        fx.tenantId,
        studentId,
        fx.institutionId,
        fx.gradeId,
        fx.classId,
        fx.academicPeriodId,
        enrolledAt,
        exitedAt,
      ],
    );
  });
}

describe('PrismaAttendanceRepository.getClassRoster (live) — PRC-L275', () => {
  it.skipIf(!live)(
    'excludes a student whose enrollment exited before the queried date',
    async () => {
      const fx = await seedRosterFixture();
      const stayed = randomUUID();
      const exited = randomUUID();
      await seedEnrollment(fx, stayed, '2026-04-01', null);
      await seedEnrollment(fx, exited, '2026-04-01', '2026-05-31');

      const repo = new PrismaAttendanceRepository(sharedPrisma());
      // Failing-first: before this fix `_date` was unused and both students
      // would appear regardless of the queried date.
      const roster = await repo.getClassRoster(
        fx.tenantId,
        fx.classId,
        fx.academicPeriodId,
        '2026-06-15',
      );
      const ids = roster.map((r) => r.studentId);
      expect(ids).toContain(stayed);
      expect(ids).not.toContain(exited);
    },
  );

  it.skipIf(!live)('excludes a student whose enrollment has not started yet', async () => {
    const fx = await seedRosterFixture();
    const current = randomUUID();
    const future = randomUUID();
    await seedEnrollment(fx, current, '2026-04-01', null);
    await seedEnrollment(fx, future, '2026-09-01', null);

    const repo = new PrismaAttendanceRepository(sharedPrisma());
    const roster = await repo.getClassRoster(
      fx.tenantId,
      fx.classId,
      fx.academicPeriodId,
      '2026-06-15',
    );
    const ids = roster.map((r) => r.studentId);
    expect(ids).toContain(current);
    expect(ids).not.toContain(future);
  });

  it.skipIf(!live)('includes a student on and after their exit date (inclusive bound)', async () => {
    const fx = await seedRosterFixture();
    const student = randomUUID();
    await seedEnrollment(fx, student, '2026-04-01', '2026-06-15');

    const repo = new PrismaAttendanceRepository(sharedPrisma());
    const onExitDay = await repo.getClassRoster(
      fx.tenantId,
      fx.classId,
      fx.academicPeriodId,
      '2026-06-15',
    );
    expect(onExitDay.map((r) => r.studentId)).toContain(student);

    const afterExit = await repo.getClassRoster(
      fx.tenantId,
      fx.classId,
      fx.academicPeriodId,
      '2026-06-16',
    );
    expect(afterExit.map((r) => r.studentId)).not.toContain(student);
  });
});

describe('PrismaAttendanceRepository config (live) — PRC-M169', () => {
  it.skipIf(!live)(
    'getInstitutionAttendanceConfig returns a configured recording_mode instead of null',
    async () => {
      const tenantId = randomUUID();
      const institutionId = randomUUID();
      await ensurePgTestTenant(pool!, tenantId);
      await withPgTenant(pool!, tenantId, async (client) => {
        await client.query(
          `INSERT INTO attendance_institution_config (tenant_id, institution_id, recording_mode)
           VALUES ($1, $2, 'subject')`,
          [tenantId, institutionId],
        );
        await client.query(
          `INSERT INTO attendance_leave_types (id, tenant_id, institution_id, code, name, is_active)
           VALUES ($1, $2, $3, 'SICK', 'Sick Leave', true)`,
          [randomUUID(), tenantId, institutionId],
        );
      });

      const repo = new PrismaAttendanceRepository(sharedPrisma());
      // Failing-first: before this fix this method always returned `null`
      // regardless of any row in the database.
      const config = await repo.getInstitutionAttendanceConfig(tenantId, institutionId);
      expect(config).not.toBeNull();
      expect(config?.recordingMode).toBe('subject');
      expect(config?.leaveTypes).toHaveLength(1);
      expect(config?.leaveTypes[0]?.code).toBe('SICK');
    },
  );

  it.skipIf(!live)('getInstitutionAttendanceConfig returns null for an unconfigured institution', async () => {
    const tenantId = randomUUID();
    const institutionId = randomUUID();
    await ensurePgTestTenant(pool!, tenantId);
    const repo = new PrismaAttendanceRepository(sharedPrisma());
    expect(await repo.getInstitutionAttendanceConfig(tenantId, institutionId)).toBeNull();
  });

  it.skipIf(!live)(
    'getAbsenceThresholdConfig returns the configured threshold instead of null',
    async () => {
      const tenantId = randomUUID();
      const institutionId = randomUUID();
      await ensurePgTestTenant(pool!, tenantId);
      await withPgTenant(pool!, tenantId, async (client) => {
        await client.query(
          `INSERT INTO attendance_absence_threshold_config
             (tenant_id, institution_id, threshold, evaluation_period_days, recipient_role_ids)
           VALUES ($1, $2, 5, 30, ARRAY['principal','registrar'])`,
          [tenantId, institutionId],
        );
      });

      const repo = new PrismaAttendanceRepository(sharedPrisma());
      const config = await repo.getAbsenceThresholdConfig(tenantId, institutionId);
      expect(config).not.toBeNull();
      expect(config?.threshold).toBe(5);
      expect(config?.evaluationPeriodDays).toBe(30);
      expect(config?.recipientRoleIds).toEqual(['principal', 'registrar']);
    },
  );

  it.skipIf(!live)('a second tenant cannot see the first tenant config rows (RLS)', async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const institutionId = randomUUID();
    await ensurePgTestTenant(pool!, tenantA);
    await ensurePgTestTenant(pool!, tenantB);
    await withPgTenant(pool!, tenantA, async (client) => {
      await client.query(
        `INSERT INTO attendance_institution_config (tenant_id, institution_id, recording_mode)
         VALUES ($1, $2, 'period')`,
        [tenantA, institutionId],
      );
    });

    const repo = new PrismaAttendanceRepository(sharedPrisma());
    expect(await repo.getInstitutionAttendanceConfig(tenantA, institutionId)).not.toBeNull();
    expect(await repo.getInstitutionAttendanceConfig(tenantB, institutionId)).toBeNull();
  });
});
