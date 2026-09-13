/**
 * NotificationQueuePublisher backed by @proctira/queue-abstraction (W2-JOB-01).
 *
 * Publishes delivery/retry jobs onto the durable queue spine so a consumer
 * can call NotificationService.processQueuedDelivery after optional delay —
 * surviving gateway/worker restarts when the backend retains unacked messages.
 */
import { randomUUID } from 'node:crypto';

import type { QueueAdapter, QueueMessage } from '@proctira/queue-abstraction';
import { NOTIFICATION_DELIVERY_JOB_TYPE } from '@proctira/queue-abstraction';

import type { NotificationEntity } from './notification-repository.js';
import type { NotificationQueuePublisher } from './notification-service.js';

/** Payload carried on `notification.delivery` queue messages. */
export interface NotificationDeliveryJobPayload {
  notificationId: string;
  tenantId: string;
  channel: string;
  attempt: number;
}

/**
 * Maps notification delivery retries onto QueueAdapter.dispatch with delay
 * metadata (RabbitMQ x-delay / SQS DelaySeconds when the backend supports it).
 */
export class QueueNotificationDeliveryPublisher implements NotificationQueuePublisher {
  constructor(private readonly queue: QueueAdapter) {}

  async queueForDelivery(notification: NotificationEntity, delayMs: number): Promise<void> {
    const payload: NotificationDeliveryJobPayload = {
      notificationId: notification.id,
      tenantId: notification.tenantId,
      channel: notification.channel,
      attempt: notification.retryCount,
    };

    const message: QueueMessage<NotificationDeliveryJobPayload> = {
      id: randomUUID(),
      tenantId: notification.tenantId,
      type: NOTIFICATION_DELIVERY_JOB_TYPE,
      payload,
      timestamp: new Date().toISOString(),
      metadata: {
        correlationId: notification.id,
        delay: delayMs > 0 ? delayMs : undefined,
        maxRetries: notification.maxRetries,
        retryCount: notification.retryCount,
      },
    };

    await this.queue.dispatch(message, delayMs > 0 ? { delay: delayMs } : undefined);
  }
}
