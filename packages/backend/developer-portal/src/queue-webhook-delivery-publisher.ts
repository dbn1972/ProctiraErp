/**
 * Webhook delivery publisher backed by @proctira/queue-abstraction (W2-JOB-07).
 */
import { randomUUID } from 'node:crypto';

import type { OutboxStore, QueueAdapter, QueueMessage } from '@proctira/queue-abstraction';
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

/**
 * PRC-H046: webhook delivery publisher backed by the transactional outbox.
 * Delivery jobs are committed as outbox rows and published by OutboxRelay,
 * so a crash between the delivery row and the broker publish is recovered.
 * The plaintext signing secret is never persisted in the outbox row; the
 * consumer resolves it via WebhookSigningSecretResolver at send time.
 */
export class OutboxWebhookDeliveryPublisher implements WebhookDeliveryPublisher {
  constructor(private readonly outbox: OutboxStore) {}

  async enqueueDelivery(job: WebhookDeliveryJobPayload, delayMs = 0): Promise<void> {
    // PRC-M211: the job payload carries no signing secret (sealed on the webhook row).
    const persisted = { ...job };
    await this.outbox.enqueue({
      id: randomUUID(),
      tenantId: job.tenantId,
      aggregateType: 'webhook_delivery',
      aggregateId: job.deliveryId,
      eventType: WEBHOOK_DELIVERY_JOB_TYPE,
      payload: persisted,
      metadata: {
        correlationId: job.deliveryId,
        delay: delayMs > 0 ? delayMs : undefined,
        maxRetries: 5,
        retryCount: job.attempt,
      },
      dispatchMode: 'dispatch',
      availableAt: delayMs > 0 ? new Date(Date.now() + delayMs) : undefined,
    });
  }
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
