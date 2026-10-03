/**
 * Webhook delivery publisher backed by @proctira/queue-abstraction (W2-JOB-07).
 */
import { randomUUID } from 'node:crypto';

import type {
  NewOutboxEntry,
  OutboxStore,
  QueueAdapter,
  QueueMessage,
} from '@proctira/queue-abstraction';
import { WEBHOOK_DELIVERY_JOB_TYPE } from '@proctira/queue-abstraction';

/** Payload carried on `webhook.delivery` queue messages. */
export interface WebhookDeliveryJobPayload {
  deliveryId: string;
  webhookId: string;
  tenantId: string;
  url: string;
  event: string;
  body: Record<string, unknown>;
  /*
   * PRC-M211: no signing secret here. The worker loads the sealed secret from the webhook row,
   * so plaintext secrets never sit in the broker.
   */
  attempt: number;
}

export interface WebhookDeliveryPublisher {
  enqueueDelivery(job: WebhookDeliveryJobPayload, delayMs?: number): Promise<void>;
}

export class QueueWebhookDeliveryPublisher implements WebhookDeliveryPublisher {
  constructor(private readonly queue: QueueAdapter) {}

  async enqueueDelivery(job: WebhookDeliveryJobPayload, delayMs = 0): Promise<void> {
    const message: QueueMessage<WebhookDeliveryJobPayload> = {
      id: randomUUID(),
      tenantId: job.tenantId,
      type: WEBHOOK_DELIVERY_JOB_TYPE,
      payload: job,
      timestamp: new Date().toISOString(),
      metadata: {
        correlationId: job.deliveryId,
        delay: delayMs > 0 ? delayMs : undefined,
        maxRetries: 5,
        retryCount: job.attempt,
      },
    };

    await this.queue.dispatch(message, delayMs > 0 ? { delay: delayMs } : undefined);
  }
}

function deliveryMetadata(job: WebhookDeliveryJobPayload, delayMs: number) {
  return {
    correlationId: job.deliveryId,
    delay: delayMs > 0 ? delayMs : undefined,
    maxRetries: 5,
    retryCount: job.attempt,
  };
}

/**
 * PRC-H046: transactional-outbox delivery publisher. The delivery job is written as an outbox
 * row (in the same transaction as the delivery row when the repository supports
 * `createDeliveryWithOutbox`); OutboxRelay dispatches it to the queue afterwards, so a broker
 * outage can no longer leave a delivery row that is never sent.
 */
export class OutboxWebhookDeliveryPublisher implements WebhookDeliveryPublisher {
  constructor(readonly outbox: OutboxStore) {}

  buildEntry(job: WebhookDeliveryJobPayload, delayMs = 0): NewOutboxEntry {
    return {
      id: randomUUID(),
      tenantId: job.tenantId,
      aggregateType: 'webhook_delivery',
      aggregateId: job.deliveryId,
      eventType: WEBHOOK_DELIVERY_JOB_TYPE,
      payload: job,
      // Delay is applied by availableAt (relay claims it later), not again on dispatch.
      metadata: deliveryMetadata(job, 0),
      dispatchMode: 'dispatch',
      ...(delayMs > 0 ? { availableAt: new Date(Date.now() + delayMs) } : {}),
    };
  }

  async enqueueDelivery(job: WebhookDeliveryJobPayload, delayMs = 0): Promise<void> {
    await this.outbox.enqueue(this.buildEntry(job, delayMs));
  }
}
