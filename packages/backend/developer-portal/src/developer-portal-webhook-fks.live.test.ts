/**
 * PRC-M212 — live proof that webhooks reference a real account and deliveries
 * reference a real webhook in the same tenant (db/sql/258).
 *
 * Before 258: a delivery for a missing or another tenant's webhook, and a
 * webhook for a missing account, are accepted (RED), and deleting a webhook
 * leaves its deliveries behind. After: 23503 on the named constraint and the
 * deliveries are removed with the webhook (GREEN).
 */
import { randomUUID } from 'node:crypto';

import { withPgTenant, withPlatformScope } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { WebhookEntity } from './developer-portal-repository.js';
import { PgDeveloperPortalDurableStore } from './pg-durable-store.js';

const CONNECTION = process.env['DATABASE_URL'] ?? process.env['MIGRATOR_DATABASE_URL'] ?? '';
if (!CONNECTION && (process.env['CI'] === 'true' || process.env['REQUIRE_LIVE_TESTS'] === '1')) {
  throw new Error('developer-portal-webhook-fks.live.test requires DATABASE_URL (no silent skip)');
}

describe.skipIf(!CONNECTION)('developer-portal webhook FKs (live)', () => {
  let pool: pg.Pool;
  let store: PgDeveloperPortalDurableStore;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const accountId = randomUUID();

  function webhook(tenantId: string, overrides: Partial<WebhookEntity> = {}): WebhookEntity {
    const now = new Date();
    return {
      id: randomUUID(),
      tenantId,
      accountId,
      url: 'https://hooks.example.test/live',
      events: ['student.created'],
      secretHash: 'live-test-hash',
      description: null,
      active: true,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  async function insertDelivery(tenantId: string, webhookId: string): Promise<unknown> {
    try {
      await withPgTenant(pool, tenantId, (client) =>
        client.query(
          `INSERT INTO developer_portal_webhook_deliveries (id, tenant_id, webhook_id, event)
           VALUES ($1, $2, $3, 'student.created')`,
          [randomUUID(), tenantId, webhookId],
        ),
      );
      return null;
    } catch (error) {
      return error;
    }
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: CONNECTION });
    store = new PgDeveloperPortalDurableStore(pool);
    await ensurePgTestTenant(pool, tenantA);
    await ensurePgTestTenant(pool, tenantB);
    await withPlatformScope(pool, (client) =>
      client.query(
        `INSERT INTO developer_portal_accounts (id, name, email)
         VALUES ($1, 'Live FK dev', $2)`,
        [accountId, `fk-${accountId}@example.test`],
      ),
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it('a delivery for a webhook that does not exist is rejected', async () => {
    expect(await insertDelivery(tenantA, randomUUID())).toMatchObject({
      code: '23503',
      constraint: 'developer_portal_webhook_deliveries_webhook_fk',
    });
  });

  it('a delivery cannot point at another tenant’s webhook', async () => {
    const own = await store.createWebhook(webhook(tenantA));
    const foreign = await store.createWebhook(webhook(tenantB));
    expect(await insertDelivery(tenantA, own.id)).toBeNull();
    expect(await insertDelivery(tenantA, foreign.id)).toMatchObject({
      code: '23503',
      constraint: 'developer_portal_webhook_deliveries_webhook_fk',
    });
  });

  it('a webhook for an account that does not exist is rejected', async () => {
    const error = await store
      .createWebhook(webhook(tenantA, { accountId: randomUUID() }))
      .catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: '23503',
      constraint: 'developer_portal_webhooks_account_fk',
    });
  });

  it('deleting a webhook removes its deliveries (ON DELETE CASCADE)', async () => {
    // Same statement PgDeveloperPortalDurableStore.deleteWebhook runs, under the tenant.
    const hook = await store.createWebhook(webhook(tenantA));
    expect(await insertDelivery(tenantA, hook.id)).toBeNull();
    const remaining = await withPgTenant(pool, tenantA, async (client) => {
      const deleted = await client.query(`DELETE FROM developer_portal_webhooks WHERE id = $1`, [
        hook.id,
      ]);
      expect(deleted.rowCount).toBe(1);
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM developer_portal_webhook_deliveries WHERE webhook_id = $1`,
        [hook.id],
      );
      return (rows[0] as { n: number }).n;
    });
    expect(remaining).toBe(0);
  });
});
