/**
 * PRC-H046: broker-backed webhook delivery (real RabbitMQ; runs when RABBITMQ_TEST_URL is set).
 * Domain event on the broker → fan-out subscriber → outbox row → OutboxRelay → broker work
 * queue → delivery worker → signed POST to tenant A only.
 */
import { randomUUID } from 'node:crypto';

import { InMemoryOutboxStore, OutboxRelay, RabbitMQAdapter } from '@proctira/queue-abstraction';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { developerPortalPlugin } from './developer-portal-plugin.js';
import { InMemoryDeveloperPortalRepository } from './in-memory-repository.js';
import { OutboxWebhookDeliveryPublisher } from './queue-webhook-delivery-publisher.js';
import { sealWebhookSecret } from './webhook-secret-crypto.js';
import { WEBHOOK_SIGNATURE_HEADER } from './webhook-signature.js';

const url = process.env['RABBITMQ_TEST_URL'];
const maybe = url ? describe : describe.skip;
const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

maybe('PRC-H046 webhook delivery over a real RabbitMQ broker', () => {
  it('delivers a tenant A event to tenant A webhook only, signed', async () => {
    const suffix = randomUUID().slice(0, 8);
    const make = () =>
      new RabbitMQAdapter({
        url: url!,
        exchange: `proctira.it.webhooks.${suffix}`,
        exchangeType: 'topic',
        deadLetterExchange: `proctira.it.webhooks.dlx.${suffix}`,
        durable: false,
      });
    const producer = make();
    await producer.connect();
    const outbox = new InMemoryOutboxStore();
    const relay = new OutboxRelay({ store: outbox, queue: producer, pollIntervalMs: 20 });
    const repository = new InMemoryDeveloperPortalRepository();
    for (const [id, tenantId] of [
      ['wh-a', TENANT_A],
      ['wh-b', TENANT_B],
    ] as const) {
      await repository.createWebhook({
        id,
        tenantId,
        accountId: `acct-${id}`,
        url: `https://${id}.example.test/hook`,
        events: ['student.enrolled'],
        secretHash: 'hash',
        secretCiphertext: sealWebhookSecret(`whsec_${id}_0123456789abcdef0123`, {
          webhookId: id,
          tenantId,
        }),
        description: null,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    const posts: Array<{ url: string; headers: Record<string, string> }> = [];
    const app = Fastify();
    await app.register(developerPortalPlugin, {
      repository,
      deliveryPublisher: new OutboxWebhookDeliveryPublisher(outbox),
      deliveryWorkerQueue: make(),
      fanOutEvents: ['student.enrolled'],
      createFanOutQueue: make,
      httpFetch: async (target, init) => {
        posts.push({ url: target, headers: init.headers });
        return { status: 200, ok: true };
      },
    });
    await app.ready();
    relay.start();
    try {
      await producer.publish({
        id: randomUUID(),
        tenantId: TENANT_A,
        type: 'student.enrolled',
        payload: { studentId: 'stu-broker' },
        timestamp: new Date().toISOString(),
      });
      const started = Date.now();
      while (posts.length === 0 && Date.now() - started < 10_000) {
        await new Promise((r) => setTimeout(r, 50));
      }
      await new Promise((r) => setTimeout(r, 300));
      expect(posts).toHaveLength(1);
      expect(posts[0]!.url).toBe('https://wh-a.example.test/hook');
      expect(posts[0]!.headers[WEBHOOK_SIGNATURE_HEADER]).toBeTruthy();
    } finally {
      await app.close();
      await relay.stop();
      await producer.disconnect();
    }
  });
});
