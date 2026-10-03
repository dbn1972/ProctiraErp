/**
 * PRC-H046: domain-event → webhook fan-out subscriber.
 *
 * Subscribes (competing-consumer group `webhook-fanout`) to
 * `tenant.*.<event>` for each configured event type and calls
 * DeveloperPortalService.fanOutEvent(message.tenantId, message.type, payload),
 * which creates + enqueues one delivery per matching active webhook of that
 * tenant. The event catalogue is explicit (never `#`) so internal job
 * messages — including webhook delivery jobs themselves — are never fanned out.
 */
import type { QueueAdapter, QueueMessage } from '@proctira/queue-abstraction';

import type { WebhookDeliveryWorkerLogger } from './webhook-delivery-worker.js';
import { isCatalogueEvent, WEBHOOK_EVENT_CATALOGUE } from './webhook-event-catalogue.js';

export interface WebhookEventFanOutProcessor {
  fanOutEvent(tenantId: string, event: string, payload: Record<string, unknown>): Promise<unknown>;
}

export interface WebhookEventFanOutOptions {
  /** Event types to fan out (e.g. `student.enrolled`). Empty → subscriber is a no-op. */
  events: readonly string[];
  /** One adapter per event subscription (in-memory adapters hold one handler each). */
  createQueue: () => QueueAdapter;
  processor: WebhookEventFanOutProcessor;
  groupId?: string;
  logger?: WebhookDeliveryWorkerLogger;
}

export interface WebhookEventFanOutSubscriber {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly running: boolean;
  readonly events: readonly string[];
}

const EVENT_NAME = /^[a-z0-9][a-z0-9_-]*(\.[a-z0-9_-]+)+$/i;

/**
 * Parse `WEBHOOK_FANOUT_EVENTS` (comma separated, validated event names). PRC-H046: every name
 * must be in WEBHOOK_EVENT_CATALOGUE; `catalogue` expands to the whole catalogue. Unset → [].
 */
export function parseWebhookFanOutEvents(raw: string | undefined): string[] {
  if (!raw) return [];
  if (raw.trim().toLowerCase() === 'catalogue') return [...WEBHOOK_EVENT_CATALOGUE];
  const events = raw
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
  for (const event of events) {
    if (!EVENT_NAME.test(event) || event.startsWith('webhook.')) {
      throw new Error(`WEBHOOK_FANOUT_EVENTS: invalid or internal event name "${event}"`);
    }
    if (!isCatalogueEvent(event)) {
      throw new Error(`WEBHOOK_FANOUT_EVENTS: "${event}" is not in the webhook event catalogue`);
    }
  }
  return [...new Set(events)];
}

function asRecord(payload: unknown): Record<string, unknown> {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : { value: payload };
}

export function createWebhookEventFanOutSubscriber(
  options: WebhookEventFanOutOptions,
): WebhookEventFanOutSubscriber {
  const events = [...options.events];
  const queues: QueueAdapter[] = [];
  let running = false;
  return {
    get running() {
      return running;
    },
    events,
    async start() {
      if (running || events.length === 0) return;
      for (const event of events) {
        const queue = options.createQueue();
        if (!queue.isConnected()) await queue.connect();
        queues.push(queue);
        await queue.subscribe(
          {
            topic: `tenant.*.${event}`,
            groupId: options.groupId ?? 'webhook-fanout',
            autoAck: false,
          },
          async (message: QueueMessage) => {
            if (message.type !== event) return;
            const deliveries = await options.processor.fanOutEvent(
              message.tenantId,
              message.type,
              asRecord(message.payload),
            );
            options.logger?.info(
              {
                tenantId: message.tenantId,
                event,
                messageId: message.id,
                deliveries: Array.isArray(deliveries) ? deliveries.length : undefined,
              },
              'webhook fan-out processed event',
            );
          },
        );
      }
      running = true;
      options.logger?.info({ events }, 'webhook fan-out subscriber started');
    },
    async stop() {
      const toClose = queues.splice(0);
      for (const queue of toClose) await queue.disconnect();
      if (running) options.logger?.info({}, 'webhook fan-out subscriber stopped');
      running = false;
    },
  };
}
