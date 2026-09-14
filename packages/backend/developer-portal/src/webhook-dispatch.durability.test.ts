/**
 * W2-JOB-07: webhook dispatcher durability across process restart.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryDurableQueueAdapter,
  InMemoryDurableQueueStore,
  WEBHOOK_DELIVERY_CONSUME_TOPIC,
} from '@proctira/queue-abstraction';

import { DeveloperPortalService } from './developer-portal-service.js';
import { InMemoryDeveloperPortalRepository } from './in-memory-repository.js';
import { QueueWebhookDeliveryPublisher } from './queue-webhook-delivery-publisher.js';
import { createWebhookDeliveryWorker } from './webhook-delivery-worker.js';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

async function waitUntil(pred: () => boolean | Promise<boolean>, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!(await pred())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitUntil timed out');
    await new Promise((r) => setTimeout(r, 15));
  }
}

describe('W2-JOB-07 webhook dispatcher durability', () => {
  let store: InMemoryDurableQueueStore;
  let repository: InMemoryDeveloperPortalRepository;

  beforeEach(() => {
    store = new InMemoryDurableQueueStore();
    repository = new InMemoryDeveloperPortalRepository();
  });

  it('redelivers and completes HTTP delivery after consumer crash before ack', async () => {
    const publishAdapter = new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 });
    await publishAdapter.connect();
    const publisher = new QueueWebhookDeliveryPublisher(publishAdapter);

    let posts = 0;
    const service = new DeveloperPortalService(repository, undefined, {
      deliveryPublisher: publisher,
      httpFetch: async () => {
        posts += 1;
        return { status: 200, ok: true };
      },
    });

    const account = await service.createAccount({
      name: 'OEM',
      email: 'oem-spine@example.com',
    });
    const webhook = await service.createWebhook(account.id, TENANT_ID, {
      url: 'https://example.com/hooks',
      events: ['*'],
    });

    const delivery = await service.createDelivery(webhook.id, 'student.created', {
      studentId: 's1',
    });
    expect(delivery.status).toBe('pending');
    expect(store.pendingCount).toBeGreaterThanOrEqual(1);

    let hangResolve!: () => void;
    const hang = new Promise<void>((r) => {
      hangResolve = r;
    });
    let firstAttempts = 0;

    const crashAdapter = new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 });
    const crashWorker = createWebhookDeliveryWorker({
      queue: crashAdapter,
      processor: {
        processQueuedDelivery: async () => {
          firstAttempts += 1;
          await hang;
        },
      },
    });
    await crashWorker.start();
    await waitUntil(() => store.inFlightCount === 1);
    expect(firstAttempts).toBe(1);

    await crashWorker.stop();
    expect(store.pendingCount).toBeGreaterThanOrEqual(1);
    expect(store.inFlightCount).toBe(0);

    const resumeAdapter = new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 });
    const resumePublisher = new QueueWebhookDeliveryPublisher(resumeAdapter);
    const resumeService = new DeveloperPortalService(repository, undefined, {
      deliveryPublisher: resumePublisher,
      httpFetch: async () => {
        posts += 1;
        return { status: 200, ok: true };
      },
    });
    const resumeWorker = createWebhookDeliveryWorker({
      queue: resumeAdapter,
      topic: WEBHOOK_DELIVERY_CONSUME_TOPIC,
      processor: resumeService,
    });
    await resumeWorker.start();
    await waitUntil(async () => {
      const d = await repository.getDeliveryById(delivery.id);
      return d?.status === 'delivered';
    });
    await resumeWorker.stop();
    hangResolve();

    const done = await repository.getDeliveryById(delivery.id);
    expect(done?.status).toBe('delivered');
    expect(posts).toBeGreaterThanOrEqual(1);
    expect(store.pendingCount).toBe(0);
  });
});
