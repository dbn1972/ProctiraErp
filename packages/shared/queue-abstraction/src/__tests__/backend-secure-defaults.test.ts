/**
 * PRC-L356 — Kafka refuses plaintext in production; SQS only creates queues on
 * QueueDoesNotExist and honours queueUrlPrefix.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KafkaAdapter } from '../adapters/kafka-adapter';
import { SQSAdapter } from '../adapters/sqs-adapter';

const T1 = '11111111-1111-4111-8111-111111111111';
const PREFIX = 'https://sqs.us-east-1.amazonaws.com/123456789';

function msg() {
  return { id: 'm1', type: 'x', tenantId: T1, payload: {}, timestamp: new Date().toISOString() };
}

function sqsWith(
  respond: (name: string) => unknown,
  extra: Partial<ConstructorParameters<typeof SQSAdapter>[0]> = {},
) {
  const adapter = new SQSAdapter({ region: 'us-east-1', queueUrlPrefix: PREFIX, ...extra });
  const calls: string[] = [];
  return {
    adapter,
    calls,
    async connect() {
      await adapter.connect();
      const client = (adapter as unknown as { client: { send: unknown } }).client;
      client.send = vi.fn(async (cmd: unknown) => {
        const name = (cmd as { constructor: { name: string } }).constructor.name;
        calls.push(name);
        return respond(name);
      });
    },
  };
}

function awsError(name: string): Error {
  const e = new Error(name);
  e.name = name;
  return e;
}

describe('PRC-L356 Kafka TLS in production', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('production env + ssl disabled throws', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => new KafkaAdapter({ brokers: ['b:9092'], clientId: 'c' })).toThrow(/ssl/);
    expect(
      () =>
        new KafkaAdapter({
          brokers: ['b:9092'],
          clientId: 'c',
          ssl: false,
          sasl: { mechanism: 'plain', username: 'u', password: 'p' },
        }),
    ).toThrow(/SASL\/PLAIN/);
  });

  it('production env + ssl enabled is allowed; non-production keeps the old default', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => new KafkaAdapter({ brokers: ['b:9092'], clientId: 'c', ssl: true })).not.toThrow();
    vi.stubEnv('NODE_ENV', 'test');
    expect(() => new KafkaAdapter({ brokers: ['b:9092'], clientId: 'c' })).not.toThrow();
  });
});

describe('PRC-L356 SQS queue resolution', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('AccessDenied on GetQueueUrl does not call CreateQueue', async () => {
    const s = sqsWith((name) => {
      if (name === 'GetQueueUrlCommand') throw awsError('AccessDenied');
      return {};
    });
    await s.connect();
    await expect(s.adapter.publish(msg())).rejects.toThrow('AccessDenied');
    expect(s.calls).not.toContain('CreateQueueCommand');
  });

  it('QueueDoesNotExist creates the queue outside production', async () => {
    const s = sqsWith((name) => {
      if (name === 'GetQueueUrlCommand') throw awsError('QueueDoesNotExist');
      if (name === 'CreateQueueCommand') return { QueueUrl: `${PREFIX}/tenant-${T1}-x` };
      return {};
    });
    await s.connect();
    await s.adapter.publish(msg());
    expect(s.calls).toEqual(['GetQueueUrlCommand', 'CreateQueueCommand', 'SendMessageCommand']);
  });

  it('QueueDoesNotExist does not create queues in production by default', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const s = sqsWith((name) => {
      if (name === 'GetQueueUrlCommand') throw awsError('QueueDoesNotExist');
      return {};
    });
    await s.connect();
    await expect(s.adapter.publish(msg())).rejects.toThrow('QueueDoesNotExist');
    expect(s.calls).not.toContain('CreateQueueCommand');
  });

  it('rejects a resolved queue URL outside queueUrlPrefix', async () => {
    const s = sqsWith((name) =>
      name === 'GetQueueUrlCommand'
        ? { QueueUrl: 'https://sqs.eu-west-1.amazonaws.com/999/q' }
        : {},
    );
    await s.connect();
    await expect(s.adapter.publish(msg())).rejects.toThrow(/queueUrlPrefix/);
    expect(s.calls).not.toContain('SendMessageCommand');
  });
});
