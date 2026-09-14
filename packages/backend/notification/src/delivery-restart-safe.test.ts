/**
 * Restart-safe integration proof for notification delivery via queue-abstraction (W2-JOB-01).
 *
 * Simulates a consumer crash mid-processQueuedDelivery using InMemoryDurableQueueStore,
 * then restarts the worker against the same durable store and asserts delivery
 * completes after redelivery.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryDurableQueueAdapter,
  InMemoryDurableQueueStore,
  NOTIFICATION_DELIVERY_CONSUME_TOPIC,
} from '@proctira/queue-abstraction';

import { InMemoryNotificationRepository } from './in-memory-repository.js';
import { createNotificationDeliveryWorker } from './notification-delivery-worker.js';
import { NotificationService, type EmailSender } from './notification-service.js';
import { QueueNotificationDeliveryPublisher } from './queue-notification-publisher.js';

const TENANT_ID = 'tenant-notif-spine';

async function waitUntil(pred: () => boolean | Promise<boolean>, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!(await pred())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitUntil timed out');
    await new Promise((r) => setTimeout(r, 15));
  }
}

describe('notification delivery restart-safe spine', () => {
  let store: InMemoryDurableQueueStore;
  let repository: InMemoryNotificationRepository;

  beforeEach(() => {
    store = new InMemoryDurableQueueStore();
    repository = new InMemoryNotificationRepository();
  });

  it('redelivers and delivers after consumer crash before ack', async () => {
    repository.seedUsers([
      { id: 'user-1', roleIds: ['teacher'], areaIds: ['a1'], institutionIds: ['i1'] },
    ]);

    const template = await repository.createTemplate({
      id: 'tpl-spine',
      tenantId: TENANT_ID,
      name: 'Spine',
      channel: 'email',
      subject: 'Hello {{name}}',
      body: 'Hi {{name}}',
      variables: ['name'],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    let sendCalls = 0;

    const flakyEmail: EmailSender = {
      async send() {
        sendCalls += 1;
        if (sendCalls === 1) {
          return { success: false, error: 'transient SMTP failure' };
        }
        return { success: true };
      },
    };

    const publishAdapter = new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 });
    await publishAdapter.connect();
    const publisher = new QueueNotificationDeliveryPublisher(publishAdapter);

    const service = new NotificationService(
      repository,
      flakyEmail,
      undefined,
      undefined,
      undefined,
      publisher,
      { retryBaseDelayMs: 1, emailMaxRetries: 3 },
    );

    const [created] = await service.send(TENANT_ID, {
      templateId: template.id,
      channel: 'email',
      recipients: { userIds: ['user-1'] },
      variables: { name: 'Ada' },
    });

    expect(created.status).toBe('failed');
    expect(store.pendingCount).toBeGreaterThanOrEqual(1);

    let hangResolve!: () => void;
    const hang = new Promise<void>((r) => {
      hangResolve = r;
    });
    let firstAttempts = 0;

    const crashAdapter = new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 });
    const crashWorker = createNotificationDeliveryWorker({
      queue: crashAdapter,
      topic: NOTIFICATION_DELIVERY_CONSUME_TOPIC,
      processor: {
        processQueuedDelivery: async () => {
          firstAttempts += 1;
          await hang;
          return false;
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
    const resumePublisher = new QueueNotificationDeliveryPublisher(resumeAdapter);
    const resumeService = new NotificationService(
      repository,
      flakyEmail,
      undefined,
      undefined,
      undefined,
      resumePublisher,
      { retryBaseDelayMs: 1, emailMaxRetries: 3 },
    );
    const resumeWorker = createNotificationDeliveryWorker({
      queue: resumeAdapter,
      topic: NOTIFICATION_DELIVERY_CONSUME_TOPIC,
      processor: resumeService,
    });
    await resumeWorker.start();

    await waitUntil(async () => {
      const current = await repository.getNotificationById(TENANT_ID, created.id);
      return current?.status === 'delivered';
    });

    const final = await repository.getNotificationById(TENANT_ID, created.id);
    expect(final?.status).toBe('delivered');
    expect(final?.deliveredAt).toBeTruthy();

    // Idempotent second process after already delivered
    const again = await resumeService.processQueuedDelivery(TENANT_ID, created.id);
    expect(again).toBe(true);
    expect((await repository.getNotificationById(TENANT_ID, created.id))?.status).toBe(
      'delivered',
    );

    hangResolve();
    await resumeWorker.stop();
    await publishAdapter.disconnect();
  });
});
