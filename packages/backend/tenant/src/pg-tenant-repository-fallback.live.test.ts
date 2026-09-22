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
 * Skipped unless MIGRATOR_DATABASE_URL (or DATABASE_URL) is set, matching the other
 * *.live.test.ts files here.
 */
// Default import, not `{ Pool }`: pg is CJS and Vite cannot reliably
// destructure named exports from it — the named form fails at collect time with
// "Failed to load url pg". The other live tests in this repo use this form.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PgTenantRepository } from './pg-tenant-repository.js';

const CONNECTION = process.env['MIGRATOR_DATABASE_URL'] ?? process.env['DATABASE_URL'] ?? '';
const describeLive = CONNECTION ? describe : describe.skip;

// Fixed ids so a failed run cleans up on the next one.
const TABLE_ONLY_TENANT = '5a5a5a5a-0000-4000-8000-00000000f001';
const DOC_TENANT = '5a5a5a5a-0000-4000-8000-00000000f002';
const DELETE_TENANT = '5a5a5a5a-0000-4000-8000-00000000f003';

describeLive('PgTenantRepository.findTenantById — tenants-table fallback', () => {
  let pool: pg.Pool;
  let repo: PgTenantRepository;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: CONNECTION, max: 3 });
    repo = new PgTenantRepository(pool);
    const c = await pool.connect();
    try {
      await c.query(`SELECT set_config('app.platform_admin', '1', false)`);
      await c.query(
        `INSERT INTO tenants (id, name, slug, status, config, legal_hold)
         VALUES ($1, 'Fallback Probe', 'fallback-probe-f001', 'active',
                 '{"locale":"en-IN"}'::jsonb, false)
         ON CONFLICT (id) DO NOTHING`,
        [TABLE_ONLY_TENANT],
      );
      await c.query(
        `INSERT INTO tenants (id, name, slug, status, config, legal_hold)
         VALUES ($1, 'Doc Probe Table Row', 'doc-probe-f002', 'active', '{}'::jsonb, false)
         ON CONFLICT (id) DO NOTHING`,
        [DOC_TENANT],
      );
      await c.query(
        `INSERT INTO tenants (id, name, slug, status, config, legal_hold, deleted_at)
         VALUES ($1, 'Delete Probe', 'delete-probe-f003', 'decommissioned', '{}'::jsonb, false, NULL)
         ON CONFLICT (id) DO UPDATE SET deleted_at = NULL`,
        [DELETE_TENANT],
      );
    } finally {
      c.release();
    }
  });

  afterAll(async () => {
    if (!pool) return;
    const c = await pool.connect();
    try {
      await c.query(`SELECT set_config('app.platform_admin', '1', false)`);
      await c.query(
        `DELETE FROM control_plane_documents WHERE collection = 'tenant.tenants' AND id = ANY($1)`,
        [[TABLE_ONLY_TENANT, DOC_TENANT, DELETE_TENANT]],
      );
      await c.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [
        [TABLE_ONLY_TENANT, DOC_TENANT, DELETE_TENANT],
      ]);
    } finally {
      c.release();
    }
    await pool.end();
  });

  it('reproduces the bug: no control-plane document exists for a table-created tenant', async () => {
    const c = await pool.connect();
    try {
      await c.query(`SELECT set_config('app.platform_admin', '1', false)`);
      const docs = await c.query(
        `SELECT 1 FROM control_plane_documents
          WHERE collection = 'tenant.tenants' AND id = $1`,
        [TABLE_ONLY_TENANT],
      );
      // If this ever returns a row the premise has changed and the rest is moot.
      expect(docs.rows).toHaveLength(0);
    } finally {
      c.release();
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
    expect(tenant?.createdAt).toBeInstanceOf(Date);
    expect(tenant?.updatedAt).toBeInstanceOf(Date);
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

  it('deleteTenant marks the table row so the fallback cannot resurrect the tenant', async () => {
    // Without the row soft-delete, deleteTenant would remove only the control-plane
    // document and the next findTenantById would read the still-present row — a
    // "permanently deleted" tenant coming back 200.
    expect(await repo.findTenantById(DELETE_TENANT)).not.toBeNull();

    // True even though no control-plane document exists for this id: the table row
    // alone is something to delete.
    expect(await repo.deleteTenant(DELETE_TENANT)).toBe(true);
    expect(await repo.findTenantById(DELETE_TENANT)).toBeNull();

    const c = await pool.connect();
    try {
      await c.query(`SELECT set_config('app.platform_admin', '1', false)`);
      const row = await c.query<{ deleted_at: Date | null }>(
        `SELECT deleted_at FROM tenants WHERE id = $1`,
        [DELETE_TENANT],
      );
      // Soft, not hard: control_plane_documents.tenant_id and other tenant-owned
      // tables carry a real FK to tenants(id), so the row has to survive.
      expect(row.rows).toHaveLength(1);
      expect(row.rows[0]?.deleted_at).not.toBeNull();
    } finally {
      c.release();
    }

    // Idempotent: nothing left to remove in either store.
    expect(await repo.deleteTenant(DELETE_TENANT)).toBe(false);
  });

  it('does not resolve a soft-deleted tenant', async () => {
    const c = await pool.connect();
    try {
      await c.query(`SELECT set_config('app.platform_admin', '1', false)`);
      await c.query(`UPDATE tenants SET deleted_at = now() WHERE id = $1`, [TABLE_ONLY_TENANT]);
    } finally {
      c.release();
    }
    expect(await repo.findTenantById(TABLE_ONLY_TENANT)).toBeNull();

    const c2 = await pool.connect();
    try {
      await c2.query(`SELECT set_config('app.platform_admin', '1', false)`);
      await c2.query(`UPDATE tenants SET deleted_at = NULL WHERE id = $1`, [TABLE_ONLY_TENANT]);
    } finally {
      c2.release();
    }
  });
});
