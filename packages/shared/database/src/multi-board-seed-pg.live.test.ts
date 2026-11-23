/**
 * PRC-L497 live proof: the multi-board seed persists to Postgres under RLS.
 *
 * Runs as the runtime role (DATABASE_URL = proctira_app in CI: non-owner,
 * NOSUPERUSER, NOBYPASSRLS) against the real onboarding tables with FORCE RLS:
 * - every row is written inside one transaction bound to the seed tenant only
 *   (no platform-admin escape) and the per-table counts match the fixture;
 * - another tenant's binding, and an unbound connection, see none of it;
 * - a fixture row claiming another tenant fails closed and writes nothing;
 * - the database itself refuses a cross-tenant row under the seed binding.
 */
import { randomUUID } from 'node:crypto';
import {
  persistMultiBoardSeed,
  seedMultiBoardSchools,
  SeedTenantMismatchError,
} from '@proctira/testing/database';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'multi-board-seed-pg.live.test' });
const pool = DATABASE_URL ? new pg.Pool({ connectionString: DATABASE_URL, max: 3 }) : null;
const live = Boolean(pool);
function smallSeed() {
  const suffix = randomUUID().slice(0, 8);
  return seedMultiBoardSchools({
    studentsPerSchool: 4,
    staffPerSchool: 2,
    areaDepth: 3,
    tenantOverrides: { id: randomUUID(), slug: `prc-l497-${suffix}`, name: `PRC-L497 ${suffix}` },
    boards: [
      {
        boardCode: `B${suffix}`,
        boardName: 'Live Board',
        boardType: 'STATE',
        schools: [
          { code: `S1-${suffix}`, name: 'Live School One' },
          { code: `S2-${suffix}`, name: 'Live School Two' },
        ],
      },
    ],
  });
}
async function countAs(tenantGuc: string | null, table: string, tenantId: string): Promise<number> {
  const client = await pool!.connect();
  try {
    await client.query('BEGIN');
    if (tenantGuc) await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantGuc]);
    const res = await client.query(`SELECT COUNT(*)::int AS c FROM ${table} WHERE tenant_id = $1`, [
      tenantId,
    ]);
    await client.query('COMMIT');
    return Number((res.rows[0] as { c: number }).c);
  } finally {
    client.release();
  }
}
describe.skipIf(!live)('PRC-L497 multi-board seed Postgres adapter (live, RLS)', () => {
  beforeAll(async () => {
    const res = await pool!.query(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );
    const role = res.rows[0] as { rolsuper: boolean; rolbypassrls: boolean };
    // The proof is vacuous for a role that bypasses RLS.
    expect(role.rolsuper).toBe(false);
    expect(role.rolbypassrls).toBe(false);
  });
  afterAll(async () => {
    await pool?.end();
  });
  it('persists every fixture row for its own tenant only', async () => {
    const seed = smallSeed();
    const persisted = await persistMultiBoardSeed(pool!, seed);
    expect(persisted.tenantId).toBe(seed.tenant.id);
    expect(persisted.counts).toEqual({
      areas: 3,
      boards: 1,
      institutions: 2,
      academicPeriods: 2,
      grades: 1,
      classes: 2,
      students: 8,
      staff: 4,
      enrollments: 8,
    });
    // Same rows, read back on a fresh connection bound to the seed tenant.
    expect(await countAs(seed.tenant.id, 'students', seed.tenant.id)).toBe(8);
    expect(await countAs(seed.tenant.id, 'enrollments', seed.tenant.id)).toBe(8);
  });
  it("another tenant's binding and an unbound connection see none of the rows", async () => {
    const a = smallSeed();
    const b = smallSeed();
    await persistMultiBoardSeed(pool!, a);
    await persistMultiBoardSeed(pool!, b);
    for (const table of ['students', 'staff', 'enrollments', 'institutions', 'boards']) {
      expect(await countAs(b.tenant.id, table, a.tenant.id), table).toBe(0);
      expect(await countAs(null, table, a.tenant.id), table).toBe(0);
    }
    expect(await countAs(b.tenant.id, 'students', b.tenant.id)).toBe(8);
  });
  it('a fixture row owned by another tenant fails closed and writes nothing', async () => {
    const seed = smallSeed();
    seed.schools[1]!.students[0]!.tenantId = randomUUID();
    await expect(persistMultiBoardSeed(pool!, seed)).rejects.toBeInstanceOf(
      SeedTenantMismatchError,
    );
    expect(await countAs(seed.tenant.id, 'students', seed.tenant.id)).toBe(0);
    expect(await countAs(seed.tenant.id, 'boards', seed.tenant.id)).toBe(0);
  });
  it('a database error mid-seed rolls back the whole tenant (no partial rows)', async () => {
    const seed = smallSeed();
    // Duplicate staff identity number violates staff_tenant_id_identity_number_key.
    seed.schools[1]!.staff[0]!.identityNumber = seed.schools[0]!.staff[0]!.identityNumber;
    await expect(persistMultiBoardSeed(pool!, seed)).rejects.toThrow();
    expect(await countAs(seed.tenant.id, 'students', seed.tenant.id)).toBe(0);
    expect(await countAs(seed.tenant.id, 'institutions', seed.tenant.id)).toBe(0);
  });
  it('FORCE RLS rejects a cross-tenant row under the seed binding', async () => {
    const seed = smallSeed();
    await persistMultiBoardSeed(pool!, seed);
    const client = await pool!.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [seed.tenant.id]);
      await expect(
        client.query(
          `INSERT INTO students (id, tenant_id, first_name, last_name, date_of_birth, gender)
           VALUES ($1, $2, 'X', 'Y', '2015-01-01', 'MALE')`,
          [randomUUID(), randomUUID()],
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
