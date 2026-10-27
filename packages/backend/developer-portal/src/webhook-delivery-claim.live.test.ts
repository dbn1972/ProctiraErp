/**
 * PRC-L464 — live proof that a pending webhook delivery can be claimed by
 * exactly one worker, and that an expired claim can be reclaimed (db/sql/259).
 *
 * Before 259 / the claim method: there is no claim at all, so every concurrent
 * worker would send (RED: the claim query fails — no claimed_at column — or the
 * method is missing). After: of five concurrent claims exactly one wins; a live
 * lease blocks a reclaim, an expired one allows it; terminal rows are never
 * claimed (GREEN). Runs as the runtime role under withPgTenant.
 */
import { randomUUID } from 'node:crypto';

import { withPgTenant, withPlatformScope } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PgDeveloperPortalDurableStore } from './pg-durable-store.js';

const CONNECTION = process.env['DATABASE_URL'] ?? process.env['MIGRATOR_DATABASE_URL'] ?? '';
if (!CONNECTION && (process.env['CI'] === 'true' || process.env['REQUIRE_LIVE_TESTS'] === '1')) {
  throw new Error('webhook-delivery-claim.live.test requires DATABASE_URL (no silent skip)');
}

describe.skipIf(!CONNECTION)('webhook delivery claim (live)', () => {
  let pool: pg.Pool;
  let store: PgDeveloperPortalDurableStore;
  const tenantId = randomUUID();
  const accountId = randomUUID();
  const webhookId = randomUUID();

  async function insertDelivery(status: 'pending' | 'delivered' = 'pending'): Promise<string> {
    const id = randomUUID();
    await withPgTenant(pool, tenantId, (client) =>
      client.query(
        `INSERT INTO developer_portal_webhook_deliveries (id, tenant_id, webhook_id, event, status)
         VALUES ($1, $2, $3, 'student.enrolled', $4)`,
        [id, tenantId, webhookId, status],
      ),
    );
    return id;
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: CONNECTION, max: 8 });
    store = new PgDeveloperPortalDurableStore(pool);
    await ensurePgTestTenant(pool, tenantId);
    await withPlatformScope(pool, (client) =>
      client.query(
        `INSERT INTO developer_portal_accounts (id, name, email) VALUES ($1, 'Claim dev', $2)`,
        [accountId, `claim-${accountId}@example.test`],
      ),
    );
    await withPgTenant(pool, tenantId, (client) =>
      client.query(
        `INSERT INTO developer_portal_webhooks (id, tenant_id, account_id, url, secret_hash)
         VALUES ($1, $2, $3, 'https://hooks.example.test/claim', 'hash')`,
        [webhookId, tenantId, accountId],
      ),
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it('five concurrent claims on one pending delivery: exactly one wins', async () => {
    const id = await insertDelivery();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => store.claimDelivery(tenantId, id, randomUUID(), 60_000)),
    );
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(results.find((r) => r !== null)).toMatchObject({ id, status: 'pending' });
  });

  it('a live lease blocks a reclaim; an expired lease allows it', async () => {
    const id = await insertDelivery();
    expect(await store.claimDelivery(tenantId, id, randomUUID(), 60_000)).not.toBeNull();
    expect(await store.claimDelivery(tenantId, id, randomUUID(), 60_000)).toBeNull();
    // Lease 0 ms: the earlier claim (previous transaction) is already expired.
    const token = randomUUID();
    expect(await store.claimDelivery(tenantId, id, token, 0)).not.toBeNull();
    const { rows } = await withPgTenant(pool, tenantId, (client) =>
      client.query(
        `SELECT claim_token::text AS token, claimed_at IS NOT NULL AS claimed
           FROM developer_portal_webhook_deliveries WHERE id = $1`,
        [id],
      ),
    );
    expect(rows[0]).toEqual({ token, claimed: true });
  });

  it('a delivered (terminal) row is never claimed', async () => {
    const id = await insertDelivery('delivered');
    expect(await store.claimDelivery(tenantId, id, randomUUID(), 0)).toBeNull();
  });

  it('another tenant cannot claim the delivery', async () => {
    const id = await insertDelivery();
    const otherTenant = randomUUID();
    await ensurePgTestTenant(pool, otherTenant);
    expect(await store.claimDelivery(otherTenant, id, randomUUID(), 0)).toBeNull();
    expect(await store.claimDelivery(tenantId, id, randomUUID(), 0)).not.toBeNull();
  });
});
