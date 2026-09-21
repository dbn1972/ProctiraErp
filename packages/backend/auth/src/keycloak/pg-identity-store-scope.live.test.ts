/**
 * Live Postgres proof for the control-plane document scoping added for the P0 in
 * docs/audits/SEC_CONTROL_PLANE_DOCUMENT_ISOLATION.md.
 *
 * The structural cause, confirmed against the live catalog:
 *
 *   control_plane_documents_pkey  UNIQUE (collection, id)
 *
 * `tenant_id` is NOT part of the key. So document ids are a single global
 * namespace: exactly one row can exist per `(collection, id)`, and an unscoped
 * `get(id)` returns it whichever tenant owns it. `withPlatformScope` binds
 * `app.platform_admin='1'`, which that table's policy accepts as a full escape, so
 * RLS does not stop it either.
 *
 * Adding a scope puts the predicate in SQL, which is what these tests pin. Note
 * what it does not do: the key remains global, so two tenants still cannot hold
 * the same logical id. That is recorded in the audit as the remaining design gap.
 *
 * Skipped without DATABASE_URL.
 */
import { randomUUID } from 'node:crypto';
import { PgDocumentCollection } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PgKeycloakIdentityStore } from './pg-identity-store.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'pg-identity-store-scope.live.test' });
const pool = DATABASE_URL ? new pg.Pool({ connectionString: DATABASE_URL, max: 3 }) : null;
const live = Boolean(pool);

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const PLATFORM_TENANT_ID = `platform-realm-${randomUUID().slice(0, 8)}`;
const EMAIL = `scope-${randomUUID().slice(0, 8)}@example.edu`;
const A_USER_KEY = `${TENANT_A}:${EMAIL}`;

type TenantDoc = { id: string; slug: string };
type UserDoc = { id: string; tenantId: string; email: string };

let tenantsDocs: PgDocumentCollection<TenantDoc>;
let usersDocs: PgDocumentCollection<UserDoc>;

beforeAll(async () => {
  if (!live) return;
  await ensurePgTestTenant(pool!, TENANT_A);
  await ensurePgTestTenant(pool!, TENANT_B);

  tenantsDocs = new PgDocumentCollection<TenantDoc>(pool!, 'auth.keycloak_tenants');
  usersDocs = new PgDocumentCollection<UserDoc>(pool!, 'auth.keycloak_users');

  // Platform-owned realm mapping: tenant_id NULL, which is how every existing
  // auth.keycloak_tenants row looks (verified: 6 rows, 0 with a tenant_id).
  await tenantsDocs.put(PLATFORM_TENANT_ID, { id: PLATFORM_TENANT_ID, slug: 'platform' }, null);

  // A user document owned by tenant A, keyed with A's id as the prefix.
  await usersDocs.put(A_USER_KEY, { id: A_USER_KEY, tenantId: TENANT_A, email: EMAIL }, TENANT_A);
});

afterAll(async () => {
  if (live) {
    await pool!.query(`DELETE FROM control_plane_documents WHERE id = ANY($1::text[])`, [
      [PLATFORM_TENANT_ID, A_USER_KEY],
    ]);
  }
  await pool?.end();
});

describe('control-plane document scoping (live Postgres)', () => {
  it.skipIf(!live)('the primary key omits tenant_id, so ids are a global namespace', async () => {
    const res = await pool!.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'public.control_plane_documents'::regclass AND contype = 'p'`,
    );
    // Pinned because it is the structural cause of the finding: if tenant_id ever
    // joins the key, the scoping below stops being the only line of defence.
    expect(res.rows[0]!.def).toBe('PRIMARY KEY (collection, id)');
  });

  it.skipIf(!live)(
    'an unscoped get returns another tenant\u2019s row; a scoped one does not',
    async () => {
      // This is the leak, reproduced: tenant B asks for a key owned by tenant A.
      const unscoped = await usersDocs.get(A_USER_KEY);
      expect(unscoped?.tenantId).toBe(TENANT_A);

      const asB = await usersDocs.get(A_USER_KEY, { tenantId: TENANT_B });
      expect(asB).toBeNull();

      const asA = await usersDocs.get(A_USER_KEY, { tenantId: TENANT_A });
      expect(asA?.email).toBe(EMAIL);
    },
  );

  it.skipIf(!live)('findUserByEmail is constrained in SQL, not by key convention', async () => {
    const store = new PgKeycloakIdentityStore(pool!);
    const mine = await store.findUserByEmail(EMAIL, TENANT_A);
    expect(mine?.email).toBe(EMAIL);

    // Same email, different tenant: the key would not match either, but the point
    // is that the predicate rejects it independently of the key string.
    const theirs = await store.findUserByEmail(EMAIL, TENANT_B);
    expect(theirs).toBeNull();
  });

  it.skipIf(!live)('findTenantById reads platform rows and ignores tenant-owned ones', async () => {
    const store = new PgKeycloakIdentityStore(pool!, { strictTenants: true });

    // The platform row resolves.
    const found = await store.findTenantById(PLATFORM_TENANT_ID);
    expect(found?.id).toBe(PLATFORM_TENANT_ID);

    // A tenant-owned row in the same collection is not reachable through it.
    // strictTenants makes the miss explicit instead of falling back to { id }.
    const tenantOwnedId = `tenant-owned-${randomUUID().slice(0, 8)}`;
    await tenantsDocs.put(tenantOwnedId, { id: tenantOwnedId, slug: 'owned' }, TENANT_A);
    try {
      expect(await store.findTenantById(tenantOwnedId)).toBeNull();
      // ...while it is plainly there when asked for as that tenant.
      expect((await tenantsDocs.get(tenantOwnedId, { tenantId: TENANT_A }))?.slug).toBe('owned');
    } finally {
      await pool!.query(`DELETE FROM control_plane_documents WHERE id = $1`, [tenantOwnedId]);
    }
  });
});
