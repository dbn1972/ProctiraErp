/**
 * PRC-M360: delayed delivery is honoured or refused - never silently degraded.
 * - outbox path: escalation with delayMs=2h is not claimable before 2h
 * - adapters: in-memory honours; Kafka throws; SQS throws for >15min / FIFO
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { InMemoryDurableQueueAdapter, InMemoryDurableQueueStore } from '../index';
import { QueueUnsupportedOperationError, requestedDelayMs } from '../types';
import type { QueueMessage } from '../types';
import { buildWorkflowEscalationOutboxEntry } from '../outbox/builders';
import { InMemoryOutboxStore } from '../outbox/in-memory-outbox-store';
import { OutboxRelay } from '../outbox/relay';
import { SQSAdapter } from '../adapters/sqs-adapter';
import { MAX_DELAY_MS, RabbitMQAdapter } from '../adapters/rabbitmq-adapter';

vi.mock('kafkajs', () => {
  class Kafka {
    producer() {
      return { connect: vi.fn(), disconnect: vi.fn(), send: vi.fn() };
    }
    consumer() {
      return { connect: vi.fn(), disconnect: vi.fn(), subscribe: vi.fn(), run: vi.fn() };
    }
    admin() {
      return { connect: vi.fn(), disconnect: vi.fn() };
    }
  }
  return { Kafka, logLevel: { NOTHING: 0 } };
});

const T1 = '11111111-1111-4111-8111-111111111111';
const HOUR = 60 * 60 * 1000;

function msg(delay?: number): QueueMessage {
  return {
    id: 'm-1',
    tenantId: T1,
    type: 'workflow.escalation',
    payload: {},
    timestamp: new Date().toISOString(),
    ...(delay !== undefined ? { metadata: { delay } } : {}),
  };
}

describe('outbox-scheduled delay (PRC-M360)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('escalation with delayMs=2h is not delivered before 2h, then delivered without transport delay', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const store = new InMemoryDurableQueueStore();
    const queue = new InMemoryDurableQueueAdapter({ store });
    await queue.connect();
    const dispatchSpy = vi.spyOn(queue, 'dispatch');
    const outbox = new InMemoryOutboxStore();
    const entry = buildWorkflowEscalationOutboxEntry({
      tenantId: T1,
      taskId: 'task-1',
      payload: { a: 1 },
      delayMs: 2 * HOUR,
    });
    expect(entry.metadata?.delay).toBeUndefined();
    expect(entry.availableAt?.toISOString()).toBe('2026-01-01T02:00:00.000Z');
    await outbox.enqueue(entry);
    const relay = new OutboxRelay({ store: outbox, queue });

    vi.setSystemTime(new Date('2026-01-01T01:59:59.000Z'));
    expect(await relay.tick()).toBe(0);
    expect(store.pendingCount).toBe(0);

    vi.setSystemTime(new Date('2026-01-01T02:00:00.000Z'));
    expect(await relay.tick()).toBe(1);
    expect(store.pendingCount).toBe(1);
    const [sent, options] = dispatchSpy.mock.calls[0]!;
    expect(requestedDelayMs(sent, options)).toBe(0);
    await queue.disconnect();
  });

  it('legacy rows carrying metadata.delay get only the remaining delay (never delivered early)', async () => {
    const queue = new InMemoryDurableQueueAdapter();
    await queue.connect();
    const dispatchSpy = vi.spyOn(queue, 'dispatch');
    const outbox = new InMemoryOutboxStore();
    await outbox.enqueue({
      id: 'row-1',
      tenantId: T1,
      aggregateType: 'workflow_escalation',
      aggregateId: 'task-1',
      eventType: 'workflow.escalation',
      payload: {},
      metadata: { delay: 2 * HOUR },
    });
    const relay = new OutboxRelay({ store: outbox, queue });
    expect(await relay.tick()).toBe(1);
    const [sent, options] = dispatchSpy.mock.calls[0]!;
    const remaining = requestedDelayMs(sent, options);
    expect(remaining).toBeGreaterThan(2 * HOUR - 5_000);
    expect(remaining).toBeLessThanOrEqual(2 * HOUR);
    await queue.disconnect();
  });

  it('a transport that refuses delay (Kafka) defers the row in the outbox, then sends it undelayed when due', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    const outbox = new InMemoryOutboxStore();
    await outbox.enqueue({
      id: 'row-k',
      tenantId: T1,
      aggregateType: 'workflow_escalation',
      aggregateId: 'task-k',
      eventType: 'workflow.escalation',
      payload: {},
      metadata: { delay: 60_000 },
    });
    const dispatch = vi.fn(async (m: QueueMessage, o?: { delay?: number }) => {
      if (requestedDelayMs(m, o) > 0) throw new QueueUnsupportedOperationError('no delay');
    });
    const queue = { dispatch, publish: vi.fn() } as never;
    const relay = new OutboxRelay({ store: outbox, queue });
    expect(await relay.tick()).toBe(0);
    const [row] = await outbox.listPending();
    expect(row!.status).toBe('pending');
    expect(row!.availableAt.toISOString()).toBe('2026-01-01T00:01:00.000Z');
    vi.setSystemTime(new Date('2026-01-01T00:00:59Z'));
    expect(await relay.tick()).toBe(0); // not due: not claimed
    vi.setSystemTime(new Date('2026-01-01T00:01:00Z'));
    expect(await relay.tick()).toBe(1);
    const [sent, options] = dispatch.mock.calls.at(-1)!;
    expect(requestedDelayMs(sent, options)).toBe(0);
  });
});

describe('adapter delay contract: honour or throw (PRC-M360)', () => {
  it('InMemoryDurable honours delay: not leasable until due', async () => {
    let now = 1_000_000;
    const store = new InMemoryDurableQueueStore(() => now);
    const queue = new InMemoryDurableQueueAdapter({ store });
    await queue.connect();
    await queue.dispatch(msg(), { delay: 5000 });
    expect(store.lease()).toBeUndefined();
    now += 5000;
    expect(store.lease()?.message.id).toBe('m-1');
    await queue.disconnect();
  });

  it('Kafka throws QueueUnsupportedOperationError for delayed delivery', async () => {
    const { KafkaAdapter } = await import('../adapters/kafka-adapter');
    const kafka = new KafkaAdapter({ brokers: ['localhost:9092'], clientId: 'test' });
    await kafka.connect();
    await expect(kafka.dispatch(msg(), { delay: 1000 })).rejects.toBeInstanceOf(
      QueueUnsupportedOperationError,
    );
    await expect(kafka.publish(msg(1000))).rejects.toBeInstanceOf(QueueUnsupportedOperationError);
    await expect(kafka.publish(msg())).resolves.toBeUndefined();
    await kafka.disconnect();
  });

  it('RabbitMQ throws above its supported delay cap instead of silently clamping', async () => {
    const rabbit = new RabbitMQAdapter({ url: 'amqp://unused' });
    // The rejection happens before any broker interaction; install the minimal
    // connected state so this exercises the public dispatch contract.
    const connected = rabbit as unknown as { connected: boolean; channel: unknown };
    connected.connected = true;
    connected.channel = {};

    await expect(rabbit.dispatch(msg(), { delay: MAX_DELAY_MS + 1 })).rejects.toBeInstanceOf(
      QueueUnsupportedOperationError,
    );
  });

  it('SQS honours <=15min exactly, throws above the cap and on FIFO', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const make = async (fifo: boolean) => {
      const a = new SQSAdapter({ region: 'us-east-1', queueUrlPrefix: '', fifo });
      await a.connect();
      const client = (a as unknown as { client: { send: (c: unknown) => Promise<unknown> } })
        .client;
      client.send = vi.fn(async (cmd: unknown) => {
        const c = cmd as { constructor: { name: string }; input: Record<string, unknown> };
        if (c.constructor.name === 'GetQueueUrlCommand') return { QueueUrl: 'https://sqs/q' };
        if (c.constructor.name === 'SendMessageCommand') sent.push(c.input);
        return {};
      });
      return a;
    };
    const std = await make(false);
    await std.dispatch(msg(), { delay: 1500 });
    expect(sent[0]!['DelaySeconds']).toBe(2);
    await expect(std.dispatch(msg(), { delay: 2 * HOUR })).rejects.toBeInstanceOf(
      QueueUnsupportedOperationError,
    );
    const fifo = await make(true);
    await expect(fifo.dispatch(msg(), { delay: 1000 })).rejects.toBeInstanceOf(
      QueueUnsupportedOperationError,
    );
    expect(sent).toHaveLength(1);
    await std.disconnect();
    await fifo.disconnect();
  });
});
