/**
 * UATENV-D23: platform operators (verified Keycloak tenant claim `platform`) sign in through the
 * Postgres identity store.
 *
 * `control_plane_documents.tenant_id` is a uuid column. Binding the literal `platform` as a
 * tenant made Postgres raise `invalid input syntax for type uuid: "platform"`, which the
 * gateway turns into a 503 at sign-in (Track 2 probe on the UAT schema). Platform operators'
 * documents are platform-owned rows (`tenant_id` NULL), like `auth.keycloak_tenants`.
 *
 * The fake below models only what matters here: a uuid-typed `tenant_id` and the predicates the
 * document store emits.
 */
import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { linkKeycloakIdentity } from './identity.js';
import { PgKeycloakIdentityStore } from './pg-identity-store.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Row {
  collection: string;
  id: string;
  tenant_id: string | null;
  data: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

function uuidOrNull(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new Error(`invalid input syntax for type uuid: "${String(value)}"`);
  }
  return value.toLowerCase();
}

/** In-memory `control_plane_documents` with a uuid `tenant_id` column. */
class FakeControlPlane {
  rows: Row[] = [];

  async query(text: string, values: unknown[] = []): Promise<{ rows: Row[]; rowCount: number }> {
    const sql = text.replace(/\s+/g, ' ').trim();
    if (sql.startsWith('SELECT set_config')) return { rows: [], rowCount: 0 };
    if (sql.startsWith('INSERT INTO control_plane_documents')) {
      const [collection, id, tenant, data] = values as [string, string, unknown, string];
      const owner = uuidOrNull(tenant);
      const existing = this.rows.find((r) => r.collection === collection && r.id === id);
      if (existing) {
        if (sql.includes('DO NOTHING')) return { rows: [], rowCount: 0 };
        if (existing.tenant_id !== owner) return { rows: [], rowCount: 0 };
        existing.data = JSON.parse(data) as Record<string, unknown>;
        return { rows: [existing], rowCount: 1 };
      }
      const now = new Date();
      const row: Row = {
        collection,
        id,
        tenant_id: owner,
        data: JSON.parse(data) as Record<string, unknown>,
        created_at: now,
        updated_at: now,
      };
      this.rows.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (sql.startsWith('SELECT * FROM control_plane_documents')) {
      const collection = values[0] as string;
      let rows = this.rows.filter((r) => r.collection === collection);
      if (sql.includes('data @> $2::jsonb')) {
        const criteria = JSON.parse(values[1] as string) as Record<string, unknown>;
        rows = rows.filter((r) => Object.entries(criteria).every(([k, v]) => r.data[k] === v));
        if (sql.includes('AND tenant_id = $3')) {
          const owner = uuidOrNull(values[2]);
          rows = rows.filter((r) => r.tenant_id === owner);
        }
        return { rows, rowCount: rows.length };
      }
      rows = rows.filter((r) => r.id === values[1]);
      if (sql.includes('AND tenant_id IS NULL')) rows = rows.filter((r) => r.tenant_id === null);
      if (sql.includes('AND tenant_id = $3')) {
        const owner = uuidOrNull(values[2]);
        rows = rows.filter((r) => r.tenant_id === owner);
      }
      if (sql.includes('IS NOT DISTINCT FROM $3')) {
        const owner = uuidOrNull(values[2]);
        rows = rows.filter((r) => r.tenant_id === owner);
      }
      return { rows: rows.slice(0, 1), rowCount: Math.min(rows.length, 1) };
    }
    throw new Error(`FakeControlPlane: unexpected SQL ${sql}`);
  }
}

function operator(tenantId: string, email: string) {
  return {
    externalId: randomUUID(),
    email,
    emailVerified: true,
    displayName: 'Platform Operator',
    tenantId,
    tenantSlug: tenantId,
    realm: 'proctira',
  };
}

describe('PgKeycloakIdentityStore platform operators (UATENV-D23)', () => {
  let db: FakeControlPlane;
  let store: PgKeycloakIdentityStore;

  beforeEach(() => {
    db = new FakeControlPlane();
    store = new PgKeycloakIdentityStore(db);
  });

  it('links a platform operator on first sign-in as platform-owned rows', async () => {
    const input = operator('platform', 'ops@proctira-uat.test');
    const linked = await linkKeycloakIdentity(input, store);

    expect(linked.tenantId).toBe('platform');
    expect(linked.email).toBe('ops@proctira-uat.test');
    const user = db.rows.find((r) => r.collection === 'auth.keycloak_users');
    const identity = db.rows.find((r) => r.collection === 'auth.keycloak_identities');
    expect(user?.tenant_id).toBeNull();
    expect(user?.id).toBe('platform:ops@proctira-uat.test');
    expect(identity?.tenant_id).toBeNull();
    expect(identity?.id).toBe(input.externalId);
  });

  it('re-links the same platform operator on the next sign-in', async () => {
    const input = operator('platform', 'ops@proctira-uat.test');
    const first = await linkKeycloakIdentity(input, store);
    const again = await linkKeycloakIdentity(input, store);
    expect(again.userId).toBe(first.userId);
    expect(again.tenantId).toBe('platform');
    expect(again.displayName).toBe('Platform Operator');
    expect(db.rows.filter((r) => r.collection === 'auth.keycloak_users')).toHaveLength(1);
  });

  it('keeps tenant members tenant-owned and out of the platform scope', async () => {
    const tenant = randomUUID();
    const member = await linkKeycloakIdentity(operator(tenant, 'teacher@school.test'), store);
    expect(member.tenantId).toBe(tenant);
    const user = db.rows.find((r) => r.collection === 'auth.keycloak_users');
    expect(user?.tenant_id).toBe(tenant);

    // A tenant member's email is never resolved as a platform operator, and vice versa.
    expect(await store.findUserByEmail('teacher@school.test', 'platform')).toBeNull();
    await linkKeycloakIdentity(operator('platform', 'ops@proctira-uat.test'), store);
    expect(await store.findUserByEmail('ops@proctira-uat.test', tenant)).toBeNull();
  });

  it('still refuses other non-uuid tenant claims as a store error', async () => {
    await expect(
      linkKeycloakIdentity(operator('not-a-tenant', 'x@school.test'), store),
    ).rejects.toThrow(/invalid input syntax for type uuid/);
  });
});
