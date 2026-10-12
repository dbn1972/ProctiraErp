/**
 * PRC-H046: fan-out deliveries go through the transactional outbox (no
 * secret persisted), OutboxRelay publishes them, the delivery worker POSTs,
 * and the signature uses the secret from WebhookSigningSecretResolver.
 */
import {
  InMemoryDurableQueueAdapter,
  InMemoryDurableQueueStore,
  InMemoryOutboxStore,
  OutboxRelay,
} from '@proctira/queue-abstraction';
import { describe, expect, it } from 'vitest';
import { DeveloperPortalService } from './developer-portal-service.js';
import { InMemoryDeveloperPortalRepository } from './in-memory-repository.js';
import { OutboxWebhookDeliveryPublisher } from './queue-webhook-delivery-publisher.js';
import { createWebhookDeliveryWorker } from './webhook-delivery-worker.js';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

async function waitUntil(pred: () => Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!(await pred())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitUntil timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('PRC-H046 webhook fan-out via outbox', () => {
  it('enqueues to the outbox without the secret, relays, delivers and signs', async () => {
    const outbox = new InMemoryOutboxStore();
    const store = new InMemoryDurableQueueStore();
    const relayQueue = new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 });
    await relayQueue.connect();
    const repository = new InMemoryDeveloperPortalRepository();
    const posts: Array<Record<string, string>> = [];
    const service = new DeveloperPortalService(repository, undefined, {
      deliveryPublisher: new OutboxWebhookDeliveryPublisher(outbox),
      httpFetch: async (_url, init) => {
        posts.push(init.headers);
        return { status: 200, ok: true };
      },
      signingSecretResolver: {
        async resolveSigningSecret() {
          return 'decrypted-test-secret';
        },
      },
      // PRC-M211: webhook create requires secret storage (signing is mandatory).
      signingSecretWriter: { async storeSigningSecret() {} },
    });
    const account = await service.createAccount({ name: 'OEM', email: 'oem@example.com' });
    await service.createWebhook(account.id, TENANT_ID, {
      url: 'https://example.com/hooks',
      events: ['student.enrolled'],
    });

    const deliveries = await service.fanOutEvent(TENANT_ID, 'student.enrolled', { id: 's1' });
    expect(deliveries).toHaveLength(1);
    // Committed to the outbox, not yet on the broker; no secret persisted.
    expect(store.pendingCount).toBe(0);
    const rows = await outbox.listPending();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).not.toHaveProperty('signingSecret');

    const relay = new OutboxRelay({ store: outbox, queue: relayQueue });
    const worker = createWebhookDeliveryWorker({
      queue: new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 }),
      processor: service,
    });
    await worker.start();
    expect(await relay.tick()).toBe(1);
    await waitUntil(
      async () => (await repository.getDeliveryById(deliveries[0]!.id))?.status === 'delivered',
    );
    await worker.stop();
    await relayQueue.disconnect();
    expect(Object.keys(posts[0]!).some((h) => h.toLowerCase().includes('signature'))).toBe(true);
  });

  it('delivers to the CURRENT webhook URL, not the stale enqueued job URL (NEW-g7_platform-005 / PRC-L465)', async () => {
    const repository = new InMemoryDeveloperPortalRepository();
    const urls: string[] = [];
    const service = new DeveloperPortalService(repository, undefined, {
      // No deliveryPublisher: processQueuedDelivery is driven directly.
      httpFetch: async (url, _init) => {
        urls.push(url);
        return { status: 200, ok: true };
      },
      signingSecretResolver: {
        async resolveSigningSecret() {
          return 'decrypted-test-secret';
        },
      },
      signingSecretWriter: { async storeSigningSecret() {} },
    });
    const account = await service.createAccount({ name: 'OEM', email: 'oem@example.com' });
    const webhook = await service.createWebhook(account.id, TENANT_ID, {
      url: 'https://old.example.com/hooks',
      events: ['student.enrolled'],
    });

    // A delivery is created (job captures the OLD url).
    const delivery = await service.createDelivery(webhook.id, 'student.enrolled', { id: 's1' });

    // The webhook is re-pointed to a new URL AFTER the job was enqueued.
    await service.updateWebhook(account.id, TENANT_ID, webhook.id, {
      url: 'https://new.example.com/hooks',
    });

    await service.processQueuedDelivery(TENANT_ID, {
      tenantId: TENANT_ID,
      webhookId: webhook.id,
      deliveryId: delivery.id,
      event: 'student.enrolled',
      url: 'https://old.example.com/hooks',
      body: { id: 's1' },
      attempt: 0,
    });

    expect(urls).toEqual(['https://new.example.com/hooks']);
    const after = await repository.getDeliveryById(delivery.id);
    expect(after?.status).toBe('delivered');
  });
});
