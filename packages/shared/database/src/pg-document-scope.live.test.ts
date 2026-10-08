/**
 * Live Postgres proof that scoped `PgDocumentCollection` operations isolate
 * tenants, and that unscoped ones do not.
 *
 * `control_plane_documents` has RLS enabled and forced, but its policy accepts
 * `app.platform_admin='1'` as a full escape, and `withPlatformScope` binds exactly
 * that on every call. `get`/`delete`/`all`/`count` additionally carried no
 * `tenant_id` predicate, so `(collection, id)` behaved as a global key.
 *
 * These tests pin both halves:
 *
 *   - the **unscoped** call still crosses tenants — the open P0, asserted so it
 *     cannot regress silently in either direction while it is being fixed
 *   - the **scoped** call does not, because the predicate is in the SQL and
 *     therefore holds regardless of whether RLS is escaped
 *
 * When the escape is finally made conditional, the unscoped assertions here are
 * the ones that should flip; that is the signal the P0 is closed.
 *
 * See `docs/audits/SEC_CONTROL_PLANE_DOCUMENT_ISOLATION.md`.
 * Skipped without DATABASE_URL.
 */
import { randomUUID } from 'node:crypto';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgDocumentCollection } from './pg-document-store';
import { ensurePgTestTenant } from './test-fixtures';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'pg-document-scope.live.test' });
const pool = DATABASE_URL ? new pg.Pool({ connectionString: DATABASE_URL, max: 2 }) : null;
const live = Boolean(pool);

interface Doc extends Record<string, unknown> {
  owner: string;
}

const COLLECTION = `scope-probe.${randomUUID()}`;
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const SHARED_ID = 'shared-id';

let docs: PgDocumentCollection<Doc>;

beforeAll(async () => {
  if (!live) return;
  // control_plane_documents.tenant_id became a real uuid FK to tenants in
  // db/sql/100, so these two ids have to exist. Until then the table accepted any
  // string, which is the integrity gap 100 closed -- this fixture was relying on it.
  await ensurePgTestTenant(pool!, TENANT_A);
  await ensurePgTestTenant(pool!, TENANT_B);
  docs = new PgDocumentCollection<Doc>(pool!, COLLECTION);
  // One row per tenant, plus a platform-owned row with no tenant.
  await docs.put(SHARED_ID, { owner: 'TENANT_A' }, TENANT_A);
  await docs.put('b-only', { owner: 'TENANT_B' }, TENANT_B);
  await docs.put('platform-only', { owner: 'PLATFORM' }, null);
});

afterAll(async () => {
  if (live) {
    await pool!.query(`DELETE FROM control_plane_documents WHERE collection = $1`, [COLLECTION]);
  }
  await pool?.end();
});

describe('PgDocumentCollection scoping (live Postgres)', () => {
  it.skipIf(!live)('scoped get returns the row for its owning tenant', async () => {
    const found = await docs.get(SHARED_ID, { tenantId: TENANT_A });
    expect(found?.owner).toBe('TENANT_A');
  });

  it.skipIf(!live)('scoped get does NOT return another tenant row', async () => {
    const leaked = await docs.get(SHARED_ID, { tenantId: TENANT_B });
    expect(leaked).toBeNull();
  });

  it.skipIf(!live)(
    'unscoped get still crosses tenants — the open P0, pinned until it is fixed',
    async () => {
      // No scope, so no tenant_id predicate; the platform_admin escape that
      // withPlatformScope binds defeats RLS. This SHOULD become null once the
      // escape is made conditional.
      const leaked = await docs.get(SHARED_ID);
      expect(leaked?.owner).toBe('TENANT_A');
    },
  );

  it.skipIf(!live)('scoped all / count see only the scoped tenant', async () => {
    const aRows = await docs.all({ tenantId: TENANT_A });
    expect(aRows.map((r) => r.owner)).toEqual(['TENANT_A']);
    expect(await docs.count({ tenantId: TENANT_A })).toBe(1);
    expect(await docs.count({ tenantId: TENANT_B })).toBe(1);
  });

  it.skipIf(!live)('platform scope sees only rows with no owning tenant', async () => {
    const rows = await docs.all({ platform: true });
    expect(rows.map((r) => r.owner)).toEqual(['PLATFORM']);
    expect(await docs.count({ platform: true })).toBe(1);
  });

  it.skipIf(!live)('unscoped count sees every tenant — the same P0, pinned', async () => {
    expect(await docs.count()).toBe(3);
  });

  it.skipIf(!live)('scoped delete refuses to remove another tenant row', async () => {
    const deleted = await docs.delete('b-only', { tenantId: TENANT_A });
    expect(deleted).toBe(false);
    // Still there for its real owner.
    expect((await docs.get('b-only', { tenantId: TENANT_B }))?.owner).toBe('TENANT_B');
  });

  it.skipIf(!live)('scoped delete removes the row for its owning tenant', async () => {
    const deleted = await docs.delete('b-only', { tenantId: TENANT_B });
    expect(deleted).toBe(true);
    expect(await docs.get('b-only', { tenantId: TENANT_B })).toBeNull();
  });

  it.skipIf(!live)(
    'PRC-H116: tenant B cannot overwrite or re-parent tenant A row by reusing its id',
    async () => {
      await expect(docs.put(SHARED_ID, { owner: 'TENANT_B' }, TENANT_B)).rejects.toMatchObject({
        code: 'DOCUMENT_OWNERSHIP_CONFLICT',
      });
      expect((await docs.get(SHARED_ID, { tenantId: TENANT_A }))?.owner).toBe('TENANT_A');
    },
  );

  it.skipIf(!live)(
    'PRC-H007/H116 regression: a non-canonical (uppercase) tenant id round-trips without a spurious ownership conflict',
    async () => {
      // control_plane_documents.tenant_id is uuid; the RLS policy compares
      // tenant_id::text (canonical lowercase) against the bound app.tenant_id
      // GUC. A uuid is case-insensitive, so an uppercase id denotes the same
      // tenant — but once tenant-addressed ops stopped taking the platform escape
      // (#585), an un-normalised GUC no longer matched and the write failed 42501
      // (surfaced as DocumentOwnershipConflictError) while reads saw nothing.
      const canonical = randomUUID();
      const upper = canonical.toUpperCase();
      await ensurePgTestTenant(pool!, canonical);
      const upperId = `upper-${canonical}`;

      // Write + read + overwrite under the uppercase id all succeed.
      await docs.put(upperId, { owner: 'UPPER' }, upper);
      expect((await docs.get(upperId, { tenantId: upper }))?.owner).toBe('UPPER');
      expect((await docs.get(upperId, { tenantId: canonical }))?.owner).toBe('UPPER');
      await docs.put(upperId, { owner: 'UPPER-2' }, upper);
      expect((await docs.byTenant(upper)).map((r) => r.owner)).toContain('UPPER-2');

      // Isolation is preserved: a different tenant still cannot reach it.
      expect(await docs.get(upperId, { tenantId: TENANT_A })).toBeNull();
      await expect(docs.put(upperId, { owner: 'TENANT_A' }, TENANT_A)).rejects.toMatchObject({
        code: 'DOCUMENT_OWNERSHIP_CONFLICT',
      });
    },
  );
});
