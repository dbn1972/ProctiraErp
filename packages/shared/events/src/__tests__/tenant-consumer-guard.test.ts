/**
 * PRC-M633: consumers must check the caller tenant (topic 4 Option A).
 *
 * - Kafka: a message on `tenant.A.<aggregate>` whose body claims tenant B is
 *   never dispatched to the tenant-A handler.
 * - RabbitMQ: a task delivered to tenant A's queue whose body claims tenant B
 *   is dead-lettered (nack, no requeue) and never handled.
 * - RabbitMQ `ensureQueue` builds the queue name through the fail-closed
 *   tenant builder (blank tenant throws).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const state: { eachMessage?: (payload: unknown) => Promise<void> } = {};
  const kafkaConsumer = {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
    run: vi.fn().mockImplementation((opts: { eachMessage: (p: unknown) => Promise<void> }) => {
      state.eachMessage = opts.eachMessage;
      return Promise.resolve();
    }),
    stop: vi.fn().mockResolvedValue(undefined),
  };
  const rabbit: { onMessage?: (msg: unknown) => void } = {};
  const channel = {
    assertExchange: vi.fn().mockResolvedValue(undefined),
    assertQueue: vi.fn().mockResolvedValue({ queue: 'q' }),
    bindQueue: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn().mockReturnValue(true),
    consume: vi.fn().mockImplementation((_q: string, cb: (msg: unknown) => void) => {
      rabbit.onMessage = cb;
      return Promise.resolve({ consumerTag: 'tag-1' });
    }),
    ack: vi.fn(),
    nack: vi.fn(),
    cancel: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    prefetch: vi.fn().mockResolvedValue(undefined),
  };
  const connection = {
    createChannel: vi.fn().mockResolvedValue(channel),
    createConfirmChannel: vi.fn().mockResolvedValue(channel),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return { state, kafkaConsumer, rabbit, channel, connection };
});
vi.mock('kafkajs', () => ({
  Kafka: vi.fn().mockImplementation(() => ({
    consumer: () => mocks.kafkaConsumer,
    producer: () => ({}),
  })),
}));
vi.mock('amqplib', () => ({
  default: { connect: vi.fn().mockResolvedValue(mocks.connection) },
}));
import { TenantScopeError } from '../tenant-scope';
import { KafkaEventConsumer } from '../kafka/consumer';
import { RabbitMQPublisher } from '../rabbitmq/publisher';
import { RabbitMQSubscriber } from '../rabbitmq/subscriber';
import type { DomainEvent, TaskMessage } from '../types';
function event(tenantId: string): DomainEvent {
  return {
    id: `evt-${tenantId}`,
    tenantId,
    type: 'student.enrolled',
    aggregateId: 's-1',
    aggregateType: 'student',
    payload: {},
    metadata: {
      timestamp: '2026-10-28T00:00:00.000Z',
      correlationId: 'c',
      causationId: 'c',
      userId: 'u',
    },
  };
}
async function deliverKafka(topic: string, body: unknown): Promise<void> {
  await mocks.state.eachMessage!({
    topic,
    partition: 0,
    message: { value: Buffer.from(JSON.stringify(body)) },
  });
}
describe('PRC-M633 Kafka consumer tenant check', () => {
  beforeEach(() => {
    mocks.state.eachMessage = undefined;
  });
  it('dispatches only messages whose tenantId equals the subscribed topic tenant', async () => {
    const consumer = new KafkaEventConsumer({
      brokers: ['localhost:9092'],
      clientId: 'c',
      groupId: 'g',
    });
    const handler = vi.fn().mockResolvedValue(undefined);
    await consumer.connect();
    await consumer.subscribe({ tenantId: 'tenant-a', aggregateType: 'student', handler });
    await consumer.start();
    await deliverKafka('tenant.tenant-a.student', event('tenant-b'));
    expect(handler).not.toHaveBeenCalled();
    await deliverKafka('tenant.tenant-a.student', { ...event('tenant-a'), tenantId: undefined });
    expect(handler).not.toHaveBeenCalled();
    await deliverKafka('tenant.tenant-a.student', event('tenant-a'));
    expect(handler).toHaveBeenCalledTimes(1);
    expect((handler.mock.calls[0]![0] as DomainEvent).tenantId).toBe('tenant-a');
  });
  it('ignores messages on topics it never subscribed to', async () => {
    const consumer = new KafkaEventConsumer({
      brokers: ['localhost:9092'],
      clientId: 'c',
      groupId: 'g',
    });
    const handler = vi.fn().mockResolvedValue(undefined);
    await consumer.connect();
    await consumer.subscribe({ tenantId: 'tenant-a', aggregateType: 'student', handler });
    await consumer.start();
    await deliverKafka('tenant.tenant-b.student', event('tenant-b'));
    expect(handler).not.toHaveBeenCalled();
  });
});
function task(tenantId: string): TaskMessage {
  return {
    id: `task-${tenantId}`,
    tenantId,
    type: 'report.generate',
    payload: {},
    options: { priority: 5, delay: 0, retryCount: 0, maxRetries: 3 },
  } as TaskMessage;
}
async function deliverRabbit(body: unknown): Promise<{ content: Buffer }> {
  const msg = {
    content: Buffer.from(JSON.stringify(body)),
    fields: { routingKey: 'tenant.tenant-a.report.generate' },
    properties: { headers: {} },
  };
  mocks.rabbit.onMessage!(msg);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return msg;
}
describe('PRC-M633 RabbitMQ subscriber tenant check', () => {
  beforeEach(() => {
    mocks.channel.ack.mockClear();
    mocks.channel.nack.mockClear();
    mocks.channel.publish.mockClear();
  });
  it('dead-letters a task whose tenantId differs from the subscription tenant', async () => {
    const subscriber = new RabbitMQSubscriber({ url: 'amqp://localhost' });
    const handler = vi.fn().mockResolvedValue(undefined);
    await subscriber.connect();
    await subscriber.subscribe({
      tenantId: 'tenant-a',
      queueName: 'reports',
      routingPattern: 'report.*',
      handler,
    });
    const foreign = await deliverRabbit(task('tenant-b'));
    expect(handler).not.toHaveBeenCalled();
    expect(mocks.channel.nack).toHaveBeenCalledWith(foreign, false, false);
    expect(mocks.channel.publish).not.toHaveBeenCalled();
    const own = await deliverRabbit(task('tenant-a'));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(mocks.channel.ack).toHaveBeenCalledWith(own);
  });
});
describe('PRC-M633 RabbitMQ ensureQueue uses the tenant builder', () => {
  it('rejects an empty queue name instead of asserting the bare tenant prefix', async () => {
    const publisher = new RabbitMQPublisher({ url: 'amqp://localhost' });
    await publisher.connect();
    mocks.channel.assertQueue.mockClear();
    await expect(publisher.ensureQueue('tenant-a', ' ', 'report.*')).rejects.toBeInstanceOf(
      TenantScopeError,
    );
    expect(mocks.channel.assertQueue).not.toHaveBeenCalled();
  });
  it('builds the same normalised queue name as the subscriber', async () => {
    const publisher = new RabbitMQPublisher({ url: 'amqp://localhost' });
    await publisher.connect();
    mocks.channel.assertQueue.mockClear();
    await publisher.ensureQueue(' tenant-a ', 'reports', 'report.*');
    const names = mocks.channel.assertQueue.mock.calls.map((c) => c[0] as string);
    expect(names).toContain('tenant.tenant-a.reports');
    expect(names.every((n) => !n.includes(' '))).toBe(true);
  });
});
