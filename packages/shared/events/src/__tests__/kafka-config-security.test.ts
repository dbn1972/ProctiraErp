/**
 * PRC-L492: SASL credentials must not travel over plaintext in production.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('kafkajs', () => {
  class Kafka {
    producer() {
      return { connect: vi.fn(), disconnect: vi.fn(), send: vi.fn() };
    }
    consumer() {
      return { connect: vi.fn(), disconnect: vi.fn(), subscribe: vi.fn(), run: vi.fn() };
    }
  }
  return { Kafka };
});

import { assertKafkaConfigSecure } from '../kafka/config';
import { KafkaEventConsumer } from '../kafka/consumer';
import { KafkaEventProducer } from '../kafka/producer';

const sasl = { mechanism: 'scram-sha-512' as const, username: 'svc', password: 'pw-not-logged' };
const base = { brokers: ['kafka:9093'], clientId: 'c', groupId: 'g' };

describe('Kafka transport security (PRC-L492)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sasl without ssl throws in production', () => {
    expect(() => assertKafkaConfigSecure({ ...base, sasl }, 'production')).toThrow(/ssl=true/);
  });

  it('producer and consumer constructors throw in production for sasl without ssl', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => new KafkaEventProducer({ ...base, sasl })).toThrow(/ssl=true/);
    expect(() => new KafkaEventConsumer({ ...base, sasl })).toThrow(/ssl=true/);
  });

  it('error message never contains the password', () => {
    try {
      assertKafkaConfigSecure({ ...base, sasl }, 'production');
    } catch (err) {
      expect(String((err as Error).message)).not.toContain(sasl.password);
    }
  });

  it('allows sasl with ssl in production, and sasl without ssl in development/test', () => {
    expect(() => assertKafkaConfigSecure({ ...base, sasl, ssl: true }, 'production')).not.toThrow();
    expect(() => assertKafkaConfigSecure({ ...base, sasl }, 'development')).not.toThrow();
    expect(() => assertKafkaConfigSecure({ ...base, sasl }, 'test')).not.toThrow();
  });

  it('treats unset NODE_ENV like production', () => {
    vi.stubEnv('NODE_ENV', '');
    expect(() => assertKafkaConfigSecure({ ...base, sasl })).toThrow(/ssl=true/);
  });

  it('rejects empty brokers and incomplete sasl', () => {
    expect(() => assertKafkaConfigSecure({ ...base, brokers: [] }, 'test')).toThrow(/brokers/);
    expect(() => assertKafkaConfigSecure({ ...base, brokers: [' '] }, 'test')).toThrow(/brokers/);
    expect(() =>
      assertKafkaConfigSecure({ ...base, sasl: { ...sasl, password: '' } }, 'test'),
    ).toThrow(/sasl requires/);
  });

  it('plaintext without sasl is allowed (no credentials exposed)', () => {
    expect(() => assertKafkaConfigSecure(base, 'production')).not.toThrow();
  });
});
