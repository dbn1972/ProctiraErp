/**
 * PRC-M364: poison-message handling for Kafka and SQS consumers.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { QueueMessage } from '../types';

const kafkaState: {
  eachMessage?: (p: unknown) => Promise<void>;
  sent: Array<{ topic: string; messages: Array<Record<string, unknown>> }>;
} = { sent: [] };

vi.mock('kafkajs', () => {
  class Kafka {
    producer() {
      return {
        connect: vi.fn(),
        disconnect: vi.fn(),
        send: vi.fn(async (r: { topic: string; messages: Array<Record<string, unknown>> }) => {
          kafkaState.sent.push(r);
        }),
      };
    }
    consumer() {
      return {
        connect: vi.fn(),
        disconnect: vi.fn(),
        subscribe: vi.fn(),
        run: vi.fn(async (o: { eachMessage: (p: unknown) => Promise<void> }) => {
          kafkaState.eachMessage = o.eachMessage;
        }),
      };
    }
  }
  return { Kafka };
});

const { KafkaAdapter } = await import('../adapters/kafka-adapter');
const { SQSAdapter } = await import('../adapters/sqs-adapter');

const T1 = '11111111-1111-4111-8111-111111111111';
const topic = `tenant.${T1}.events`;
const good = (id: string): QueueMessage => ({
  id,
  tenantId: T1,
  type: 'events',
  payload: {},
  timestamp: new Date().toISOString(),
});
const deliver = (value: string, offset: string) =>
  kafkaState.eachMessage!({
    topic,
    partition: 0,
    message: { value: Buffer.from(value), offset, key: null, headers: {} },
  });

describe('Kafka poison messages (PRC-M364)', () => {
  afterEach(() => {
    kafkaState.sent = [];
  });

  it('malformed JSON is dead-lettered and following messages still process', async () => {
    const error = vi.fn();
    const adapter = new KafkaAdapter({ brokers: ['b:9092'], clientId: 'c' }, { logger: { error } });
    await adapter.connect();
    const handler = vi.fn();
    await adapter.subscribe({ topic }, handler);
    await expect(deliver('{not json', '7')).resolves.toBeUndefined();
    await deliver(JSON.stringify(good('m-2')), '8');
    expect(kafkaState.sent).toHaveLength(1);
    expect(kafkaState.sent[0]!.topic).toBe(`${topic}.dlq`);
    const headers = kafkaState.sent[0]!.messages[0]!['headers'] as Record<string, string>;
    expect(headers['x-dlq-reason']).toBe('parse-error');
    expect(headers['x-dlq-source-offset']).toBe('7');
    expect(handler).toHaveBeenCalledTimes(1);
    expect((handler.mock.calls[0]![0] as QueueMessage).id).toBe('m-2');
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'parse-error' }),
      'kafka message dead-lettered',
    );
    await adapter.disconnect();
  });

  it('a handler that keeps failing is retried then dead-lettered (partition not wedged)', async () => {
    const adapter = new KafkaAdapter({
      brokers: ['b:9092'],
      clientId: 'c',
      maxHandlerRetries: 2,
      handlerRetryBackoffMs: 1,
    });
    await adapter.connect();
    const handler = vi.fn(async () => {
      throw new Error('boom');
    });
    await adapter.subscribe({ topic }, handler);
    await expect(deliver(JSON.stringify(good('m-3')), '9')).resolves.toBeUndefined();
    expect(handler).toHaveBeenCalledTimes(3);
    expect(kafkaState.sent[0]!.topic).toBe(`${topic}.dlq`);
    await adapter.disconnect();
  });
});

describe('SQS consumer resilience (PRC-M364)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('receive failures are logged and back off exponentially', async () => {
    vi.useFakeTimers();
    const error = vi.fn();
    const adapter = new SQSAdapter(
      { region: 'us-east-1', queueUrlPrefix: '', waitTimeSeconds: 0 },
      { logger: { error } },
    );
    await adapter.connect();
    let receives = 0;
    const client = (adapter as unknown as { client: { send: (c: unknown) => Promise<unknown> } })
      .client;
    client.send = vi.fn(async (cmd: unknown) => {
      const name = (cmd as { constructor: { name: string } }).constructor.name;
      if (name === 'GetQueueUrlCommand') return { QueueUrl: 'https://sqs/q' };
      if (name === 'ReceiveMessageCommand') {
        receives += 1;
        throw new Error('ExpiredToken');
      }
      return {};
    });
    await adapter.subscribe({ topic }, vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(receives).toBe(1);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ err: 'ExpiredToken', consecutiveFailures: 1, nextPollMs: 1000 }),
      'sqs receive failed; backing off',
    );
    await vi.advanceTimersByTimeAsync(999);
    expect(receives).toBe(1); // no 100ms hot loop
    await vi.advanceTimersByTimeAsync(1);
    expect(receives).toBe(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(receives).toBe(3);
    expect(adapter.nextPollDelayMs()).toBe(4000);
    await adapter.disconnect();
  });

  it('created queues carry a RedrivePolicy to a DLQ', async () => {
    const adapter = new SQSAdapter({ region: 'us-east-1', queueUrlPrefix: '', maxReceiveCount: 4 });
    await adapter.connect();
    const creates: Array<Record<string, unknown>> = [];
    const client = (adapter as unknown as { client: { send: (c: unknown) => Promise<unknown> } })
      .client;
    client.send = vi.fn(async (cmd: unknown) => {
      const c = cmd as { constructor: { name: string }; input: Record<string, unknown> };
      if (c.constructor.name === 'GetQueueUrlCommand') {
        throw Object.assign(new Error('missing'), { name: 'QueueDoesNotExist' });
      }
      if (c.constructor.name === 'CreateQueueCommand') {
        creates.push(c.input);
        return { QueueUrl: `https://sqs/${String(c.input['QueueName'])}` };
      }
      if (c.constructor.name === 'GetQueueAttributesCommand') {
        return { Attributes: { QueueArn: 'arn:aws:sqs:us-east-1:0:dlq' } };
      }
      return {};
    });
    await adapter.dispatch(good('m-4'));
    expect(String(creates[0]!['QueueName'])).toMatch(/-dlq$/);
    const attrs = creates[1]!['Attributes'] as Record<string, string>;
    expect(JSON.parse(attrs['RedrivePolicy']!)).toEqual({
      deadLetterTargetArn: 'arn:aws:sqs:us-east-1:0:dlq',
      maxReceiveCount: '4',
    });
    await adapter.disconnect();
  });
});
