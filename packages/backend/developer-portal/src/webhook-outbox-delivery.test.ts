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
});
