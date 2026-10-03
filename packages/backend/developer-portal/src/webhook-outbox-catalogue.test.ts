/**
 * PRC-H046: webhook deliveries go through the transactional outbox, and subscriptions /
 * fan-out are limited to the webhook event catalogue.
 */
import {
  InMemoryDurableQueueAdapter,
  InMemoryDurableQueueStore,
  InMemoryOutboxStore,
  OutboxRelay,
  WEBHOOK_DELIVERY_JOB_TYPE,
} from '@proctira/queue-abstraction';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { developerPortalPlugin } from './developer-portal-plugin.js';
import { DeveloperPortalService } from './developer-portal-service.js';
import { InMemoryDeveloperPortalRepository } from './in-memory-repository.js';
import { OutboxWebhookDeliveryPublisher } from './queue-webhook-delivery-publisher.js';
import { webhookDeliveryUsesOutbox } from './webhook-delivery-publisher-factory.js';
import { sealWebhookSecret } from './webhook-secret-crypto.js';
import { WEBHOOK_SIGNATURE_HEADER } from './webhook-signature.js';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

async function waitFor(pred: () => boolean | Promise<boolean>, timeoutMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await pred()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return pred();
}

describe('PRC-H046 outbox-backed webhook delivery', () => {
  it('fan-out writes the delivery job to the outbox; the relay dispatches it and the worker POSTs a signed body', async () => {
    const store = new InMemoryDurableQueueStore();
    const queue = new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 });
    await queue.connect();
    const outbox = new InMemoryOutboxStore();
    const relay = new OutboxRelay({ store: outbox, queue, pollIntervalMs: 5 });
    const repository = new InMemoryDeveloperPortalRepository();
    await repository.createWebhook({
      id: 'wh-a',
      tenantId: TENANT_A,
      accountId: 'acct-a',
      url: 'https://a.example.test/hook',
      events: ['student.enrolled'],
      secretHash: 'hash',
      secretCiphertext: sealWebhookSecret('whsec_outbox_secret_0123456789abcdef', {
        webhookId: 'wh-a',
        tenantId: TENANT_A,
      }),
      description: null,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const posts: Array<{ url: string; headers: Record<string, string> }> = [];
    const app = Fastify();
    await app.register(developerPortalPlugin, {
      repository,
      deliveryPublisher: new OutboxWebhookDeliveryPublisher(outbox),
      deliveryWorkerQueue: new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 }),
      fanOutEvents: ['student.enrolled'],
      createFanOutQueue: () => new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 }),
      httpFetch: async (url, init) => {
        posts.push({ url, headers: init.headers });
        return { status: 200, ok: true };
      },
    });
    await app.ready();
    try {
      await queue.publish({
        id: 'evt-outbox-1',
        tenantId: TENANT_A,
        type: 'student.enrolled',
        payload: { studentId: 'stu-1' },
        timestamp: new Date().toISOString(),
      });
      // The fan-out wrote an outbox row, not a direct queue job.
      expect(await waitFor(async () => ((await outbox.listPending?.()) ?? []).length === 1)).toBe(
        true,
      );
      const [row] = (await outbox.listPending?.()) ?? [];
      expect(row?.eventType).toBe(WEBHOOK_DELIVERY_JOB_TYPE);
      expect(row?.aggregateType).toBe('webhook_delivery');
      expect(JSON.stringify(row?.payload)).not.toContain('whsec_');
      expect(posts).toHaveLength(0);
      await relay.tick();
      expect(await waitFor(() => posts.length === 1)).toBe(true);
      expect(posts[0]!.url).toBe('https://a.example.test/hook');
      expect(posts[0]!.headers[WEBHOOK_SIGNATURE_HEADER]).toBeTruthy();
    } finally {
      await app.close();
      await relay.stop();
      await queue.disconnect();
    }
  });

  it('defaults to the outbox path; WEBHOOK_DELIVERY_OUTBOX=false opts out', () => {
    expect(webhookDeliveryUsesOutbox({})).toBe(true);
    expect(webhookDeliveryUsesOutbox({ WEBHOOK_DELIVERY_OUTBOX: 'false' })).toBe(false);
  });
});

describe('PRC-H046 webhook event catalogue', () => {
  async function service() {
    const repository = new InMemoryDeveloperPortalRepository();
    const svc = new DeveloperPortalService(repository);
    const account = await repository.createAccount({
      id: 'acct-cat',
      tenantId: TENANT_A,
      userId: 'user-1',
      organizationName: 'Org',
      contactEmail: 'dev@example.test',
      status: 'active',
      tier: 'free',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    return { svc, accountId: (account as { id: string }).id };
  }

  it('rejects subscriptions to events outside the catalogue', async () => {
    const { svc, accountId } = await service();
    await expect(
      svc.createWebhook(accountId, TENANT_A, {
        url: 'https://a.example.test/hook',
        events: ['workflow.escalation'],
      } as never),
    ).rejects.toThrow(/Unknown webhook event/);
    const ok = await svc.createWebhook(accountId, TENANT_A, {
      url: 'https://a.example.test/hook',
      events: ['student.enrolled', '*'],
    } as never);
    expect(ok.events).toEqual(['student.enrolled', '*']);
    await expect(
      svc.updateWebhook(accountId, TENANT_A, ok.id, { events: ['secret.internal'] } as never),
    ).rejects.toThrow(/Unknown webhook event/);
  });

  it('never fans out a non-catalogue event, even to `*` subscribers', async () => {
    const { svc, accountId } = await service();
    await svc.createWebhook(accountId, TENANT_A, {
      url: 'https://a.example.test/hook',
      events: ['*'],
    } as never);
    expect(await svc.fanOutEvent(TENANT_A, 'workflow.escalation', {})).toEqual([]);
    expect(await svc.fanOutEvent(TENANT_A, 'student.enrolled', {})).toHaveLength(1);
  });
});
