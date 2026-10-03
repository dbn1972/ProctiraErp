/**
 * PRC-H086 / PRC-H087 / PRC-H046: broker-level RabbitMQ proof (real broker, no fakes).
 *
 * Runs only when RABBITMQ_TEST_URL is set (CI `queue-broker` job starts a rabbitmq service).
 * - A failing consumer is retried with retryCount+1 and, once maxRetries is exhausted, the
 *   original message lands in the bound `<dlx>.dlq` (never silently dropped).
 * - Mandatory dispatch with no bound work queue rejects (outbox row would stay pending).
 * - Consumer failures reach the process-wide metric listener.
 */
import { randomUUID } from 'node:crypto';

import amqplib from 'amqplib';
import { afterEach, describe, expect, it } from 'vitest';

import { addQueueDeliveryFailureListener } from '../adapters/delivery-failure';
import { deadLetterQueueName, RabbitMQAdapter } from '../adapters/rabbitmq-adapter';
import type { DeliveryFailureEvent } from '../adapters/delivery-failure';

const url = process.env['RABBITMQ_TEST_URL'];
const maybe = url ? describe : describe.skip;

async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs = 10_000): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await fn();
    if (value !== undefined) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timed out waiting for broker condition');
}

maybe('RabbitMQ broker integration (RABBITMQ_TEST_URL)', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const fn of cleanups.splice(0).reverse()) await fn().catch(() => undefined);
  });

  function adapter(suffix: string) {
    const exchange = `proctira.it.${suffix}`;
    const deadLetterExchange = `proctira.it.dlx.${suffix}`;
    const a = new RabbitMQAdapter(
      { url: url!, exchange, exchangeType: 'topic', deadLetterExchange, durable: false },
      { defaultMaxRetries: 2 },
    );
    return { a, exchange, deadLetterExchange };
  }

  async function purge(names: { exchange: string; deadLetterExchange: string }, queues: string[]) {
    const conn = await amqplib.connect(url!);
    const ch = await conn.createChannel();
    for (const q of queues) await ch.deleteQueue(q).catch(() => undefined);
    await ch.deleteExchange(names.exchange).catch(() => undefined);
    await ch.deleteExchange(names.deadLetterExchange).catch(() => undefined);
    await conn.close();
  }

  it('retries a failing consumer then dead-letters the original message into the DLQ', async () => {
    const suffix = randomUUID().slice(0, 8);
    const { a, exchange, deadLetterExchange } = adapter(suffix);
    await a.connect();
    const dlq = deadLetterQueueName(deadLetterExchange);
    cleanups.push(async () => {
      await a.disconnect();
      await purge({ exchange, deadLetterExchange }, [dlq, `workers.task.tenant.*.it.fail`]);
    });
    const failures: DeliveryFailureEvent[] = [];
    cleanups.push(async () => unsubscribe());
    const unsubscribe = addQueueDeliveryFailureListener((e) => {
      if (e.type === 'it.fail') failures.push(e);
    });
    let calls = 0;
    await a.consume({ topic: 'tenant.*.it.fail', groupId: `it-${suffix}` }, async () => {
      calls += 1;
      throw new Error('handler boom');
    });
    const id = randomUUID();
    await a.dispatch({
      id,
      tenantId: 'tenant-it',
      type: 'it.fail',
      payload: { n: 1 },
      timestamp: new Date().toISOString(),
      metadata: { maxRetries: 2 },
    });

    const conn = await amqplib.connect(url!);
    cleanups.push(async () => conn.close());
    const ch = await conn.createChannel();
    const dead = await waitFor(async () => {
      const msg = await ch.get(dlq, { noAck: true });
      return msg
        ? (JSON.parse(msg.content.toString()) as { id: string; payload: unknown })
        : undefined;
    });
    expect(dead.id).toBe(id);
    expect(dead.payload).toEqual({ n: 1 });
    expect(calls).toBe(3); // first attempt + 2 retries
    expect(failures.map((f) => f.disposition)).toEqual(['retry', 'retry', 'dead-letter']);
    expect(a.failures.deadLettered).toBe(1);
  });

  it('rejects a mandatory dispatch that no work queue is bound to', async () => {
    const suffix = randomUUID().slice(0, 8);
    const { a, exchange, deadLetterExchange } = adapter(suffix);
    await a.connect();
    cleanups.push(async () => {
      await a.disconnect();
      await purge({ exchange, deadLetterExchange }, [deadLetterQueueName(deadLetterExchange)]);
    });
    await expect(
      a.dispatch({
        id: randomUUID(),
        tenantId: 'tenant-it',
        type: 'it.unrouted',
        payload: {},
        timestamp: new Date().toISOString(),
      }),
    ).rejects.toThrow();
  });
});
