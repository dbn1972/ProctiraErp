/**
 * Webhook delivery publisher backed by @proctira/queue-abstraction (W2-JOB-07).
 */
import { randomUUID } from 'node:crypto';

import type { QueueAdapter, QueueMessage } from '@proctira/queue-abstraction';
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
