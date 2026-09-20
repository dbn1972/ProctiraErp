/**
 * Live Postgres proof that `institutions[]` is derived from staff assignments that
 * are active at request time (G-805).
 *
 * The behaviour under test is the "additional charge" case from
 * `docs/audits/TENANCY_IDENTITY_INVARIANT.md`: a government headmaster who also runs
 * a second school is one identity, one tenant, several institutions. Before
 * db/sql/098 there was no link from the principal to a staff row, so
 * `keycloak/verify.ts` returned `institutions: []` and the model could not express
 * anything.
 *
 * The expiry case is the reason this is resolved per request rather than carried in a
 * token: an additional charge must lapse on its own `end_date` without anyone
 * remembering to revoke it.
 *
 * Skipped without DATABASE_URL and MIGRATOR_DATABASE_URL.
 */
import { randomUUID } from 'node:crypto';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveActiveInstitutionIds } from './institution-assignments.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'pg-institution-assignments.live.test' });
const MIGRATOR_DATABASE_URL = process.env['MIGRATOR_DATABASE_URL']?.trim();

const runtimePool = DATABASE_URL ? new pg.Pool({ connectionString: DATABASE_URL, max: 2 }) : null;
const ownerPool = MIGRATOR_DATABASE_URL
  ? new pg.Pool({ connectionString: MIGRATOR_DATABASE_URL, max: 2 })
  : null;
const live = Boolean(runtimePool && ownerPool);

const OTHER_TENANT = randomUUID();
const PRINCIPAL = randomUUID(); // the auth.users id stored on staff.user_id
const STAFF = randomUUID();

/**
 * Provisioned by this suite, not discovered. An earlier version looked for any
 * tenant already owning three schools, which passed on a populated evaluation
 * database and failed in CI against a freshly seeded one ("no tenant with >=3
 * institutions to test against"). A live test that depends on ambient seed data is
 * testing the fixture, not the behaviour, so the suite now creates its own tenant,
 * geographic area and three schools. That also removes this suite's use of the
 * `app.platform_admin` policy escape, which is under review as a separate finding.
 */
const TENANT = randomUUID();
const AREA = randomUUID();
const SCHOOL_A = randomUUID();
const SCHOOL_B = randomUUID();
const SCHOOL_C = randomUUID(); // a third school in the same tenant, never assigned

function iso(daysFromNow: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

/**
 * Run `fn` on the owner pool with `app.tenant_id` bound. Required because
 * `institutions`, `staff` and `staff_assignments` are all under FORCE ROW LEVEL
 * SECURITY, which applies to the table owner too — an unbound insert is rejected by
 * the policy's WITH CHECK rather than silently succeeding.
 */
async function asTenant<T>(
  tenantId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await ownerPool!.connect();
  try {
    await client.query('SELECT set_config($1, $2, false)', ['app.tenant_id', tenantId]);
    // staff_assignments RLS reads the LEGACY app.current_tenant_id and raises rather
    // than denying when it is unset, so writes need it bound too.
    await client.query('SELECT set_config($1, $2, false)', ['app.current_tenant_id', tenantId]);
    return await fn(client);
  } finally {
    client.release();
  }
}

/** status/start/end drive the resolution; everything else is filler. */
async function assign(opts: {
  institutionId: string;
  status: string;
  start: string;
  end: string | null;
  tenantId?: string;
  staffId?: string;
}): Promise<void> {
  const tenantId = opts.tenantId ?? TENANT;
  await asTenant(tenantId, (client) =>
    client.query(
      `INSERT INTO staff_assignments
         (id, tenant_id, staff_id, institution_id, role, allocation_percentage,
          start_date, end_date, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'principal',100,$5,$6,$7, now(), now())`,
      [
        randomUUID(),
        tenantId,
        opts.staffId ?? STAFF,
        opts.institutionId,
        opts.start,
        opts.end,
        opts.status,
      ],
    ),
  );
}

beforeAll(async () => {
  if (!live) return;
  await ensurePgTestTenant(ownerPool!, OTHER_TENANT);
  await ensurePgTestTenant(ownerPool!, TENANT);

  // geographic_areas and institutions are both tenant-scoped and under FORCE RLS,
  // so these inserts go through asTenant with the GUC bound. institutions.area_id
  // is a real FK, hence the area row first.
  await asTenant(TENANT, async (client) => {
    await client.query(
      `INSERT INTO geographic_areas
         (id, tenant_id, name, code, level, path, lft, rgt, created_at, updated_at)
       VALUES ($1,$2,'Test District',$3,0,'/test',1,2, now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [AREA, TENANT, `AREA-${AREA.slice(0, 8)}`],
    );
    for (const [id, name] of [
      [SCHOOL_A, 'Primary School A'],
      [SCHOOL_B, 'Primary School B'],
      [SCHOOL_C, 'Primary School C'],
    ] as const) {
      await client.query(
        `INSERT INTO institutions
           (id, tenant_id, name, code, area_id, type, sector, ownership,
            created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,'SCHOOL','PUBLIC','GOVERNMENT', now(), now())
         ON CONFLICT (id) DO NOTHING`,
        [id, TENANT, name, `SCH-${id.slice(0, 8)}`, AREA],
      );
    }
  });

  await asTenant(TENANT, (client) =>
    client.query(
      `INSERT INTO staff
         (id, tenant_id, first_name, last_name, date_of_birth, identity_number,
          user_id, created_at, updated_at)
       VALUES ($1,$2,'Add','Charge','1980-01-01',$4,$3, now(), now())
       ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id`,
      [STAFF, TENANT, PRINCIPAL, `IDN-${STAFF.slice(0, 8)}`],
    ),
  );
});

afterAll(async () => {
  if (live) {
    await asTenant(TENANT, async (client) => {
      await client.query(`DELETE FROM staff_assignments WHERE staff_id = $1`, [STAFF]);
      await client.query(`DELETE FROM staff WHERE id = $1`, [STAFF]);
      // Order matters: institutions.area_id references the area.
      await client.query(`DELETE FROM institutions WHERE id = ANY($1::uuid[])`, [
        [SCHOOL_A, SCHOOL_B, SCHOOL_C],
      ]);
      await client.query(`DELETE FROM geographic_areas WHERE id = $1`, [AREA]);
    });
  }
  await runtimePool?.end();
  await ownerPool?.end();
});

/**
 * Resolve through a request-scoped client with the tenant GUC bound, which is how
 * the gateway calls this in production (the tenant plugin binds `app.tenant_id` and
 * syncs the legacy alias before any handler runs).
 *
 * Both names are bound because `staff_assignments` RLS still reads the LEGACY
 * `app.current_tenant_id`, and does so via `current_setting(...)` without the
 * missing-ok flag — so an unbound connection raises
 * `unrecognized configuration parameter` instead of returning no rows. 14 tables /
 * 56 policies share that pattern; see the finding filed alongside this change.
 */
async function resolveAsTenant(tenantId: string, userId: string, asOf?: Date) {
  const client = await runtimePool!.connect();
  try {
    await client.query('SELECT set_config($1, $2, false)', ['app.tenant_id', tenantId]);
    await client.query('SELECT set_config($1, $2, false)', ['app.current_tenant_id', tenantId]);
    return await resolveActiveInstitutionIds(client, { tenantId, userId, asOf });
  } finally {
    client.release();
  }
}

describe('institution assignment resolution (live Postgres)', () => {
  it.skipIf(!live)('a principal with no assignments resolves to none, not to all', async () => {
    const ids = await resolveAsTenant(TENANT, PRINCIPAL);
    expect(ids).toEqual([]);
  });

  it.skipIf(!live)('one active assignment resolves to that school', async () => {
    await assign({ institutionId: SCHOOL_A, status: 'active', start: iso(-30), end: null });
    const ids = await resolveAsTenant(TENANT, PRINCIPAL);
    expect(ids).toEqual([SCHOOL_A]);
  });

  it.skipIf(!live)(
    'additional charge of a second school resolves to both, longest-standing first',
    async () => {
      await assign({ institutionId: SCHOOL_B, status: 'active', start: iso(-5), end: iso(30) });
      const ids = await resolveAsTenant(TENANT, PRINCIPAL);
      // Order matters: decideInstitutionScope injects ids[0] as the primary school,
      // so it must be stable across requests.
      expect(ids).toEqual([SCHOOL_A, SCHOOL_B]);
      expect(ids).not.toContain(SCHOOL_C);
    },
  );

  it.skipIf(!live)('an assignment past its end_date no longer grants access', async () => {
    const ids = await resolveAsTenant(
      TENANT,
      PRINCIPAL,
      new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    );
    // School B's charge ended at +30 days; School A is open-ended.
    expect(ids).toEqual([SCHOOL_A]);
  });

  it.skipIf(!live)('an assignment that has not started yet grants nothing', async () => {
    const ids = await resolveAsTenant(
      TENANT,
      PRINCIPAL,
      new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
    );
    expect(ids).toEqual([]);
  });

  it.skipIf(!live)('a non-active status grants nothing', async () => {
    await assign({ institutionId: SCHOOL_C, status: 'terminated', start: iso(-10), end: null });
    const ids = await resolveAsTenant(TENANT, PRINCIPAL);
    expect(ids).not.toContain(SCHOOL_C);
  });

  it.skipIf(!live)('resolution is tenant-scoped: another tenant sees nothing', async () => {
    const ids = await resolveAsTenant(OTHER_TENANT, PRINCIPAL);
    expect(ids).toEqual([]);
  });

  it.skipIf(!live)('an unknown principal resolves to none', async () => {
    const ids = await resolveAsTenant(TENANT, randomUUID());
    expect(ids).toEqual([]);
  });
});
