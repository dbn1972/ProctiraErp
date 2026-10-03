/**
 * PRC-H046: domain event → webhook fan-out → durable delivery worker → HTTP POST.
 * - Tenant A event reaches tenant A's registered URL; delivery row → delivered.
 * - Tenant B's webhook (same event) never receives tenant A's event.
 */
import {
  InMemoryDurableQueueAdapter,
  InMemoryDurableQueueStore,
} from '@proctira/queue-abstraction';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { developerPortalPlugin } from './developer-portal-plugin.js';
import type { WebhookEntity } from './developer-portal-repository.js';
import { InMemoryDeveloperPortalRepository } from './in-memory-repository.js';
import { QueueWebhookDeliveryPublisher } from './queue-webhook-delivery-publisher.js';
import type { WebhookDeliveryJobPayload } from './queue-webhook-delivery-publisher.js';
import { WEBHOOK_EVENT_CATALOGUE } from './webhook-event-catalogue.js';
import { parseWebhookFanOutEvents } from './webhook-event-fanout.js';
import { sealWebhookSecret } from './webhook-secret-crypto.js';
import {
  MemoryWebhookReplayStore,
  WEBHOOK_NONCE_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  verifyWebhookSignatureSecure,
} from './webhook-signature.js';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const SECRET_A = 'whsec_tenant_a_signing_secret_0123456789';

function webhook(
  id: string,
  tenantId: string,
  url: string,
  secret: string | null = `${SECRET_A}-${id}`,
): WebhookEntity {
  return {
    id,
    tenantId,
    accountId: `acct-${tenantId}`,
    url,
    events: ['student.enrolled'],
    secretHash: 'hash',
    // PRC-M211: sealed signing secret; null = legacy hash-only row.
    secretCiphertext: secret ? sealWebhookSecret(secret, { webhookId: id, tenantId }) : null,
    description: null,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function buildApp(secretA: string | null = SECRET_A) {
  const store = new InMemoryDurableQueueStore();
  const publisherQueue = new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 });
  await publisherQueue.connect();
  const repository = new InMemoryDeveloperPortalRepository();
  await repository.createWebhook(webhook('wh-a', TENANT_A, 'https://a.example.test/hook', secretA));
  await repository.createWebhook(webhook('wh-b', TENANT_B, 'https://b.example.test/hook'));
  const jobs: WebhookDeliveryJobPayload[] = [];
  const realPublisher = new QueueWebhookDeliveryPublisher(publisherQueue);
  const posts: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
  const app = Fastify();
  await app.register(developerPortalPlugin, {
    repository,
    deliveryPublisher: {
      enqueueDelivery: async (job, delayMs) => {
        jobs.push(job);
        await realPublisher.enqueueDelivery(job, delayMs);
      },
    },
    deliveryWorkerQueue: new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 }),
    fanOutEvents: ['student.enrolled'],
    createFanOutQueue: () => new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 }),
    httpFetch: async (url, init) => {
      posts.push({ url, body: init.body, headers: init.headers });
      return { status: 200, ok: true };
    },
  });
  app.addHook('onClose', async () => {
    await publisherQueue.disconnect();
  });
  await app.ready();
  return { app, publisherQueue, repository, posts, store, jobs };
}

async function waitFor(pred: () => boolean | Promise<boolean>, timeoutMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await pred()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return pred();
}

describe('PRC-H046 webhook fan-out + delivery worker wiring', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('tenant A domain event is POSTed to tenant A webhook only and marked delivered', async () => {
    const built = await buildApp();
    app = built.app;
    expect(app.webhookDeliveryWorker?.running).toBe(true);
    expect(app.webhookFanOut?.running).toBe(true);

    await built.publisherQueue.publish({
      id: 'evt-1',
      tenantId: TENANT_A,
      type: 'student.enrolled',
      payload: { studentId: 'stu-1' },
      timestamp: new Date().toISOString(),
    });

    expect(await waitFor(() => built.posts.length >= 1)).toBe(true);
    expect(
      await waitFor(async () => {
        const { data } = await built.repository.listDeliveries({ webhookId: 'wh-a' }, 1, 10);
        return data[0]?.status === 'delivered';
      }),
    ).toBe(true);

    await new Promise((r) => setTimeout(r, 50));
    expect(built.posts).toHaveLength(1);
    expect(built.posts[0]!.url).toBe('https://a.example.test/hook');
    expect(JSON.parse(built.posts[0]!.body)).toMatchObject({
      event: 'student.enrolled',
      payload: { studentId: 'stu-1' },
    });
    // Cross-tenant: tenant B's webhook got no delivery row and no POST.
    const b = await built.repository.listDeliveries({ webhookId: 'wh-b' }, 1, 10);
    expect(b.total).toBe(0);
    // PRC-M211: the receiver verifies the HMAC with its secret; the queue never saw it.
    const post = built.posts[0]!;
    const verified = await verifyWebhookSignatureSecure({
      payload: post.body,
      secret: SECRET_A,
      signature: post.headers[WEBHOOK_SIGNATURE_HEADER]!,
      timestamp: post.headers[WEBHOOK_TIMESTAMP_HEADER]!,
      nonce: post.headers[WEBHOOK_NONCE_HEADER]!,
      nodeEnv: 'test',
      replayStore: new MemoryWebhookReplayStore(),
    });
    expect(verified).toEqual({ ok: true });
    expect(built.jobs.length).toBeGreaterThan(0);
    expect(JSON.stringify(built.jobs)).not.toContain(SECRET_A);
    expect(built.jobs.every((j) => !('signingSecret' in j))).toBe(true);
  });

  it('never sends unsigned: a hash-only legacy webhook delivery fails closed (PRC-M211)', async () => {
    const built = await buildApp(null);
    app = built.app;
    await built.publisherQueue.publish({
      id: 'evt-2',
      tenantId: TENANT_A,
      type: 'student.enrolled',
      payload: { studentId: 'stu-2' },
      timestamp: new Date().toISOString(),
    });
    expect(
      await waitFor(async () => {
        const { data } = await built.repository.listDeliveries({ webhookId: 'wh-a' }, 1, 10);
        return data[0]?.status === 'failed';
      }),
    ).toBe(true);
    expect(built.posts).toHaveLength(0);
  });

  it('stops worker and fan-out subscriber on close', async () => {
    const built = await buildApp();
    const worker = built.app.webhookDeliveryWorker!;
    const fanOut = built.app.webhookFanOut!;
    await built.app.close();
    expect(worker.running).toBe(false);
    expect(fanOut.running).toBe(false);
  });
});

describe('parseWebhookFanOutEvents', () => {
  it('parses a comma list and rejects wildcard / internal job events', () => {
    expect(parseWebhookFanOutEvents(undefined)).toEqual([]);
    expect(
      parseWebhookFanOutEvents(' student.enrolled, fees.payment.succeeded ,student.enrolled'),
    ).toEqual(['student.enrolled', 'fees.payment.succeeded']);
    // PRC-H046: names outside the webhook event catalogue are refused; `catalogue` expands.
    expect(() => parseWebhookFanOutEvents('fee.paid')).toThrow(/catalogue/);
    expect(parseWebhookFanOutEvents('catalogue')).toEqual([...WEBHOOK_EVENT_CATALOGUE]);
    expect(() => parseWebhookFanOutEvents('#')).toThrow();
    expect(() => parseWebhookFanOutEvents('webhook.delivery')).toThrow();
  });
});
