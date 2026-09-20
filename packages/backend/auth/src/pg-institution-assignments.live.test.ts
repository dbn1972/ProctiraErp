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
 * Discovered at runtime rather than created. `institutions` has seven NOT NULL
 * columns including an FK to geographic_areas, so fabricating schools here would be
 * more fixture than test. The evaluation database already contains tenants owning
 * several schools, which is the shape this feature is about.
 */
let TENANT = '';
let SCHOOL_A = '';
let SCHOOL_B = '';
let SCHOOL_C = ''; // a third school in the same tenant, never assigned

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

  // institutions is under FORCE RLS, so the owner sees nothing without a scope —
  // and which tenant to bind is exactly what we are trying to discover. The policy
  // carries a platform branch for control-plane reads; this fixture lookup is a
  // legitimate use of it, and it is confined to discovery.
  const discovery = await ownerPool!.connect();
  let rows: Array<{ tenant_id: string; ids: string[] }>;
  try {
    await discovery.query(`SELECT set_config('app.platform_admin', '1', false)`);
    const res = await discovery.query<{ tenant_id: string; ids: string[] }>(
      `SELECT tenant_id::text AS tenant_id, array_agg(id::text ORDER BY id) AS ids
         FROM institutions
        GROUP BY tenant_id
       HAVING count(*) >= 3
        LIMIT 1`,
    );
    rows = res.rows;
  } finally {
    discovery.release();
  }
  if (rows.length === 0) throw new Error('no tenant with >=3 institutions to test against');
  TENANT = rows[0]!.tenant_id;
  [SCHOOL_A, SCHOOL_B, SCHOOL_C] = rows[0]!.ids as [string, string, string];

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
  if (live && TENANT) {
    await asTenant(TENANT, async (client) => {
      await client.query(`DELETE FROM staff_assignments WHERE staff_id = $1`, [STAFF]);
      await client.query(`DELETE FROM staff WHERE id = $1`, [STAFF]);
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
