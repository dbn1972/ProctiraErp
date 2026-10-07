/**
 * PRC-M360: live RabbitMQ delayed delivery (TTL bucket + dead-letter back).
 * Runs only when RABBITMQ_LIVE_URL is set, e.g. amqp://guest:guest@127.0.0.1:5672.
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import amqplib from 'amqplib';

import {
  RabbitMQAdapter,
  delayBucketQueueArguments,
  delayBucketQueueName,
  delayExchangeName,
} from '../adapters/rabbitmq-adapter';
import { buildTenantName } from '../types';
import type { QueueMessage } from '../types';

const url = process.env['RABBITMQ_LIVE_URL'];

describe.skipIf(!url)('RabbitMQAdapter live delayed delivery (PRC-M360)', () => {
  it('a 1500ms-delayed message is not delivered early, then arrives exactly once', async () => {
    const exchange = `m360.${Date.now()}`;
    const adapter = new RabbitMQAdapter({
      url: url!,
      exchange,
      deadLetterExchange: `${exchange}.dlx`,
    });
    await adapter.connect();
    const tenantId = randomUUID();
    const type = 'workflow.escalation';
    const received: Array<{ at: number; m: QueueMessage }> = [];
    await adapter.consume({ topic: buildTenantName(tenantId, type) }, async (m) => {
      received.push({ at: Date.now(), m });
    });
    const sentAt = Date.now();
    await adapter.dispatch(
      { id: randomUUID(), tenantId, type, payload: { x: 1 }, timestamp: new Date().toISOString() },
      { delay: 1500 },
    );
    await new Promise((r) => setTimeout(r, 1000));
    expect(received).toHaveLength(0);
    const deadline = Date.now() + 10_000;
    while (received.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    await new Promise((r) => setTimeout(r, 500));
    await adapter.disconnect();
    expect(received).toHaveLength(1);
    expect(received[0]!.at - sentAt).toBeGreaterThanOrEqual(1400);
  }, 30_000);

  it('bucket queues are declared without x-expires and dead-letter to the work exchange', async () => {
    const exchange = `m360b.${Date.now()}`;
    const adapter = new RabbitMQAdapter({ url: url!, exchange });
    await adapter.connect();
    const tenantId = randomUUID();
    const type = 'webhook.delivery';
    await adapter.consume({ topic: buildTenantName(tenantId, type) }, async () => undefined);
    await adapter.dispatch(
      { id: randomUUID(), tenantId, type, payload: {}, timestamp: new Date().toISOString() },
      { delay: 60_000 },
    );
    await adapter.disconnect();

    const bucket = delayBucketQueueName(exchange, 60_000);
    const conn = await amqplib.connect(url!);
    try {
      // Re-declaring with the exact expected args succeeds only if the broker
      // holds the same arguments (RabbitMQ rejects inequivalent args with 406).
      const ch = await conn.createChannel();
      const ok = await ch.assertQueue(bucket, {
        durable: true,
        arguments: delayBucketQueueArguments(exchange, 60_000),
      });
      expect(ok.messageCount).toBe(1);
      await ch.close();
      // Declaring it WITH x-expires must be refused: proves none is set.
      const ch2 = await conn.createChannel();
      ch2.on('error', () => undefined);
      await expect(
        ch2.assertQueue(bucket, {
          durable: true,
          arguments: { ...delayBucketQueueArguments(exchange, 60_000), 'x-expires': 660_000 },
        }),
      ).rejects.toThrow(/PRECONDITION_FAILED|inequivalent/);
      const cleanup = await conn.createChannel();
      await cleanup.deleteQueue(bucket);
      await cleanup.deleteExchange(delayExchangeName(exchange));
      await cleanup.deleteExchange(exchange);
      await cleanup.close();
    } finally {
      await conn.close().catch(() => undefined);
    }
  }, 30_000);
});
