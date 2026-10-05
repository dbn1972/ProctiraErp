/**
 * Live Postgres proof that the Prisma staff-assignment repository reads rows whose
 * subject_id / class_id are NULL.
 *
 * db/sql/098_staff_identity_link.sql made both columns nullable for administrative
 * assignments (principal, additional charge) but the Prisma model kept them
 * non-null, so the generated client rejected those rows at conversion time with
 * "Error converting field subjectId … found null". That broke every read of such a
 * staff member, including the PRC-M375 allocation lock (`findMany` under
 * `SELECT … FOR UPDATE`) that runs on every guarded create/update.
 *
 * Rows are seeded through the owner pool with raw SQL (exactly the shape seed 006
 * writes) and read back through the runtime-role Prisma client, so the real engine
 * conversion is exercised. Needs DATABASE_URL and MIGRATOR_DATABASE_URL.
 */
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AllocationExceededError } from './assignment-repository.js';
import { PrismaAssignmentRepository } from './prisma-assignment-repository.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'prisma-assignment-nullable.live.test' });
const MIGRATOR_DATABASE_URL = process.env['MIGRATOR_DATABASE_URL']?.trim();
const ownerPool = MIGRATOR_DATABASE_URL
  ? new pg.Pool({ connectionString: MIGRATOR_DATABASE_URL, max: 2 })
  : null;
const live = Boolean(DATABASE_URL && ownerPool);
const prisma = live ? createPrismaClient({ datasourceUrl: DATABASE_URL }) : null;

const TENANT = randomUUID();
const AREA = randomUUID();
const SCHOOL_A = randomUUID();
const SCHOOL_B = randomUUID();
const STAFF = randomUUID();
const ADMIN_ASSIGNMENT = randomUUID();

/**
 * Owner-pool writes with both tenant GUCs bound: staff, institutions and
 * staff_assignments are under FORCE RLS, and staff_assignments policies still read
 * the legacy app.current_tenant_id.
 */
async function asTenant<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await ownerPool!.connect();
  try {
    await client.query('SELECT set_config($1, $2, false)', ['app.tenant_id', TENANT]);
    await client.query('SELECT set_config($1, $2, false)', ['app.current_tenant_id', TENANT]);
    return await fn(client);
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  if (!live) return;
  await ensurePgTestTenant(ownerPool!, TENANT);
  await asTenant(async (client) => {
    await client.query(
      `INSERT INTO geographic_areas
         (id, tenant_id, name, code, level, path, lft, rgt, created_at, updated_at)
       VALUES ($1,$2,'Test District',$3,0,'/test',1,2, now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [AREA, TENANT, `AREA-${AREA.slice(0, 8)}`],
    );
    for (const id of [SCHOOL_A, SCHOOL_B]) {
      await client.query(
        `INSERT INTO institutions
           (id, tenant_id, name, code, area_id, type, sector, ownership,
            created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,'SCHOOL','PUBLIC','GOVERNMENT', now(), now())
         ON CONFLICT (id) DO NOTHING`,
        [id, TENANT, `School ${id.slice(0, 8)}`, `SCH-${id.slice(0, 8)}`, AREA],
      );
    }
    await client.query(
      `INSERT INTO staff
         (id, tenant_id, first_name, last_name, date_of_birth, identity_number,
          created_at, updated_at)
       VALUES ($1,$2,'Head','Master','1980-01-01',$3, now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [STAFF, TENANT, `IDN-${STAFF.slice(0, 8)}`],
    );
    // Administrative posting: no subject, no class (as seed 006 writes a principal).
    await client.query(
      `INSERT INTO staff_assignments
         (id, tenant_id, staff_id, institution_id, subject_id, class_id, role,
          allocation_percentage, start_date, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,NULL,NULL,'principal',70,DATE '2026-04-01','ACTIVE', now(), now())`,
      [ADMIN_ASSIGNMENT, TENANT, STAFF, SCHOOL_A],
    );
  });
});

afterAll(async () => {
  if (live) {
    await asTenant(async (client) => {
      await client.query(`DELETE FROM staff_assignments WHERE staff_id = $1`, [STAFF]);
      await client.query(`DELETE FROM staff WHERE id = $1`, [STAFF]);
      await client.query(`DELETE FROM institutions WHERE id = ANY($1::uuid[])`, [
        [SCHOOL_A, SCHOOL_B],
      ]);
      await client.query(`DELETE FROM geographic_areas WHERE id = $1`, [AREA]);
    });
  }
  await prisma?.$disconnect();
  await ownerPool?.end();
});

describe('PrismaAssignmentRepository reads NULL subject/class rows (live Postgres)', () => {
  it.skipIf(!live)('findById / findActiveByStaffId return the row with nulls', async () => {
    const repo = new PrismaAssignmentRepository(prisma!);
    const found = await repo.findById(ADMIN_ASSIGNMENT, TENANT);
    expect(found).toMatchObject({ subjectId: null, classId: null, role: 'principal' });
    const active = await repo.findActiveByStaffId(STAFF, TENANT);
    expect(active.map((a) => a.id)).toEqual([ADMIN_ASSIGNMENT]);
  });

  it.skipIf(!live)(
    'allocation lock reads the administrative row and enforces the cap',
    async () => {
      const repo = new PrismaAssignmentRepository(prisma!);
      await expect(
        repo.create(
          {
            id: randomUUID(),
            tenantId: TENANT,
            staffId: STAFF,
            institutionId: SCHOOL_B,
            subjectId: randomUUID(),
            classId: randomUUID(),
            role: 'teacher',
            allocationPercentage: 40,
            startDate: '2026-05-01',
            endDate: null,
            status: 'ACTIVE',
          },
          { maxTotalPercentage: 100 },
        ),
      ).rejects.toBeInstanceOf(AllocationExceededError);
    },
  );

  it.skipIf(!live)(
    'a fitting additional charge is created with nulls and listed alongside',
    async () => {
      const repo = new PrismaAssignmentRepository(prisma!);
      const created = await repo.create(
        {
          id: randomUUID(),
          tenantId: TENANT,
          staffId: STAFF,
          institutionId: SCHOOL_B,
          subjectId: null,
          classId: null,
          role: 'additional_charge',
          allocationPercentage: 30,
          startDate: '2026-05-01',
          endDate: null,
          status: 'ACTIVE',
        },
        { maxTotalPercentage: 100 },
      );
      expect(created).toMatchObject({ subjectId: null, classId: null });
      const page = await repo.list(TENANT, { staffId: STAFF }, { page: 1, pageSize: 20 });
      expect(page.data).toHaveLength(2);
      expect(page.data.every((a) => a.subjectId === null && a.classId === null)).toBe(true);
    },
  );
});
