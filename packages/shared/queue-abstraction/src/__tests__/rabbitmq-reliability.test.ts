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
  sentToQueue: Array<{ queue: string; body: QueueMessage; opts: any; cb: ConfirmCb }> = [];
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
  queueArgs = new Map<string, any>();
  headerBindings: Array<{ queue: string; exchange: string; args: any }> = [];
  async assertQueue(name: string, opts?: any) {
    this.assertedQueues.push(name);
    this.queueArgs.set(name, opts?.arguments);
    return { queue: name };
  }
  async bindQueue(queue: string, exchange: string, pattern: string, args?: any) {
    this.bindings.push({ queue, exchange, pattern });
    if (args) this.headerBindings.push({ queue, exchange, args });
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
  sendToQueue(queue: string, content: Buffer, opts: any, cb: ConfirmCb): boolean {
    this.sentToQueue.push({
      queue,
      body: JSON.parse(content.toString()) as QueueMessage,
      opts,
      cb,
    });
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
  /** Deliver an arbitrary body with explicit delivery fields (PRC-L355). */
  deliverRaw(
    queue: string,
    content: string,
    fields: { routingKey: string; exchange?: string },
    headers: Record<string, unknown> = {},
  ) {
    const onMessage = this.consumers.get(queue);
    if (!onMessage) throw new Error(`no consumer on ${queue}`);
    const msg = {
      content: Buffer.from(content),
      fields,
      properties: { messageId: 'raw-1', headers },
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
      on: vi.fn(),
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

describe('RabbitMQAdapter subscribe() fan-out group (PRC-L582)', () => {
  beforeEach(() => {
    channel = new FakeConfirmChannel();
  });

  it('refuses a subscribe with no groupId and no configured clientId', async () => {
    const adapter = new RabbitMQAdapter({ url: 'amqp://x', exchange: 'ex' });
    await adapter.connect();
    // Previously this silently used a shared 'shared.sub.*' queue so every
    // service competed on one queue instead of each receiving the event.
    await expect(
      adapter.subscribe({ topic: 'tenant.*.report.generate' }, async () => {}),
    ).rejects.toThrow(/distinct consumer group|PRC-L582/);
  });

  it('defaults the fan-out queue to the configured clientId (service name)', async () => {
    const adapter = new RabbitMQAdapter({ url: 'amqp://x', exchange: 'ex', clientId: 'svc-a' });
    await adapter.connect();
    await adapter.subscribe({ topic: 'tenant.*.report.generate' }, async () => {});
    expect(channel.assertedQueues).toContain('tenant.svc-a.sub.tenant.*.report.generate');
  });

  it('two different services get distinct fan-out queues', async () => {
    const a = new RabbitMQAdapter({ url: 'amqp://x', exchange: 'ex', clientId: 'svc-a' });
    const b = new RabbitMQAdapter({ url: 'amqp://x', exchange: 'ex', clientId: 'svc-b' });
    await a.connect();
    await a.subscribe({ topic: 'tenant.*.report.generate' }, async () => {});
    await b.connect();
    await b.subscribe({ topic: 'tenant.*.report.generate' }, async () => {});
    expect(channel.assertedQueues).toContain('tenant.svc-a.sub.tenant.*.report.generate');
    expect(channel.assertedQueues).toContain('tenant.svc-b.sub.tenant.*.report.generate');
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

describe('RabbitMQAdapter receive-side envelope + tenant guard (PRC-L355)', () => {
  beforeEach(() => {
    channel = new FakeConfirmChannel();
  });
  const queue = 'tenant.g.task.tenant.*.report.generate';
  async function consuming() {
    const handler = vi.fn(async () => undefined);
    const adapter = new RabbitMQAdapter({ url: 'amqp://x', exchange: 'ex' });
    await adapter.connect();
    await adapter.consume({ topic: 'tenant.*.report.generate', groupId: 'g' }, handler);
    return { adapter, handler };
  }

  it('dead-letters a body whose tenantId differs from the routed tenant', async () => {
    const { adapter, handler } = await consuming();
    const raw = channel.deliverRaw(queue, JSON.stringify(message({ tenantId: 'tenant-b' })), {
      routingKey: 'tenant.tenant-a.report.generate',
      exchange: 'ex',
    });
    await flush();
    expect(handler).not.toHaveBeenCalled();
    expect(channel.nacks).toContainEqual({ msg: raw, allUpTo: false, requeue: false });
    expect(adapter.failures.deadLettered).toBe(1);
  });

  it('dead-letters malformed JSON and envelopes failing the zod schema', async () => {
    const { handler } = await consuming();
    const fields = { routingKey: 'tenant.tenant-a.report.generate', exchange: 'ex' };
    const a = channel.deliverRaw(queue, '{not json', fields);
    const b = channel.deliverRaw(
      queue,
      JSON.stringify({ id: 'x', tenantId: 'tenant-a', payload: {} }),
      fields,
    );
    await flush();
    expect(handler).not.toHaveBeenCalled();
    expect(channel.nacks.map((n) => n.msg)).toEqual([a, b]);
  });

  it('retries carry the original route so the tenant check still passes', async () => {
    const handler = vi.fn(async () => {
      throw new Error('boom');
    });
    const adapter = new RabbitMQAdapter({ url: 'amqp://x', exchange: 'ex' });
    await adapter.connect();
    await adapter.consume({ topic: 'tenant.*.report.generate', groupId: 'g' }, handler);
    channel.deliver(queue, message({ metadata: { maxRetries: 2 } }));
    await flush();
    const retry = channel.sentToQueue[0]!;
    expect(retry.opts.headers['x-proctira-route']).toBe('tenant.tenant-a.report.generate');
    // Redelivered through the default exchange (routing key = queue name).
    channel.deliverRaw(
      queue,
      JSON.stringify(retry.body),
      { routingKey: queue, exchange: '' },
      retry.opts.headers,
    );
    await flush();
    expect(handler).toHaveBeenCalledTimes(2);
    // A forged default-exchange delivery without the route header is rejected.
    channel.deliverRaw(queue, JSON.stringify(retry.body), { routingKey: queue, exchange: '' });
    await flush();
    expect(handler).toHaveBeenCalledTimes(2);
  });
});

describe('RabbitMQAdapter delayed delivery via TTL bucket queues (PRC-H110 / PRO-S19-03)', () => {
  beforeEach(() => {
    channel = new FakeConfirmChannel();
  });

  it('routes a delayed dispatch to a TTL bucket that dead-letters back to the main exchange', async () => {
    const adapter = new RabbitMQAdapter({ url: 'amqp://x', exchange: 'ex' });
    await adapter.connect();
    channel.routable.add('tenant.tenant-a.workflow.escalation');
    await adapter.dispatch(message({ type: 'workflow.escalation' }), { delay: 60_000 });
    const pub = channel.published.at(-1)!;
    // Never a per-message expiration on the work exchange (that dead-letters to the DLQ).
    expect(pub.opts.expiration).toBeUndefined();
    expect(pub.exchange).toBe('ex.delay.v2');
    expect(pub.key).toBe('tenant.tenant-a.workflow.escalation');
    expect(pub.opts.headers['x-delay-bucket']).toBe('60000');
    expect(channel.assertExchange).toHaveBeenCalledWith('ex.delay.v2', 'headers', {
      durable: true,
    });
    // Dead-letters back to the WORK exchange with the original routing key.
    expect(channel.queueArgs.get('ex.delay.v2.60000ms')).toEqual({
      'x-message-ttl': 60_000,
      'x-dead-letter-exchange': 'ex',
    });
    expect(channel.headerBindings).toContainEqual({
      queue: 'ex.delay.v2.60000ms',
      exchange: 'ex.delay.v2',
      args: { 'x-match': 'all', 'x-delay-bucket': '60000' },
    });
  });

  it('review #2: bucket queues never carry x-expires (cannot be deleted while holding messages)', async () => {
    const adapter = new RabbitMQAdapter({ url: 'amqp://x', exchange: 'ex' });
    await adapter.connect();
    for (const delay of [1_000, 60_000, 480_000, 7 * 24 * 60 * 60 * 1000]) {
      await adapter.publish(message(), { delay });
    }
    const buckets = [...channel.queueArgs.entries()].filter(([q]) => q.startsWith('ex.delay.'));
    expect(buckets).toHaveLength(4);
    for (const [, args] of buckets) {
      expect(args).not.toHaveProperty('x-expires');
      expect(args).not.toHaveProperty('x-dead-letter-routing-key');
      expect(args['x-dead-letter-exchange']).toBe('ex');
    }
  });

  it('review #2: re-asserts the bucket on every delayed publish (no once-per-connection cache)', async () => {
    const adapter = new RabbitMQAdapter({ url: 'amqp://x', exchange: 'ex' });
    await adapter.connect();
    channel.routable.add('tenant.tenant-a.report.generate');
    await adapter.dispatch(message({ id: 'a' }), { delay: 60_000 });
    // Bucket deleted out-of-band (operator, policy): the next publish recreates it.
    channel.assertedQueues.length = 0;
    channel.headerBindings.length = 0;
    await adapter.dispatch(message({ id: 'b' }), { delay: 60_000 });
    expect(channel.assertedQueues).toEqual(['ex.delay.v2.60000ms']);
    expect(channel.headerBindings.map((b) => b.queue)).toEqual(['ex.delay.v2.60000ms']);
  });

  it('publishes undelayed messages straight to the main exchange', async () => {
    const adapter = new RabbitMQAdapter({ url: 'amqp://x', exchange: 'ex' });
    await adapter.connect();
    channel.routable.add('tenant.tenant-a.report.generate');
    await adapter.dispatch(message(), { delay: 0 });
    const pub = channel.published.at(-1)!;
    expect(pub.exchange).toBe('ex');
    expect(pub.opts.expiration).toBeUndefined();
    expect(channel.assertedQueues.some((q) => q.startsWith('ex.delay'))).toBe(false);
  });

  it('a message dead-lettered back from the bucket keeps its tenant route and reaches the handler', async () => {
    const handler = vi.fn(async () => undefined);
    const adapter = new RabbitMQAdapter({ url: 'amqp://x', exchange: 'ex' });
    await adapter.connect();
    await adapter.consume({ topic: 'tenant.*.workflow.escalation', groupId: 'g' }, handler);
    const body = message({ type: 'workflow.escalation' });
    channel.deliverRaw(
      'tenant.g.task.tenant.*.workflow.escalation',
      JSON.stringify(body),
      { routingKey: 'tenant.tenant-a.workflow.escalation', exchange: 'ex' },
      { 'x-death': [{ queue: 'ex.delay.v2.60000ms', reason: 'expired' }] },
    );
    await flush();
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
