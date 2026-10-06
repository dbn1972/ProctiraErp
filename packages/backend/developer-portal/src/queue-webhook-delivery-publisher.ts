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
  /** Optional plaintext signing secret (only when caller still has it). */
  signingSecret?: string;
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
    const { signingSecret: _secret, ...persisted } = job;
    await this.outbox.enqueue({
      id: randomUUID(),
      tenantId: job.tenantId,
      aggregateType: 'webhook_delivery',
      aggregateId: job.deliveryId,
      eventType: WEBHOOK_DELIVERY_JOB_TYPE,
      payload: persisted,
      // PRC-M360: the retry backoff is scheduled by the outbox (availableAt);
      // no transport delay is requested, so backends without delayed delivery
      // (Kafka, SQS FIFO / >15 min) relay the row unchanged once it is due.
      metadata: {
        correlationId: job.deliveryId,
        maxRetries: 5,
        retryCount: job.attempt,
      },
      dispatchMode: 'dispatch',
      ...(delayMs > 0 ? { availableAt: new Date(Date.now() + delayMs) } : {}),
    });
  }
}

export interface QueueWebhookDeliveryPublisherOptions {
  /**
   * Outbox used for delayed (retry) deliveries. When set, any delay is
   * scheduled via the outbox `availableAt` and the broker never sees a delay,
   * which is required for backends that refuse delayed delivery (Kafka; SQS
   * FIFO or > 15 min). Without it a delayed enqueue relies on broker delay and
   * rejects with QueueUnsupportedOperationError on those backends.
   */
  delayedVia?: OutboxStore;
}

/**
 * Direct broker publisher (tests / single-process tooling). Production wiring
 * (`createWebhookDeliveryPublisherFromEnv`) uses OutboxWebhookDeliveryPublisher.
 */
export class QueueWebhookDeliveryPublisher implements WebhookDeliveryPublisher {
  private readonly delayed: OutboxWebhookDeliveryPublisher | undefined;

  constructor(
    private readonly queue: QueueAdapter,
    options: QueueWebhookDeliveryPublisherOptions = {},
  ) {
    this.delayed = options.delayedVia
      ? new OutboxWebhookDeliveryPublisher(options.delayedVia)
      : undefined;
  }

  async enqueueDelivery(job: WebhookDeliveryJobPayload, delayMs = 0): Promise<void> {
    if (delayMs > 0 && this.delayed) {
      await this.delayed.enqueueDelivery(job, delayMs);
      return;
    }
    const message: QueueMessage<WebhookDeliveryJobPayload> = {
      id: randomUUID(),
      tenantId: job.tenantId,
      type: WEBHOOK_DELIVERY_JOB_TYPE,
      payload: job,
      timestamp: new Date().toISOString(),
      metadata: {
        correlationId: job.deliveryId,
        maxRetries: 5,
        retryCount: job.attempt,
      },
    };
    await this.queue.dispatch(message, delayMs > 0 ? { delay: delayMs } : undefined);
  }
}
