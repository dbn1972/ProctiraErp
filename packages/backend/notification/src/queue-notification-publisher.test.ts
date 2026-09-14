/**
 * Unit tests for QueueNotificationDeliveryPublisher (W2-JOB-01 queue bridge).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  NOTIFICATION_DELIVERY_JOB_TYPE,
  InMemoryDurableQueueAdapter,
  InMemoryDurableQueueStore,
  buildTenantName,
} from '@proctira/queue-abstraction';

import type { NotificationEntity } from './notification-repository.js';
import { QueueNotificationDeliveryPublisher } from './queue-notification-publisher.js';

function sampleNotification(overrides?: Partial<NotificationEntity>): NotificationEntity {
  return {
    id: 'notif-1',
    tenantId: 't1',
    channel: 'email',
    templateId: 'tpl-1',
    recipientUserId: 'user-1',
    variables: { name: 'Ada' },
    status: 'failed',
    priority: 'normal',
    retryCount: 1,
    maxRetries: 3,
    sentAt: new Date(),
    deliveredAt: null,
    readAt: null,
    failedAt: new Date(),
    failureReason: 'SMTP down',
    webhookUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('QueueNotificationDeliveryPublisher', () => {
  let store: InMemoryDurableQueueStore;
  let adapter: InMemoryDurableQueueAdapter;

  beforeEach(async () => {
    store = new InMemoryDurableQueueStore();
    adapter = new InMemoryDurableQueueAdapter({ store });
    await adapter.connect();
  });

  afterEach(async () => {
    if (adapter.isConnected()) await adapter.disconnect();
  });

  it('dispatches notification.delivery with delay metadata', async () => {
    const publisher = new QueueNotificationDeliveryPublisher(adapter);
    await publisher.queueForDelivery(sampleNotification(), 2000);

    expect(store.pendingCount).toBe(1);
    const entry = store.pending[0]!;
    expect(entry.routingKey).toBe(buildTenantName('t1', NOTIFICATION_DELIVERY_JOB_TYPE));
    expect(entry.message.type).toBe(NOTIFICATION_DELIVERY_JOB_TYPE);
    expect(entry.message.metadata?.delay).toBe(2000);
    expect(entry.message.payload).toMatchObject({
      notificationId: 'notif-1',
      tenantId: 't1',
      attempt: 1,
    });
  });

  it('omits delay when delayMs is zero', async () => {
    const publisher = new QueueNotificationDeliveryPublisher(adapter);
    await publisher.queueForDelivery(sampleNotification(), 0);
    expect(store.pending[0]!.message.metadata?.delay).toBeUndefined();
  });
});
