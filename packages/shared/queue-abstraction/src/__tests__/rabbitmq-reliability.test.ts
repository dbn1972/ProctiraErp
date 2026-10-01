/**
 * PRC-H086 / PRC-H087: RabbitMQ adapter reliability against a fake amqplib
 * confirm channel (no broker required).
 *
 * - H086: DLQ asserted + bound to the DLX; failing handler retried with
 *   retryCount+1 until maxRetries, then nacked (dead-lettered).
 * - H087: publishes use a confirm channel; unroutable mandatory dispatch and
 *   channel loss reject so the outbox relay never marks the row published.
 */
import { EventEmitter } from 'node:events';

import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { QueueMessage } from '../types';

type ConfirmCb = (err: unknown) => void;

class FakeConfirmChannel extends EventEmitter {
  assertedQueues: string[] = [];
  bindings: Array<{ queue: string; exchange: string; pattern: string }> = [];
  published: Array<{
    exchange: string;
    key: string;
    body: QueueMessage;
    opts: any;
    cb: ConfirmCb;
  }> = [];
  sentToQueue: Array<{ queue: string; body: QueueMessage; cb: ConfirmCb }> = [];
  acks: unknown[] = [];
  nacks: Array<{ msg: unknown; allUpTo: boolean; requeue: boolean }> = [];
  consumers = new Map<string, (msg: unknown) => void>();
  /** When set, confirm callbacks are held until `flushConfirms()`. */
  holdConfirms = false;
  private held: ConfirmCb[] = [];
  /** Routing keys with a bound queue (mandatory publishes to others are returned). */
  routable = new Set<string>();

  prefetch = vi.fn(async () => undefined);
  assertExchange = vi.fn(async () => undefined);
  checkExchange = vi.fn(async () => undefined);
  close = vi.fn(async () => undefined);
  async assertQueue(name: string) {
    this.assertedQueues.push(name);
    return { queue: name };
  }
  async bindQueue(queue: string, exchange: string, pattern: string) {
    this.bindings.push({ queue, exchange, pattern });
  }
  async consume(queue: string, onMessage: (msg: unknown) => void) {
    this.consumers.set(queue, onMessage);
    return { consumerTag: queue };
  }
  ack(msg: unknown) {
    this.acks.push(msg);
  }
  nack(msg: unknown, allUpTo = false, requeue = true) {
    this.nacks.push({ msg, allUpTo, requeue });
  }
  publish(exchange: string, key: string, content: Buffer, opts: any, cb: ConfirmCb): boolean {
    const body = JSON.parse(content.toString()) as QueueMessage;
    this.published.push({ exchange, key, body, opts, cb });
    if (opts?.mandatory && !this.routable.has(key)) {
      this.emit('return', {
        fields: { routingKey: key },
        properties: { messageId: opts.messageId },
      });
    }
    this.confirm(cb);
    return true;
  }
  sendToQueue(queue: string, content: Buffer, _opts: any, cb: ConfirmCb): boolean {
    this.sentToQueue.push({ queue, body: JSON.parse(content.toString()) as QueueMessage, cb });
    this.confirm(cb);
    return true;
  }
  private confirm(cb: ConfirmCb) {
    if (this.holdConfirms) this.held.push(cb);
    else queueMicrotask(() => cb(null));
  }
  flushConfirms() {
    const held = this.held;
    this.held = [];
    for (const cb of held) cb(null);
  }
  deliver(queue: string, body: QueueMessage) {
    const onMessage = this.consumers.get(queue);
    if (!onMessage) throw new Error(`no consumer on ${queue}`);
    const msg = {
      content: Buffer.from(JSON.stringify(body)),
      fields: { routingKey: `tenant.${body.tenantId}.${body.type}` },
      properties: { messageId: body.id, headers: {} },
    };
    onMessage(msg);
    return msg;
  }
}

let channel: FakeConfirmChannel;

vi.mock('amqplib', () => ({
  default: {
    connect: vi.fn(async () => ({
      createConfirmChannel: vi.fn(async () => channel),
      // Legacy non-confirm channel: publish() returns without ever confirming.
      createChannel: vi.fn(async () => channel),
      close: vi.fn(async () => undefined),
    })),
  },
}));

const { RabbitMQAdapter } = await import('../adapters/rabbitmq-adapter');

function message(overrides: Partial<QueueMessage> = {}): QueueMessage {
  return {
    id: 'job-1',
    tenantId: 'tenant-a',
    type: 'report.generate',
    payload: { jobId: 'job-1' },
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r));
}

describe('RabbitMQAdapter dead-letter + retry (PRC-H086)', () => {
  beforeEach(() => {
    channel = new FakeConfirmChannel();
  });

  it('asserts a DLQ bound with # to the dead-letter exchange on connect', async () => {
    const adapter = new RabbitMQAdapter({ url: 'amqp://x', exchange: 'ex' });
    await adapter.connect();
    expect(channel.assertedQueues).toContain('dlx.dlq');
    expect(channel.bindings).toContainEqual({ queue: 'dlx.dlq', exchange: 'dlx', pattern: '#' });
  });

  it('retries a failing handler with retryCount+1 until maxRetries, then dead-letters', async () => {
    const logger = { warn: vi.fn(), error: vi.fn() };
    const adapter = new RabbitMQAdapter({ url: 'amqp://x', exchange: 'ex' }, { logger });
    await adapter.connect();
    await adapter.consume({ topic: 'tenant.*.report.generate', groupId: 'g' }, async () => {
      throw new Error('boom');
    });
    const queue = 'tenant.g.task.tenant.*.report.generate';

    const first = channel.deliver(queue, message({ metadata: { maxRetries: 1 } }));
    await flush();
    expect(channel.sentToQueue).toHaveLength(1);
    expect(channel.sentToQueue[0]!.queue).toBe(queue);
    expect(channel.sentToQueue[0]!.body.metadata?.retryCount).toBe(1);
    expect(channel.sentToQueue[0]!.body.payload).toEqual({ jobId: 'job-1' });
    expect(channel.acks).toContain(first);

    const second = channel.deliver(queue, channel.sentToQueue[0]!.body);
    await flush();
    expect(channel.sentToQueue).toHaveLength(1);
    expect(channel.nacks).toContainEqual({ msg: second, allUpTo: false, requeue: false });
    expect(adapter.failures.retried).toBe(1);
    expect(adapter.failures.deadLettered).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'job-1',
        tenantId: 'tenant-a',
        type: 'report.generate',
      }),
      'queue delivery dead-lettered',
    );
  });
});

describe('RabbitMQAdapter publisher confirms (PRC-H087)', () => {
  beforeEach(() => {
    channel = new FakeConfirmChannel();
  });

  it('dispatch() is mandatory and rejects when no queue is bound to the routing key', async () => {
    const adapter = new RabbitMQAdapter({ url: 'amqp://x', exchange: 'ex' });
    await adapter.connect();
    await expect(adapter.dispatch(message())).rejects.toThrow(/unroutable/);
    expect(channel.published[0]!.opts.mandatory).toBe(true);
  });

  it('dispatch() resolves after broker confirm when the routing key is bound', async () => {
    const adapter = new RabbitMQAdapter({ url: 'amqp://x', exchange: 'ex' });
    await adapter.connect();
    channel.routable.add('tenant.tenant-a.report.generate');
    channel.holdConfirms = true;
    let settled = false;
    const p = adapter.dispatch(message()).then(() => {
      settled = true;
    });
    await flush();
    expect(settled).toBe(false);
    channel.flushConfirms();
    await p;
    expect(settled).toBe(true);
  });

  it('rejects in-flight publishes when the channel closes before confirm', async () => {
    const adapter = new RabbitMQAdapter({ url: 'amqp://x', exchange: 'ex' });
    await adapter.connect();
    channel.routable.add('tenant.tenant-a.report.generate');
    channel.holdConfirms = true;
    const p = adapter.dispatch(message());
    channel.emit('close');
    await expect(p).rejects.toThrow(/not confirmed/);
  });

  it('outbox relay does not mark a row published when dispatch is unroutable', async () => {
    const { InMemoryOutboxStore, OutboxRelay } = await import('../outbox/index');
    const adapter = new RabbitMQAdapter({ url: 'amqp://x', exchange: 'ex' });
    await adapter.connect();
    const store = new InMemoryOutboxStore();
    await store.enqueue({
      id: 'row-1',
      tenantId: 'tenant-a',
      aggregateType: 'report_card_job',
      aggregateId: 'job-1',
      eventType: 'report.generate',
      payload: {},
      dispatchMode: 'dispatch',
    });
    const relay = new OutboxRelay({ store, queue: adapter, retryBackoffMs: 0 });
    expect(await relay.tick()).toBe(0);
    const pending = await store.listPending();
    const failed = await store.listFailed();
    expect([...pending, ...failed].map((r) => r.id)).toContain('row-1');
    expect([...pending, ...failed].every((r) => r.status !== 'published')).toBe(true);
  });
});
