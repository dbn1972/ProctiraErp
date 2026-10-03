/**
 * PRC-H087: publisher confirms / mandatory dispatch against a real RabbitMQ broker.
 *
 * Runs only when RABBITMQ_URL is set (CI integration-test job provides a RabbitMQ service);
 * the fake-channel suite (rabbitmq-reliability.test.ts) covers the same contract offline.
 */
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { RabbitMQAdapter } from '../adapters/rabbitmq-adapter';
import { InMemoryOutboxStore, OutboxRelay } from '../outbox/index';
import type { QueueMessage } from '../types';

const RABBITMQ_URL = process.env['RABBITMQ_URL'];

function message(tenantId: string): QueueMessage {
  return {
    id: randomUUID(),
    type: 'report.generate',
    tenantId,
    payload: { n: 1 },
    timestamp: new Date().toISOString(),
    metadata: {},
  } as QueueMessage;
}

describe.skipIf(!RABBITMQ_URL)('PRC-H087 RabbitMQ publisher confirms (live broker)', () => {
  const adapters: RabbitMQAdapter[] = [];
  function adapter(): RabbitMQAdapter {
    const exchange = `proctira.test.h087.${randomUUID().slice(0, 8)}`;
    const a = new RabbitMQAdapter(
      { url: RABBITMQ_URL!, exchange, deadLetterExchange: `${exchange}.dlx`, durable: false },
      { depthSampleIntervalMs: 0 },
    );
    adapters.push(a);
    return a;
  }
  afterEach(async () => {
    for (const a of adapters.splice(0)) await a.disconnect();
  });

  it('dispatch to a routing key with no bound queue rejects', async () => {
    const a = adapter();
    await a.connect();
    await expect(a.dispatch(message('tenant-h087'))).rejects.toThrow(/unroutable/);
  });

  it('dispatch resolves once a work queue is bound (broker ack)', async () => {
    const a = adapter();
    await a.connect();
    await a.consume({ topic: 'tenant.*.report.generate', groupId: `h087-${randomUUID().slice(0, 8)}` }, async () => undefined);
    await expect(a.dispatch(message('tenant-h087'))).resolves.toBeUndefined();
  });

  it('killing the broker connection mid-publish rejects (no false confirm)', async () => {
    const a = adapter();
    await a.connect();
    await a.consume({ topic: 'tenant.*.report.generate', groupId: `h087k-${randomUUID().slice(0, 8)}` }, async () => undefined);
    const inFlight = a.dispatch(message('tenant-h087'));
    // Drop the TCP socket before the broker's basic.ack can arrive.
    const conn = (
      a as unknown as { connection: { connection: { stream: { destroy(err?: Error): void } } } }
    ).connection;
    conn.connection.stream.destroy(new Error('simulated broker connection reset'));
    await expect(inFlight).rejects.toThrow(/not confirmed|closed|Connection|socket/i);
  });

  it('outbox relay keeps an unroutable row unpublished', async () => {
    const a = adapter();
    await a.connect();
    const store = new InMemoryOutboxStore();
    await store.enqueue({
      id: randomUUID(),
      tenantId: 'tenant-h087',
      aggregateType: 'report_card_job',
      aggregateId: 'job-1',
      eventType: 'report.generate',
      payload: {},
      dispatchMode: 'dispatch',
    });
    const relay = new OutboxRelay({ store, queue: a, retryBackoffMs: 0 });
    expect(await relay.tick()).toBe(0);
    const rows = [...(await store.listPending()), ...(await store.listFailed())];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).not.toBe('published');
  });
});
