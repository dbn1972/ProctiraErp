/**
 * Review #5 on PR #555: with a backend that refuses delayed delivery (Kafka;
 * SQS FIFO / > 15 min), a failing webhook must be retried via the outbox
 * `availableAt`, POSTed once per attempt, and its attempt counted once.
 */
import type { PublishOptions, QueueAdapter, QueueMessage } from '@proctira/queue-abstraction';
import {
  InMemoryOutboxStore,
  OutboxRelay,
  QueueUnsupportedOperationError,
  requestedDelayMs,
} from '@proctira/queue-abstraction';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeveloperPortalService } from './developer-portal-service.js';
import { InMemoryDeveloperPortalRepository } from './in-memory-repository.js';
import {
  OutboxWebhookDeliveryPublisher,
  QueueWebhookDeliveryPublisher,
  type WebhookDeliveryJobPayload,
} from './queue-webhook-delivery-publisher.js';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

/** Kafka-like adapter: refuses any delay exactly like KafkaAdapter (PRC-M360). */
function noDelayAdapter() {
  const sent: QueueMessage[] = [];
  const dispatch = vi.fn(async (message: QueueMessage, options?: PublishOptions) => {
    if (requestedDelayMs(message, options) > 0) {
      throw new QueueUnsupportedOperationError('no delayed delivery');
    }
    sent.push(message);
  });
  const queue = {
    dispatch,
    publish: dispatch,
    isConnected: () => true,
    connect: async () => undefined,
  } as unknown as QueueAdapter;
  return { queue, sent, dispatch };
}

async function setup(publisherFor: (outbox: InMemoryOutboxStore, q: QueueAdapter) => unknown) {
  const outbox = new InMemoryOutboxStore();
  const broker = noDelayAdapter();
  const repository = new InMemoryDeveloperPortalRepository();
  const httpFetch = vi.fn(async () => ({ status: 503, ok: false }));
  const secrets = new Map<string, string>();
  const service = new DeveloperPortalService(repository, undefined, {
    deliveryPublisher: publisherFor(outbox, broker.queue) as OutboxWebhookDeliveryPublisher,
    httpFetch,
    // PRC-M211 (main #549): webhook create requires secret storage and every
    // send is signed, so the test supplies an in-memory writer/resolver pair.
    signingSecretWriter: {
      async storeSigningSecret(webhook: { id: string }, secret: string) {
        secrets.set(webhook.id, secret);
      },
    },
    signingSecretResolver: {
      async resolveSigningSecret(webhook: { id: string }) {
        return secrets.get(webhook.id);
      },
    },
  });
  const account = await service.createAccount({ name: 'OEM', email: 'oem@example.com' });
  await service.createWebhook(account.id, TENANT_ID, {
    url: 'https://example.com/hooks',
    events: ['student.enrolled'],
  });
  const [delivery] = await service.fanOutEvent(TENANT_ID, 'student.enrolled', { id: 's1' });
  const relay = new OutboxRelay({ store: outbox, queue: broker.queue });
  return { outbox, broker, repository, httpFetch, service, delivery: delivery!, relay };
}

describe('webhook retries without broker delay (review #5, PR #555)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    [
      'OutboxWebhookDeliveryPublisher',
      (o: InMemoryOutboxStore) => new OutboxWebhookDeliveryPublisher(o),
    ],
    [
      'QueueWebhookDeliveryPublisher({ delayedVia })',
      (o: InMemoryOutboxStore, q: QueueAdapter) =>
        new QueueWebhookDeliveryPublisher(q, { delayedVia: o }),
    ],
  ])(
    '%s: retry is deferred via availableAt, one POST and one attempt per failure',
    async (_n, make) => {
      vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z'), toFake: ['Date'] });
      const ctx = await setup(make);
      // Initial fan-out delivery reaches the broker with no delay.
      if (ctx.broker.sent.length === 0) expect(await ctx.relay.tick()).toBe(1);
      const job = ctx.broker.sent.at(-1)!.payload as WebhookDeliveryJobPayload;

      await ctx.service.processQueuedDelivery(TENANT_ID, job);
      expect(ctx.httpFetch).toHaveBeenCalledTimes(1);
      const afterFirst = await ctx.repository.getDeliveryById(ctx.delivery.id);
      expect(afterFirst!.attempts).toBe(1);
      expect(afterFirst!.status).toBe('pending');

      // Retry row sits in the outbox until its backoff (2^1 * 30s) is due.
      const [retryRow] = await ctx.outbox.listPending();
      expect(retryRow!.availableAt.toISOString()).toBe('2026-01-01T00:01:00.000Z');
      expect(retryRow!.metadata?.delay).toBeUndefined();
      const sentBefore = ctx.broker.sent.length;
      expect(await ctx.relay.tick()).toBe(0);
      expect(ctx.broker.sent.length).toBe(sentBefore);

      vi.setSystemTime(new Date('2026-01-01T00:01:00Z'));
      expect(await ctx.relay.tick()).toBe(1);
      const retried = ctx.broker.sent.at(-1)!;
      expect(requestedDelayMs(retried)).toBe(0);
      expect((retried.payload as WebhookDeliveryJobPayload).attempt).toBe(1);
      // No dispatch was ever refused for delay.
      for (const [m, o] of ctx.broker.dispatch.mock.calls) expect(requestedDelayMs(m, o)).toBe(0);
    },
  );

  it('a retry-scheduling failure neither double-counts the attempt nor re-POSTs', async () => {
    const ctx = await setup((_o, q) => new QueueWebhookDeliveryPublisher(q));
    const job: WebhookDeliveryJobPayload = {
      deliveryId: ctx.delivery.id,
      webhookId: ctx.delivery.webhookId,
      tenantId: TENANT_ID,
      url: 'https://example.com/hooks',
      event: 'student.enrolled',
      body: { id: 's1' },
      attempt: 0,
    };
    // Direct broker delay on a no-delay backend: the scheduling error surfaces...
    await expect(ctx.service.processQueuedDelivery(TENANT_ID, job)).rejects.toBeInstanceOf(
      QueueUnsupportedOperationError,
    );
    // ...but the endpoint was POSTed once and the attempt counted once.
    expect(ctx.httpFetch).toHaveBeenCalledTimes(1);
    expect((await ctx.repository.getDeliveryById(ctx.delivery.id))!.attempts).toBe(1);
  });
});
