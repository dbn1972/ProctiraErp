/**
 * PRC-L576 — notification delivery is claimed before it is sent, on a real, migrated
 * Postgres (runtime app role, RLS enforced).
 *
 * processQueuedDelivery only skipped rows that were already delivered/read, so two workers
 * (a redelivered queue message, a reclaim and a retry) that picked up the same notification
 * both called the channel sender. db/sql/271 adds delivery_claimed_at / delivery_claim_token;
 * delivery proceeds only for the caller whose conditional UPDATE wins the claim, and the
 * result write clears it. The status enum/CHECK is unchanged (twin PRC-M308 boundary).
 *
 * Fails closed when CI=true or REQUIRE_LIVE_TESTS=1 and DATABASE_URL is unset (W3-TEST-03).
 */
import { randomUUID } from 'node:crypto';
import { withPgTenant } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotificationService, type EmailSender } from './notification-service.js';
import { HybridNotificationRepository } from './pg-notification-repository.js';

// Same contract as @proctira/testing requireLiveDatabaseUrl (not a dependency of this package).
const SUITE = 'notification-delivery-claim.live.test';
const DATABASE_URL = process.env['DATABASE_URL']?.trim() || undefined;
const liveRequired =
  process.env['ALLOW_LIVE_TEST_SKIP'] !== '1' &&
  (process.env['REQUIRE_LIVE_TESTS'] === '1' ||
    process.env['CI'] === 'true' ||
    process.env['CI'] === '1');
if (!DATABASE_URL && liveRequired) {
  throw new Error(`[W3-TEST-03] Live suite "${SUITE}" has no DATABASE_URL.`);
}
if (!DATABASE_URL) console.warn(`WARNING: [W3-TEST-03] ${SUITE} skipped (no DATABASE_URL).`);

/** Counts sends and holds each one briefly so concurrent workers overlap. */
class SlowCountingEmailSender implements EmailSender {
  calls = 0;
  async send() {
    this.calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { success: true, messageId: randomUUID() };
  }
}

describe.skipIf(!DATABASE_URL)('PRC-L576 notification delivery claim (live)', () => {
  let pool: pg.Pool;
  let repo: HybridNotificationRepository;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    repo = new HybridNotificationRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function queuedEmail() {
    const tenantId = randomUUID();
    await ensurePgTestTenant(pool, tenantId);
    const template = await repo.createTemplate({
      id: randomUUID(),
      tenantId,
      name: 'Fee reminder',
      channel: 'email',
      subject: 'Reminder',
      body: 'Hello {{name}}',
      variables: ['name'],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const notification = await repo.createNotification({
      id: randomUUID(),
      tenantId,
      channel: 'email',
      templateId: template.id,
      recipientUserId: `user-${randomUUID()}`,
      variables: { name: 'Asha' },
      status: 'failed', // a retry waiting in the queue
      priority: 'normal',
      retryCount: 1,
      maxRetries: 3,
      sentAt: new Date(),
      deliveredAt: null,
      readAt: null,
      failedAt: new Date(),
      failureReason: 'transient',
      webhookUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return { tenantId, notification };
  }

  it('two concurrent processQueuedDelivery calls send exactly once', async () => {
    const { tenantId, notification } = await queuedEmail();
    const sender = new SlowCountingEmailSender();
    const service = new NotificationService(repo, sender);

    await Promise.all([
      service.processQueuedDelivery(tenantId, notification.id),
      service.processQueuedDelivery(tenantId, notification.id),
    ]);

    expect(sender.calls).toBe(1);
    const stored = await repo.getNotificationById(tenantId, notification.id);
    expect(stored?.status).toBe('delivered');
  });

  it('the result write releases the claim, so a later failure retry can claim again', async () => {
    const { tenantId, notification } = await queuedEmail();
    const failing: EmailSender = {
      send: async () => ({ success: false, error: 'smtp down' }),
    };
    await new NotificationService(repo, failing).processQueuedDelivery(tenantId, notification.id);
    const claim = await withPgTenant(pool, tenantId, (client) =>
      client.query(
        `SELECT delivery_claim_token, delivery_claimed_at FROM notifications WHERE id = $1`,
        [notification.id],
      ),
    );
    expect(claim.rows[0]).toEqual({ delivery_claim_token: null, delivery_claimed_at: null });

    const sender = new SlowCountingEmailSender();
    await new NotificationService(repo, sender).processQueuedDelivery(tenantId, notification.id);
    expect(sender.calls).toBe(1);
  });
});
