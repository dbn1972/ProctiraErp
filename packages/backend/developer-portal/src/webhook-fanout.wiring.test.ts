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
import { parseWebhookFanOutEvents } from './webhook-event-fanout.js';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function webhook(id: string, tenantId: string, url: string): WebhookEntity {
  return {
    id,
    tenantId,
    accountId: `acct-${tenantId}`,
    url,
    events: ['student.enrolled'],
    secretHash: 'hash',
    description: null,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function buildApp() {
  const store = new InMemoryDurableQueueStore();
  const publisherQueue = new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 });
  await publisherQueue.connect();
  const repository = new InMemoryDeveloperPortalRepository();
  await repository.createWebhook(webhook('wh-a', TENANT_A, 'https://a.example.test/hook'));
  await repository.createWebhook(webhook('wh-b', TENANT_B, 'https://b.example.test/hook'));
  const posts: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
  const app = Fastify();
  await app.register(developerPortalPlugin, {
    repository,
    deliveryPublisher: new QueueWebhookDeliveryPublisher(publisherQueue),
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
  return { app, publisherQueue, repository, posts, store };
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
    expect(parseWebhookFanOutEvents(' student.enrolled, fee.paid ,student.enrolled')).toEqual([
      'student.enrolled',
      'fee.paid',
    ]);
    expect(() => parseWebhookFanOutEvents('#')).toThrow();
    expect(() => parseWebhookFanOutEvents('webhook.delivery')).toThrow();
  });
});
