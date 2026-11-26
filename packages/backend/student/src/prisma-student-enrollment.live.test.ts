/**
 * Live Postgres proof for the enrollment-backed parts of
 * {@link PrismaStudentRepository.list}.
 *
 *  - PRC-M148: `gradeId` / `enrollmentStatus` (and `institutionId`) filter on one
 *    enrollment row. Before the fix the relation filter named a `deletedAt`
 *    column the enrollments table does not have, and grade/status were ignored.
 *  - PRC-M031: list / findById return the current placement (institution, grade
 *    and class ids plus grade and class names) so the mobile roster can filter by
 *    class. Before the fix no class or grade field existed on the student.
 *
 * Skipped without DATABASE_URL (loud warning; CI's live gate forbids the skip).
 */
import { randomUUID } from 'node:crypto';

import { createPrismaClient, getSharedPgPool, withPgTenant } from '@proctira/database';
import type { PrismaClient } from '@proctira/database';
import { ensurePgTestStudent, ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaStudentRepository } from './prisma-student-repository.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'prisma-student-enrollment.live.test' });
const pool = DATABASE_URL ? getSharedPgPool(DATABASE_URL) : null;
const live = Boolean(DATABASE_URL) && pool !== null;

let prisma: PrismaClient | null = null;

interface Fixture {
  tenantId: string;
  institutionId: string;
  academicPeriodId: string;
  grade5: string;
  grade6: string;
  class5A: string;
  class6A: string;
}

/** tenant -> area -> institution -> period -> grades -> classes (the FK chain enrollments need). */
async function seedFixture(): Promise<Fixture> {
  const tenantId = randomUUID();
  const areaId = randomUUID();
  const fx: Fixture = {
    tenantId,
    institutionId: randomUUID(),
    academicPeriodId: randomUUID(),
    grade5: randomUUID(),
    grade6: randomUUID(),
    class5A: randomUUID(),
    class6A: randomUUID(),
  };
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
       VALUES ($1, $2, 'Student School', $3, $4, 'SCHOOL', 'PUBLIC', 'GOVERNMENT', 'active')`,
      [fx.institutionId, tenantId, `STU-${suffix}`, areaId],
    );
    await client.query(
      `INSERT INTO academic_periods (id, tenant_id, name, code, start_date, end_date, status)
       VALUES ($1, $2, 'AY 2026-27', $3, '2026-04-01', '2027-03-31', 'active')`,
      [fx.academicPeriodId, tenantId, `AY-${suffix}`],
    );
    for (const [id, name, order] of [
      [fx.grade5, 'Grade 5', 5],
      [fx.grade6, 'Grade 6', 6],
    ] as const) {
      await client.query(
        `INSERT INTO grades (id, tenant_id, name, code, "order") VALUES ($1, $2, $3, $4, $5)`,
        [id, tenantId, name, `G${order}-${suffix}`, order],
      );
    }
    for (const [id, gradeId, name] of [
      [fx.class5A, fx.grade5, '5-A'],
      [fx.class6A, fx.grade6, '6-A'],
    ] as const) {
      await client.query(
        `INSERT INTO classes (id, tenant_id, institution_id, grade_id, academic_period_id, name, capacity)
         VALUES ($1, $2, $3, $4, $5, $6, 40)`,
        [id, tenantId, fx.institutionId, gradeId, fx.academicPeriodId, name],
      );
    }
  });
  return fx;
}

async function enroll(
  fx: Fixture,
  firstName: string,
  gradeId: string,
  classId: string,
  status: 'ENROLLED' | 'WITHDRAWN',
): Promise<string> {
  const studentId = randomUUID();
  await ensurePgTestStudent(pool!, fx.tenantId, studentId);
  await withPgTenant(pool!, fx.tenantId, async (client) => {
    await client.query(`UPDATE students SET first_name = $2 WHERE id = $1`, [studentId, firstName]);
    await client.query(
      `INSERT INTO enrollments
         (id, tenant_id, student_id, institution_id, grade_id, class_id,
          academic_period_id, status, enrolled_at, exited_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::enrollment_status, '2026-04-01'::date, $9::date)`,
      [
        randomUUID(),
        fx.tenantId,
        studentId,
        fx.institutionId,
        gradeId,
        classId,
        fx.academicPeriodId,
        status,
        status === 'ENROLLED' ? null : '2026-06-30',
      ],
    );
  });
  return studentId;
}

describe('PrismaStudentRepository.list enrollment filters (live) — PRC-M148', () => {
  let repo: PrismaStudentRepository;
  let fx: Fixture;
  let ashaId = '';
  let chitraId = '';
  beforeAll(async () => {
    if (!live) return;
    prisma = createPrismaClient({ datasourceUrl: DATABASE_URL! });
    repo = new PrismaStudentRepository(prisma);
    fx = await seedFixture();
    ashaId = await enroll(fx, 'Asha', fx.grade5, fx.class5A, 'ENROLLED');
    await enroll(fx, 'Bina', fx.grade6, fx.class6A, 'ENROLLED');
    chitraId = await enroll(fx, 'Chitra', fx.grade5, fx.class5A, 'WITHDRAWN');
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const names = async (filter: Parameters<PrismaStudentRepository['list']>[1]) => {
    const page = await repo.list(fx.tenantId, filter, { page: 1, pageSize: 50 });
    return page.data.map((s) => s.firstName).sort();
  };

  it.skipIf(!live)('institutionId lists the institution’s ENROLLED students', async () => {
    expect(await names({ institutionId: fx.institutionId })).toEqual(['Asha', 'Bina']);
  });

  it.skipIf(!live)('gradeId lists only that grade’s ENROLLED students', async () => {
    expect(await names({ gradeId: fx.grade5 })).toEqual(['Asha']);
    expect(await names({ gradeId: fx.grade6, institutionId: fx.institutionId })).toEqual(['Bina']);
  });

  it.skipIf(!live)('enrollmentStatus matches the same enrollment row', async () => {
    expect(await names({ enrollmentStatus: 'WITHDRAWN' })).toEqual(['Chitra']);
    expect(await names({ enrollmentStatus: 'WITHDRAWN', gradeId: fx.grade6 })).toEqual([]);
    expect(await names({ enrollmentStatus: 'WITHDRAWN', gradeId: fx.grade5 })).toEqual(['Chitra']);
  });

  it.skipIf(!live)('PRC-M031: list and findById carry the current placement', async () => {
    const page = await repo.list(fx.tenantId, {}, { page: 1, pageSize: 50 });
    const asha = page.data.find((s) => s.id === ashaId);
    expect(asha?.placement).toEqual({
      institutionId: fx.institutionId,
      gradeId: fx.grade5,
      gradeName: 'Grade 5',
      classId: fx.class5A,
      className: '5-A',
    });
    // Only an ENROLLED enrollment is a current placement.
    expect(page.data.find((s) => s.id === chitraId)?.placement).toBeNull();
    expect((await repo.findById(ashaId, fx.tenantId))?.placement?.className).toBe('5-A');
  });

  it.skipIf(!live)('PRC-M031: a status filter reports the matching enrollment', async () => {
    const page = await repo.list(
      fx.tenantId,
      { enrollmentStatus: 'WITHDRAWN' },
      { page: 1, pageSize: 50 },
    );
    expect(page.data.map((s) => [s.firstName, s.placement?.className])).toEqual([
      ['Chitra', '5-A'],
    ]);
  });
});
