/**
 * PRC-L466 — developer-portal tenant isolation and account ownership on a real, migrated
 * Postgres (runtime app role, FORCE RLS). Several PgApiKeyStore statements rely on RLS alone
 * (`updateApiKeyStatus` / `listApiKeys` have no tenant predicate), so this suite proves the
 * policy, not just the SQL text.
 *
 * Fails closed when CI=true or REQUIRE_LIVE_TESTS=1 and DATABASE_URL is unset (W3-TEST-03);
 * otherwise skips loudly for local unit-only runs.
 */
import { randomUUID } from 'node:crypto';
import {
  closeSharedPgPools,
  getSharedPgPool,
  withPgTenant,
  withPlatformScope,
} from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiKeyEntity, WebhookEntity } from './developer-portal-repository.js';
import { PgApiKeyStore } from './pg-api-key-store.js';
import { PgDeveloperPortalDurableStore } from './pg-durable-store.js';

const SUITE = 'pg-tenant-isolation.live.test';
const DATABASE_URL = process.env['DATABASE_URL']?.trim();
const liveRequired =
  process.env['ALLOW_LIVE_TEST_SKIP'] !== '1' &&
  (process.env['REQUIRE_LIVE_TESTS'] === '1' ||
    process.env['CI'] === 'true' ||
    process.env['CI'] === '1');
if (!DATABASE_URL && liveRequired) {
  throw new Error(`[W3-TEST-03] Live suite "${SUITE}" has no DATABASE_URL.`);
}
if (!DATABASE_URL) console.warn(`WARNING: [W3-TEST-03] ${SUITE} skipped (no DATABASE_URL).`);
const pool = DATABASE_URL ? getSharedPgPool() : null;

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ACCOUNT_A = randomUUID();
const ACCOUNT_OTHER = randomUUID();

function apiKey(tenantId: string, accountId: string): ApiKeyEntity {
  const id = randomUUID();
  return {
    id,
    tenantId,
    accountId,
    name: 'live-l466',
    keyHash: `hash-${id}`,
    keyPrefix: 'pk_live',
    scopes: ['read'],
    status: 'active',
    expiresAt: null,
    lastUsedAt: null,
    createdAt: new Date(),
  };
}

function webhook(tenantId: string, accountId: string): WebhookEntity {
  return {
    id: randomUUID(),
    tenantId,
    accountId,
    url: 'https://hooks.example.test/l466',
    events: ['student.created'],
    secretHash: 'secret-hash',
    description: null,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe.skipIf(!pool)('developer portal Postgres tenant isolation (PRC-L466)', () => {
  const keys = new PgApiKeyStore(pool!);
  const durable = new PgDeveloperPortalDurableStore(pool!);
  let keyA: ApiKeyEntity;
  let hookA: WebhookEntity;

  beforeAll(async () => {
    await ensurePgTestTenant(pool!, TENANT_A);
    await ensurePgTestTenant(pool!, TENANT_B);
    // PRC-M212 (db/sql/258): developer_portal_webhooks.account_id now references
    // developer_portal_accounts (platform-scoped), so the owning account must exist.
    await withPlatformScope(pool!, (client) =>
      client.query(
        `INSERT INTO developer_portal_accounts (id, name, email) VALUES ($1, 'L466 dev', $2)`,
        [ACCOUNT_A, `l466-${ACCOUNT_A}@example.test`],
      ),
    );
    keyA = await keys.createApiKey(apiKey(TENANT_A, ACCOUNT_A));
    hookA = await durable.createWebhook(webhook(TENANT_A, ACCOUNT_A));
  });

  afterAll(async () => {
    if (pool) {
      await withPgTenant(pool, TENANT_A, async (client) => {
        await client.query(`DELETE FROM developer_portal_api_keys WHERE tenant_id = $1`, [
          TENANT_A,
        ]);
        await client.query(`DELETE FROM developer_portal_webhooks WHERE tenant_id = $1`, [
          TENANT_A,
        ]);
      });
    }
    await closeSharedPgPools();
  });

  it("tenant B cannot read, list or revoke tenant A's API key", async () => {
    expect(await keys.getApiKeyById(keyA.id, TENANT_B)).toBeNull();
    const listedForB = await keys.listApiKeys({ tenantId: TENANT_B, accountId: ACCOUNT_A }, 1, 50);
    expect(listedForB).toEqual({ data: [], total: 0 });
    // No tenant predicate in this UPDATE: only RLS keeps B away from A's row.
    expect(await keys.updateApiKeyStatus(keyA.id, 'revoked', TENANT_B)).toBeNull();
    await keys.updateApiKeyLastUsed(keyA.id, new Date('2030-01-01T00:00:00Z'), TENANT_B);
    const own = await keys.getApiKeyById(keyA.id, TENANT_A);
    expect(own?.status).toBe('active');
    expect(own?.lastUsedAt).toBeNull();
  });

  it('a raw read under tenant B sees zero API-key rows of tenant A (RLS)', async () => {
    const res = await withPgTenant(pool!, TENANT_B, (client) =>
      client.query(`SELECT count(*)::int AS n FROM developer_portal_api_keys WHERE id = $1`, [
        keyA.id,
      ]),
    );
    expect((res.rows[0] as { n: number }).n).toBe(0);
    const ownRes = await withPgTenant(pool!, TENANT_A, (client) =>
      client.query(`SELECT count(*)::int AS n FROM developer_portal_api_keys WHERE id = $1`, [
        keyA.id,
      ]),
    );
    expect((ownRes.rows[0] as { n: number }).n).toBe(1);
  });

  it("tenant B never receives tenant A's webhooks", async () => {
    expect((await durable.listActiveWebhooksForTenant(TENANT_B)).map((w) => w.id)).not.toContain(
      hookA.id,
    );
    expect(await durable.listWebhooks({ tenantId: TENANT_B, accountId: ACCOUNT_A }, 1, 50)).toEqual(
      { data: [], total: 0 },
    );
    expect((await durable.listActiveWebhooksForTenant(TENANT_A)).map((w) => w.id)).toContain(
      hookA.id,
    );
  });

  it('within one tenant, another account sees none of the owner account keys or webhooks', async () => {
    expect(await keys.listApiKeys({ tenantId: TENANT_A, accountId: ACCOUNT_OTHER }, 1, 50)).toEqual(
      { data: [], total: 0 },
    );
    expect(
      await durable.listWebhooks({ tenantId: TENANT_A, accountId: ACCOUNT_OTHER }, 1, 50),
    ).toEqual({ data: [], total: 0 });
    const owner = await keys.listApiKeys({ tenantId: TENANT_A, accountId: ACCOUNT_A }, 1, 50);
    expect(owner.data.map((k) => k.id)).toEqual([keyA.id]);
  });
});
