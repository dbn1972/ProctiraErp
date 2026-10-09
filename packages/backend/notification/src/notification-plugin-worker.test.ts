/**
 * g7_platform-003 — the notification plugin starts the delivery/retry worker when a
 * queuePublisher and a deliveryWorkerQueue are provided, so published retry jobs are consumed.
 *
 * This test FAILS without the fix: before, notification-plugin never instantiated
 * createNotificationDeliveryWorker, so a retry enqueued on the durable store would sit unconsumed
 * and the notification would stay 'failed' forever.
 */
import Fastify from 'fastify';
import {
  InMemoryDurableQueueAdapter,
  InMemoryDurableQueueStore,
} from '@proctira/queue-abstraction';
import { describe, expect, it } from 'vitest';

import { InMemoryNotificationRepository } from './in-memory-repository.js';
import { notificationPlugin } from './notification-plugin.js';
import { NotificationService, type EmailSender } from './notification-service.js';
import { QueueNotificationDeliveryPublisher } from './queue-notification-publisher.js';

const TENANT_ID = 'tenant-plugin-worker';

async function waitUntil(pred: () => boolean | Promise<boolean>, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!(await pred())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitUntil timed out');
    await new Promise((r) => setTimeout(r, 15));
  }
}

describe('g7_platform-003 notification plugin starts retry worker', () => {
  it('consumes a published retry and delivers it', async () => {
    const store = new InMemoryDurableQueueStore();
    const repository = new InMemoryNotificationRepository();
    repository.seedUsers([
      { id: 'user-1', roleIds: ['teacher'], areaIds: ['a1'], institutionIds: ['i1'] },
    ]);
    const template = await repository.createTemplate({
      id: 'tpl-plugin',
      tenantId: TENANT_ID,
      name: 'Plugin',
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
        return sendCalls === 1 ? { success: false, error: 'transient' } : { success: true };
      },
    };

    const publishAdapter = new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 });
    await publishAdapter.connect();
    const publisher = new QueueNotificationDeliveryPublisher(publishAdapter);
    const consumerAdapter = new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 });

    // Drive the initial failed send through a service that shares the repository + publisher, so
    // a retry is enqueued on the shared durable store.
    const seedService = new NotificationService(
      repository,
      flakyEmail,
      undefined,
      undefined,
      undefined,
      publisher,
      { retryBaseDelayMs: 1, emailMaxRetries: 3 },
    );

    const app = Fastify();
    // The plugin builds its OWN NotificationService; give it the same repository + email sender so
    // the retry (processed by the plugin's worker) delivers the record created by seedService.
    await app.register(notificationPlugin, {
      repository,
      emailSender: flakyEmail,
      queuePublisher: publisher,
      deliveryWorkerQueue: consumerAdapter,
      prefix: '/notifications',
    });
    await app.ready(); // triggers onReady → worker.start()

    const [created] = await seedService.send(TENANT_ID, {
      templateId: template.id,
      channel: 'email',
      recipients: { userIds: ['user-1'] },
      variables: { name: 'Ada' },
    });
    expect(created.status).toBe('failed');
    expect(store.pendingCount).toBeGreaterThanOrEqual(1);

    // The plugin's worker (started onReady) must consume the retry and deliver it.
    await waitUntil(async () => {
      const current = await repository.getNotificationById(TENANT_ID, created.id);
      return current?.status === 'delivered';
    });
    const final = await repository.getNotificationById(TENANT_ID, created.id);
    expect(final?.status).toBe('delivered');

    await app.close(); // triggers onClose → worker.stop()
    await publishAdapter.disconnect();
  });
});
