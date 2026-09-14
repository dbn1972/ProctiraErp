/**
 * Webhook HTTP delivery consumer (W2-JOB-07).
 *
 * Consumes `tenant.*.webhook.delivery` jobs and calls
 * DeveloperPortalService.processQueuedDelivery. Survives process restart when
 * the queue backend retains unacked messages. Ack only after handler success.
 */
import type { QueueAdapter, QueueMessage } from '@proctira/queue-abstraction';
import {
  WEBHOOK_DELIVERY_CONSUME_TOPIC,
  WEBHOOK_DELIVERY_JOB_TYPE,
} from '@proctira/queue-abstraction';

import type { WebhookDeliveryJobPayload } from './queue-webhook-delivery-publisher.js';

export interface WebhookDeliveryWorkerLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface WebhookDeliveryProcessor {
  processQueuedDelivery(job: WebhookDeliveryJobPayload): Promise<void>;
}

export interface WebhookDeliveryWorkerOptions {
  queue: QueueAdapter;
  processor: WebhookDeliveryProcessor;
  topic?: string;
  groupId?: string;
  logger?: WebhookDeliveryWorkerLogger;
}

export interface WebhookDeliveryWorker {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly running: boolean;
}

function isWebhookPayload(payload: unknown): payload is WebhookDeliveryJobPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as WebhookDeliveryJobPayload).deliveryId === 'string' &&
    typeof (payload as WebhookDeliveryJobPayload).url === 'string'
  );
}

export function createWebhookDeliveryWorker(
  options: WebhookDeliveryWorkerOptions,
): WebhookDeliveryWorker {
  let running = false;

  return {
    get running() {
      return running;
    },
    async start() {
      if (running) return;
      const topic = options.topic ?? WEBHOOK_DELIVERY_CONSUME_TOPIC;
      if (!options.queue.isConnected()) {
        await options.queue.connect();
      }
      await options.queue.consume(
        {
          topic,
          groupId: options.groupId ?? 'webhook-delivery-workers',
          autoAck: false,
        },
        async (message: QueueMessage) => {
          if (message.type !== WEBHOOK_DELIVERY_JOB_TYPE && !isWebhookPayload(message.payload)) {
            options.logger?.error(
              { type: message.type, id: message.id },
              'webhook-delivery worker ignored unexpected message',
            );
            return;
          }
          if (!isWebhookPayload(message.payload)) {
            throw new Error(`Invalid webhook delivery payload on message ${message.id}`);
          }
          options.logger?.info(
            {
              tenantId: message.tenantId,
              deliveryId: message.payload.deliveryId,
              messageId: message.id,
            },
            'webhook-delivery worker processing job',
          );
          await options.processor.processQueuedDelivery(message.payload);
          options.logger?.info(
            { deliveryId: message.payload.deliveryId },
            'webhook-delivery worker completed job',
          );
        },
      );
      running = true;
      options.logger?.info({ topic }, 'webhook-delivery worker started');
    },
    async stop() {
      if (!running) return;
      await options.queue.disconnect();
      running = false;
      options.logger?.info({}, 'webhook-delivery worker stopped');
    },
  };
}
