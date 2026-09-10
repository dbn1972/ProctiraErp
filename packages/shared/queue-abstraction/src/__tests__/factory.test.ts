/**
 * Unit tests for the queue adapter factory.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { createQueueAdapter, createQueueAdapterFromEnv } from '../factory';
import { KafkaAdapter } from '../adapters/kafka-adapter';
import { RabbitMQAdapter } from '../adapters/rabbitmq-adapter';
import { SQSAdapter } from '../adapters/sqs-adapter';

describe('createQueueAdapter', () => {
  it('should create a KafkaAdapter when backend is "kafka"', () => {
    const adapter = createQueueAdapter({
      backend: 'kafka',
      kafka: {
        brokers: ['localhost:9092'],
        clientId: 'test-client',
        groupId: 'test-group',
      },
    });

    expect(adapter).toBeInstanceOf(KafkaAdapter);
  });

  it('should create a RabbitMQAdapter when backend is "rabbitmq"', () => {
    const adapter = createQueueAdapter({
      backend: 'rabbitmq',
      rabbitmq: {
        url: 'amqp://localhost:5672',
        exchange: 'test-exchange',
      },
    });

    expect(adapter).toBeInstanceOf(RabbitMQAdapter);
  });

  it('should create an SQSAdapter when backend is "sqs"', () => {
    const adapter = createQueueAdapter({
      backend: 'sqs',
      sqs: {
        region: 'us-east-1',
        queueUrlPrefix: 'https://sqs.us-east-1.amazonaws.com/123456789',
      },
    });

    expect(adapter).toBeInstanceOf(SQSAdapter);
  });

  it('should throw when kafka config is missing for kafka backend', () => {
    expect(() => createQueueAdapter({ backend: 'kafka' })).toThrow(
      'Kafka configuration is required',
    );
  });

  it('should throw when rabbitmq config is missing for rabbitmq backend', () => {
    expect(() => createQueueAdapter({ backend: 'rabbitmq' })).toThrow(
      'RabbitMQ configuration is required',
    );
  });

  it('should throw when sqs config is missing for sqs backend', () => {
    expect(() => createQueueAdapter({ backend: 'sqs' })).toThrow('SQS configuration is required');
  });

  it('should throw for unsupported backend', () => {
    expect(() => createQueueAdapter({ backend: 'redis' as never })).toThrow(
      'Unsupported queue backend',
    );
  });
});

describe('createQueueAdapterFromEnv', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should throw when QUEUE_BACKEND is not set', () => {
    delete process.env['QUEUE_BACKEND'];
    expect(() => createQueueAdapterFromEnv()).toThrow(
      'QUEUE_BACKEND environment variable is required',
    );
  });

  it('should create KafkaAdapter from env vars', () => {
    process.env['QUEUE_BACKEND'] = 'kafka';
    process.env['KAFKA_BROKERS'] = 'broker1:9092,broker2:9092';
    process.env['KAFKA_CLIENT_ID'] = 'my-service';
    process.env['KAFKA_GROUP_ID'] = 'my-group';

    const adapter = createQueueAdapterFromEnv();
    expect(adapter).toBeInstanceOf(KafkaAdapter);
  });

  it('should throw when kafka env vars are missing', () => {
    process.env['QUEUE_BACKEND'] = 'kafka';
    delete process.env['KAFKA_BROKERS'];
    delete process.env['KAFKA_CLIENT_ID'];

    expect(() => createQueueAdapterFromEnv()).toThrow(
      'KAFKA_BROKERS and KAFKA_CLIENT_ID environment variables are required',
    );
  });

  it('should create RabbitMQAdapter from env vars', () => {
    process.env['QUEUE_BACKEND'] = 'rabbitmq';
    process.env['RABBITMQ_URL'] = 'amqp://localhost:5672';
    process.env['RABBITMQ_EXCHANGE'] = 'events';

    const adapter = createQueueAdapterFromEnv();
    expect(adapter).toBeInstanceOf(RabbitMQAdapter);
  });

  it('should throw when rabbitmq env vars are missing', () => {
    process.env['QUEUE_BACKEND'] = 'rabbitmq';
    delete process.env['RABBITMQ_URL'];
    delete process.env['RABBITMQ_EXCHANGE'];

    expect(() => createQueueAdapterFromEnv()).toThrow(
      'RABBITMQ_URL and RABBITMQ_EXCHANGE environment variables are required',
    );
  });

  it('should create SQSAdapter from env vars', () => {
    process.env['QUEUE_BACKEND'] = 'sqs';
    process.env['SQS_REGION'] = 'us-west-2';
    process.env['SQS_QUEUE_URL_PREFIX'] = 'https://sqs.us-west-2.amazonaws.com/123';

    const adapter = createQueueAdapterFromEnv();
    expect(adapter).toBeInstanceOf(SQSAdapter);
  });

  it('should throw when sqs env vars are missing', () => {
    process.env['QUEUE_BACKEND'] = 'sqs';
    delete process.env['SQS_REGION'];
    delete process.env['SQS_QUEUE_URL_PREFIX'];

    expect(() => createQueueAdapterFromEnv()).toThrow(
      'SQS_REGION and SQS_QUEUE_URL_PREFIX environment variables are required',
    );
  });

  it('should throw for unsupported backend env value', () => {
    process.env['QUEUE_BACKEND'] = 'redis';

    expect(() => createQueueAdapterFromEnv()).toThrow('Unsupported QUEUE_BACKEND value');
  });
});
