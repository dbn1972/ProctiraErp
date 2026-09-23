/**
 * Live proof that a tenant which exists only in the `tenants` table resolves.
 *
 * This is the bug being fixed, and it cannot be proven against an in-memory store:
 * the whole point is that two *Postgres* stores disagree. `PgTenantRepository` reads
 * `control_plane_documents` collection `tenant.tenants`, which only its own
 * `createTenant` writes. Migrations, seeds and registration create rows in the
 * `tenants` table instead, so those tenants had no document and `findTenantById`
 * returned null.
 *
 * The user-visible effect: `apps/web`'s root layout fetches
 * `GET /api/v1/tenant/branding` on every page, so a real deployment logged
 * `404 "Tenant with id '…' not found"` on 159 of 193 pages. The evaluation database
 * has 940 rows in `tenants` and 0 documents in collection `tenant.tenants`.
 *
 * ## Two pools, on purpose
 *
 * The subject pool runs as `DATABASE_URL` — `proctira_app` in CI, the non-owner
 * runtime role — because the RLS behaviour being relied on is the runtime role's.
 * Fixtures run on a *separate* pool so their `app.platform_admin` escape can never
 * reach the repository's connections.
 *
 * The first version of this suite got that wrong and was worthless as a result: it
 * set `app.platform_admin` session-level on a client checked out of the same pool
 * the repository used, then released it. The setting rode back into the pool and
 * satisfied the policy for the rest of the run, so every case passed with the tenant
 * binding pointed at an unrelated uuid and with `withPgTenant` deleted outright. The
 * fixtures here bind transaction-locally on their own pool, and
 * `the tenant binding is load-bearing` asserts the RLS behaviour directly.
 *
 * Skipped unless DATABASE_URL (or MIGRATOR_DATABASE_URL) is set, matching the other
 * *.live.test.ts files here.
 */
// Default import, not `{ Pool }`: pg is CJS and Vite cannot reliably
// destructure named exports from it — the named form fails at collect time with
// "Failed to load url pg". The other live tests in this repo use this form.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PgTenantRepository } from './pg-tenant-repository.js';
import { TenantService } from './tenant-service.js';

/** The role the runtime actually uses. In CI this is `proctira_app`. */
const SUBJECT_CONNECTION =
  process.env['DATABASE_URL'] ?? process.env['MIGRATOR_DATABASE_URL'] ?? '';
/** Fixture writes; prefers the owner so setup is not itself under test. */
const FIXTURE_CONNECTION =
  process.env['MIGRATOR_DATABASE_URL'] ?? process.env['DATABASE_URL'] ?? '';
const describeLive = SUBJECT_CONNECTION ? describe : describe.skip;

// Fixed ids so a failed run cleans up on the next one.
const TABLE_ONLY_TENANT = '5a5a5a5a-0000-4000-8000-00000000f001';
const DOC_TENANT = '5a5a5a5a-0000-4000-8000-00000000f002';
const DELETE_TENANT = '5a5a5a5a-0000-4000-8000-00000000f003';
const UPDATE_TENANT = '5a5a5a5a-0000-4000-8000-00000000f004';
const NEIGHBOUR_TENANT = '5a5a5a5a-0000-4000-8000-00000000f005';
const ORDER_TENANT = '5a5a5a5a-0000-4000-8000-00000000f006';
const ALL_PROBE_IDS = [
  TABLE_ONLY_TENANT,
  DOC_TENANT,
  DELETE_TENANT,
  UPDATE_TENANT,
  NEIGHBOUR_TENANT,
  ORDER_TENANT,
];

/** A timestamp fixed in UTC, so a timezone-dependent read produces a wrong instant. */
const FIXED_CREATED_AT = '2026-03-04 05:06:07.000000';
const FIXED_CREATED_AT_UTC = '2026-03-04T05:06:07.000Z';

describeLive('PgTenantRepository.findTenantById — tenants-table fallback', () => {
  let subjectPool: pg.Pool;
  let fixturePool: pg.Pool;
  let repo: PgTenantRepository;

  /**
   * Run fixture SQL with platform scope, transaction-locally, on the fixture pool.
   * `set_config(..., true)` inside an explicit transaction cannot outlive it, so
   * nothing leaks into a pooled connection the repository might later borrow.
   */
  async function asPlatformAdmin<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await fixturePool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.platform_admin', '1', true)`);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    subjectPool = new pg.Pool({ connectionString: SUBJECT_CONNECTION, max: 3 });
    fixturePool = new pg.Pool({ connectionString: FIXTURE_CONNECTION, max: 2 });
    repo = new PgTenantRepository(subjectPool);

    await asPlatformAdmin(async (c) => {
      await c.query(
        `INSERT INTO tenants (id, name, slug, status, config, legal_hold, created_at, updated_at)
         VALUES ($1, 'Fallback Probe', 'fallback-probe-f001', 'active',
                 '{"locale":"en-IN"}'::jsonb, false, $2::timestamp, $2::timestamp)
         ON CONFLICT (id) DO UPDATE
            SET deleted_at = NULL, created_at = $2::timestamp, updated_at = $2::timestamp`,
        [TABLE_ONLY_TENANT, FIXED_CREATED_AT],
      );
      await c.query(
        `INSERT INTO tenants (id, name, slug, status, config, legal_hold)
         VALUES ($1, 'Doc Probe Table Row', 'doc-probe-f002', 'active', '{}'::jsonb, false)
         ON CONFLICT (id) DO UPDATE SET deleted_at = NULL`,
        [DOC_TENANT],
      );
      await c.query(
        `INSERT INTO tenants (id, name, slug, status, config, legal_hold)
         VALUES ($1, 'Delete Probe', 'delete-probe-f003', 'decommissioned', '{}'::jsonb, false)
         ON CONFLICT (id) DO UPDATE SET deleted_at = NULL, status = 'decommissioned'`,
        [DELETE_TENANT],
      );
      await c.query(
        `INSERT INTO tenants (id, name, slug, status, config, legal_hold)
         VALUES ($1, 'Update Probe', 'update-probe-f004', 'active',
                 '{"locale":"en-IN"}'::jsonb, false)
         ON CONFLICT (id) DO UPDATE SET deleted_at = NULL, legal_hold = false`,
        [UPDATE_TENANT],
      );
      await c.query(
        `INSERT INTO tenants (id, name, slug, status, config, legal_hold)
         VALUES ($1, 'Neighbour Probe', 'neighbour-probe-f005', 'active', '{}'::jsonb, false)
         ON CONFLICT (id) DO UPDATE SET deleted_at = NULL`,
        [NEIGHBOUR_TENANT],
      );
      // A document left behind by an earlier failed run would invalidate the premise
      // assertions below, so clear the collection for every probe id.
      await c.query(
        `DELETE FROM control_plane_documents
          WHERE collection = 'tenant.tenants' AND id = ANY($1)`,
        [ALL_PROBE_IDS],
      );
    });
  });

  afterAll(async () => {
    if (fixturePool) {
      await asPlatformAdmin(async (c) => {
        await c.query(
          `DELETE FROM control_plane_documents
            WHERE collection = 'tenant.tenants' AND id = ANY($1)`,
          [ALL_PROBE_IDS],
        );
        await c.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [ALL_PROBE_IDS]);
      });
      await fixturePool.end();
    }
    if (subjectPool) await subjectPool.end();
  });

  it('reproduces the bug: no control-plane document exists for a table-created tenant', async () => {
    const docs = await asPlatformAdmin((c) =>
      c.query(
        `SELECT 1 FROM control_plane_documents
          WHERE collection = 'tenant.tenants' AND id = $1`,
        [TABLE_ONLY_TENANT],
      ),
    );
    // If this ever returns a row the premise has changed and the rest is moot.
    expect(docs.rows).toHaveLength(0);
  });

  it('the tenant binding is load-bearing, and scoped to the one tenant being read', async () => {
    // Asserted against the subject pool directly, because the repository binds
    // internally and a test cannot inject a wrong binding. Without this, the suite
    // would pass with the bind removed — which is how the first version of it failed.
    const client = await subjectPool.connect();
    try {
      const unbound = await client.query(`SELECT id FROM tenants WHERE id = $1::uuid`, [
        TABLE_ONLY_TENANT,
      ]);
      expect(unbound.rows).toHaveLength(0);

      // Bound to a *different* tenant: still invisible. This is the evidence for
      // "grants no visibility of any other tenant's row".
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [NEIGHBOUR_TENANT]);
      const wrongTenant = await client.query(`SELECT id FROM tenants WHERE id = $1::uuid`, [
        TABLE_ONLY_TENANT,
      ]);
      expect(wrongTenant.rows).toHaveLength(0);
      await client.query('COMMIT');

      // Bound to the id being read: visible. Exactly what the fallback does.
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [TABLE_ONLY_TENANT]);
      const rightTenant = await client.query(`SELECT id FROM tenants WHERE id = $1::uuid`, [
        TABLE_ONLY_TENANT,
      ]);
      expect(rightTenant.rows).toHaveLength(1);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });

  it('resolves a tenant that exists only in the tenants table', async () => {
    const tenant = await repo.findTenantById(TABLE_ONLY_TENANT);
    expect(tenant).not.toBeNull();
    expect(tenant?.id).toBe(TABLE_ONLY_TENANT);
    expect(tenant?.name).toBe('Fallback Probe');
    expect(tenant?.slug).toBe('fallback-probe-f001');
    expect(tenant?.status).toBe('active');
    expect(tenant?.legalHold).toBe(false);
    // Mapped from the real jsonb column, not invented.
    expect(tenant?.config).toEqual({ locale: 'en-IN' });
  });

  it('reads timestamps as UTC instants, not as the process timezone', async () => {
    // created_at/updated_at are `timestamp without time zone`. Selected raw, node-pg
    // builds the Date in the *process* timezone, so the same row resolves to a
    // different instant depending on where the service runs — and disagrees with the
    // document path, which stores ISO-8601 with Z.
    //
    // The process timezone is moved for the duration of this case, because that is the
    // only way the defect is observable: a naive column and a UTC process agree, and
    // CI runs UTC, so asserting the instant under the ambient timezone would pass with
    // `AT TIME ZONE 'UTC'` deleted. Under Asia/Kolkata the unfixed read returns
    // 2026-03-03T23:36:07Z instead.
    const originalTz = process.env['TZ'];
    process.env['TZ'] = 'Asia/Kolkata';
    try {
      const tenant = await repo.findTenantById(TABLE_ONLY_TENANT);
      expect(tenant?.createdAt.toISOString()).toBe(FIXED_CREATED_AT_UTC);
      expect(tenant?.updatedAt.toISOString()).toBe(FIXED_CREATED_AT_UTC);
    } finally {
      if (originalTz === undefined) delete process.env['TZ'];
      else process.env['TZ'] = originalTz;
    }
  });

  it('reports the lifecycle fields the table does not track as null, not as defaults', async () => {
    const tenant = await repo.findTenantById(TABLE_ONLY_TENANT);
    // null is the truthful answer: the control plane holds no lifecycle record.
    // A default like plan:'free' would be an invented fact.
    expect(tenant?.plan).toBeNull();
    expect(tenant?.region).toBeNull();
    expect(tenant?.suspendedAt).toBeNull();
    expect(tenant?.suspendedReason).toBeNull();
    expect(tenant?.decommissionedAt).toBeNull();
    expect(tenant?.dataRetentionUntil).toBeNull();
  });

  it('prefers the control-plane document when one exists', async () => {
    // A tenant managed through tenant-lifecycle must not have its state replaced by
    // a thinner table read.
    await repo.createTenant({
      id: DOC_TENANT,
      name: 'Doc Wins',
      slug: 'doc-wins-f002',
      status: 'suspended',
      plan: 'enterprise',
      region: 'ap-south-1',
      config: {} as never,
      suspendedAt: new Date('2026-01-01T00:00:00Z'),
      suspendedReason: 'billing',
      decommissionedAt: null,
      dataRetentionUntil: null,
      legalHold: true,
    });

    const tenant = await repo.findTenantById(DOC_TENANT);
    // The table row for this id says name 'Doc Probe Table Row' / status active.
    expect(tenant?.name).toBe('Doc Wins');
    expect(tenant?.status).toBe('suspended');
    expect(tenant?.plan).toBe('enterprise');
    expect(tenant?.legalHold).toBe(true);
  });

  it('returns null for an unknown id rather than raising', async () => {
    expect(await repo.findTenantById('5a5a5a5a-0000-4000-8000-0000000000ff')).toBeNull();
  });

  it('returns null for a non-uuid id instead of a 22P02', async () => {
    // The id arrives from a JWT claim, so a malformed value must not become a 500.
    expect(await repo.findTenantById('not-a-uuid')).toBeNull();
    expect(await repo.findTenantById('')).toBeNull();
  });

  it('refuses to resolve a tenants row whose status is outside the lifecycle union', async () => {
    // tenants.status is varchar(20) with no CHECK constraint. Casting an unknown
    // value into the union would make every gate read it as "not decommissioned,
    // not suspended" — reporting an undescribable tenant as a safe one.
    await asPlatformAdmin((c) =>
      c.query(`UPDATE tenants SET status = 'zombie' WHERE id = $1`, [NEIGHBOUR_TENANT]),
    );
    expect(await repo.findTenantById(NEIGHBOUR_TENANT)).toBeNull();
    await asPlatformAdmin((c) =>
      c.query(`UPDATE tenants SET status = 'active' WHERE id = $1`, [NEIGHBOUR_TENANT]),
    );
    expect(await repo.findTenantById(NEIGHBOUR_TENANT)).not.toBeNull();
  });

  it('writes to a table-only tenant instead of silently doing nothing', async () => {
    // The read fallback without a write fallback is the worse bug: every mutator in
    // TenantService does find → gate → update, so the update returned null for a
    // tenant the read had just resolved, and the route layer dereferenced it into a
    // 500 while the legal hold went unrecorded.
    const updated = await repo.updateTenant(UPDATE_TENANT, { legalHold: true });
    expect(updated).not.toBeNull();
    expect(updated?.legalHold).toBe(true);
    // Seeded from the table row, not from thin air.
    expect(updated?.name).toBe('Update Probe');
    expect(updated?.slug).toBe('update-probe-f004');
    expect(updated?.config).toEqual({ locale: 'en-IN' });

    // The write materialised a control-plane document, so the document is
    // authoritative from here on.
    const docs = await asPlatformAdmin((c) =>
      c.query(
        `SELECT 1 FROM control_plane_documents
          WHERE collection = 'tenant.tenants' AND id = $1`,
        [UPDATE_TENANT],
      ),
    );
    expect(docs.rows).toHaveLength(1);
    expect((await repo.findTenantById(UPDATE_TENANT))?.legalHold).toBe(true);
  });

  it('mirrors the columns the tenants table owns back to the row', async () => {
    // Materialising a document and stopping there would fork the record: the document
    // would win every read and the row would keep `legal_hold = false` and
    // `status = 'active'` for good. db/sql/067 designates `tenants.legal_hold` as the
    // flag a permanent delete fails closed on, so a hold recorded only in the control
    // plane is not the flag that file describes.
    const row = await asPlatformAdmin((c) =>
      c.query<{ legal_hold: boolean; status: string; name: string; config: unknown }>(
        `SELECT legal_hold, status, name, config FROM tenants WHERE id = $1`,
        [UPDATE_TENANT],
      ),
    );
    expect(row.rows[0]?.legal_hold).toBe(true);

    // And a later change to a table-owned column lands in both stores.
    await repo.updateTenant(UPDATE_TENANT, { status: 'suspended', name: 'Update Probe Renamed' });
    const after = await asPlatformAdmin((c) =>
      c.query<{ status: string; name: string }>(`SELECT status, name FROM tenants WHERE id = $1`, [
        UPDATE_TENANT,
      ]),
    );
    expect(after.rows[0]?.status).toBe('suspended');
    expect(after.rows[0]?.name).toBe('Update Probe Renamed');
    expect((await repo.findTenantById(UPDATE_TENANT))?.status).toBe('suspended');
  });

  it('refuses a permanent delete when no retention deadline is recorded', async () => {
    // A table-only tenant reports dataRetentionUntil: null. The old gate
    // (`if (deadline && deadline > now) throw`) read that as "retention elapsed", so
    // a decommissioned row was permanently deletable on the spot. Missing must fail
    // closed, not open.
    const service = new TenantService(repo);
    await expect(service.deleteTenant(DELETE_TENANT)).rejects.toThrow(
      /no data-retention deadline is recorded/,
    );

    // And the row is still there.
    const rows = await asPlatformAdmin((c) =>
      c.query(`SELECT deleted_at FROM tenants WHERE id = $1`, [DELETE_TENANT]),
    );
    expect(rows.rows[0]?.deleted_at).toBeNull();
  });

  it('deleteTenant marks the table row so the fallback cannot resurrect the tenant', async () => {
    // Without the row soft-delete, deleteTenant would remove only the control-plane
    // document and the next findTenantById would read the still-present row — a
    // "permanently deleted" tenant coming back 200.
    expect(await repo.findTenantById(DELETE_TENANT)).not.toBeNull();

    // True even though no control-plane document exists for this id: the table row
    // alone is something to delete.
    expect(await repo.deleteTenant(DELETE_TENANT)).toBe(true);
    expect(await repo.findTenantById(DELETE_TENANT)).toBeNull();

    const rows = await asPlatformAdmin((c) =>
      c.query<{ deleted_at: Date | null }>(`SELECT deleted_at FROM tenants WHERE id = $1`, [
        DELETE_TENANT,
      ]),
    );
    // Soft, not hard: tenant-owned tables carry a real FK to tenants(id), so the row
    // has to survive.
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.deleted_at).not.toBeNull();

    // Idempotent: nothing left to remove in either store.
    expect(await repo.deleteTenant(DELETE_TENANT)).toBe(false);
  });

  it('marks the tenants row before removing the document, not after', async () => {
    // Two separate transactions, so the order is the whole guarantee. Row first means a
    // failure in between leaves the document present and winning — reads keep their
    // full lifecycle state, exactly as before this fallback existed. Document first
    // would leave the row live and resurrect the tenant through the fallback with every
    // lifecycle field null, which is worse than not having tried.
    //
    // Asserted on the SQL the repository actually issues, because the property is about
    // crash safety and cannot be observed from the end state of a successful run.
    const statements: string[] = [];
    const recordingPool = {
      query: (text: string, values?: unknown[]) => subjectPool.query(text, values),
      connect: async () => {
        const client = await subjectPool.connect();
        const originalQuery = client.query.bind(client);
        return {
          query: (text: string, values?: unknown[]) => {
            statements.push(String(text).replace(/\s+/g, ' ').trim());
            return originalQuery(text, values as never[]);
          },
          release: () => client.release(),
        };
      },
    };

    await asPlatformAdmin((c) =>
      c.query(
        `INSERT INTO tenants (id, name, slug, status, config, legal_hold)
         VALUES ($1, 'Order Probe', 'order-probe-f006', 'active', '{}'::jsonb, false)
         ON CONFLICT (id) DO UPDATE SET deleted_at = NULL`,
        [ORDER_TENANT],
      ),
    );

    const orderRepo = new PgTenantRepository(recordingPool);
    expect(await orderRepo.deleteTenant(ORDER_TENANT)).toBe(true);

    const rowUpdate = statements.findIndex((sql) => /UPDATE tenants SET deleted_at/i.test(sql));
    const documentDelete = statements.findIndex((sql) =>
      /DELETE FROM control_plane_documents/i.test(sql),
    );
    expect(rowUpdate).toBeGreaterThanOrEqual(0);
    expect(documentDelete).toBeGreaterThanOrEqual(0);
    expect(rowUpdate).toBeLessThan(documentDelete);
  });

  it('does not resolve a soft-deleted tenant', async () => {
    await asPlatformAdmin((c) =>
      c.query(`UPDATE tenants SET deleted_at = now() WHERE id = $1`, [TABLE_ONLY_TENANT]),
    );
    expect(await repo.findTenantById(TABLE_ONLY_TENANT)).toBeNull();

    await asPlatformAdmin((c) =>
      c.query(`UPDATE tenants SET deleted_at = NULL WHERE id = $1`, [TABLE_ONLY_TENANT]),
    );
    expect(await repo.findTenantById(TABLE_ONLY_TENANT)).not.toBeNull();
  });

  it('fails loudly when constructed with a queryable that cannot hold a transaction', async () => {
    // withPgTenant can only bind a transaction-local GUC when it can check out a
    // client. Given a query-only wrapper it binds nothing, and under FORCE RLS that
    // does not error — it returns zero rows. A silent null for every tenant is the
    // failure this fallback exists to end, so refuse the construction instead.
    const queryOnly = {
      query: (text: string, values?: unknown[]) => subjectPool.query(text, values),
    };
    const brokenRepo = new PgTenantRepository(queryOnly);
    await expect(brokenRepo.findTenantById(TABLE_ONLY_TENANT)).rejects.toThrow(
      /needs a pool that can check out a client/,
    );
  });
});
