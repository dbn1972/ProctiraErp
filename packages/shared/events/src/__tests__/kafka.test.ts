import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildTenantTopic, DEFAULT_KAFKA_CONFIG } from '../kafka/config';

// Mock kafkajs
vi.mock('kafkajs', () => {
  const mockProducer = {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue([{ topicName: 'test', partition: 0, errorCode: 0, offset: '0' }]),
    sendBatch: vi.fn().mockResolvedValue([{ topicName: 'test', partition: 0, errorCode: 0, offset: '0' }]),
  };

  const mockConsumer = {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
    run: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  };

  return {
    Kafka: vi.fn().mockImplementation(() => ({
      producer: () => mockProducer,
      consumer: () => mockConsumer,
    })),
  };
});

import { KafkaEventConsumer } from '../kafka/consumer';
import { KafkaEventProducer } from '../kafka/producer';
import type { DomainEvent } from '../types';

describe('Kafka Config', () => {
  describe('buildTenantTopic', () => {
    it('should build a tenant-prefixed topic', () => {
      expect(buildTenantTopic('tenant-001', 'student')).toBe('tenant.tenant-001.student');
    });

    it('should handle different tenant IDs', () => {
      expect(buildTenantTopic('abc-123', 'institution')).toBe('tenant.abc-123.institution');
    });

    it('should handle complex aggregate types', () => {
      expect(buildTenantTopic('t1', 'workflow.approval')).toBe('tenant.t1.workflow.approval');
    });
  });

  describe('DEFAULT_KAFKA_CONFIG', () => {
    it('should have sensible defaults', () => {
      expect(DEFAULT_KAFKA_CONFIG.connectionTimeout).toBe(10000);
      expect(DEFAULT_KAFKA_CONFIG.requestTimeout).toBe(30000);
      expect(DEFAULT_KAFKA_CONFIG.retries).toBe(5);
      expect(DEFAULT_KAFKA_CONFIG.ssl).toBe(false);
    });
  });
});

describe('KafkaEventProducer', () => {
  let producer: KafkaEventProducer;

  const testEvent: DomainEvent = {
    id: 'evt-001',
    tenantId: 'tenant-001',
    type: 'student.enrolled',
    aggregateId: 'student-123',
    aggregateType: 'student',
    payload: { name: 'Test Student' },
    metadata: {
      timestamp: '2024-01-15T10:00:00.000Z',
      correlationId: 'corr-001',
      causationId: 'cause-001',
      userId: 'user-001',
    },
  };

  beforeEach(() => {
    producer = new KafkaEventProducer({
      brokers: ['localhost:9092'],
      clientId: 'test-producer',
    });
  });

  it('should not be connected initially', () => {
    expect(producer.isConnected()).toBe(false);
  });

  it('should connect successfully', async () => {
    await producer.connect();
    expect(producer.isConnected()).toBe(true);
  });

  it('should not reconnect if already connected', async () => {
    await producer.connect();
    await producer.connect(); // Should not throw
    expect(producer.isConnected()).toBe(true);
  });

  it('should disconnect successfully', async () => {
    await producer.connect();
    await producer.disconnect();
    expect(producer.isConnected()).toBe(false);
  });

  it('should throw when publishing without connection', async () => {
    await expect(producer.publish(testEvent)).rejects.toThrow(
      'KafkaEventProducer is not connected'
    );
  });

  it('should publish an event to a tenant-prefixed topic', async () => {
    await producer.connect();
    const result = await producer.publish(testEvent);
    expect(result).toBeDefined();
  });

  it('should publish a batch of events', async () => {
    await producer.connect();
    const events = [testEvent, { ...testEvent, id: 'evt-002', aggregateId: 'student-456' }];
    const result = await producer.publishBatch(events);
    expect(result).toBeDefined();
  });

  it('should throw when publishing batch without connection', async () => {
    await expect(producer.publishBatch([testEvent])).rejects.toThrow(
      'KafkaEventProducer is not connected'
    );
  });
});

describe('KafkaEventConsumer', () => {
  it('should require groupId in config', () => {
    expect(
      () =>
        new KafkaEventConsumer({
          brokers: ['localhost:9092'],
          clientId: 'test-consumer',
        })
    ).toThrow('KafkaEventConsumer requires a groupId');
  });

  it('should create consumer with valid config', () => {
    const consumer = new KafkaEventConsumer({
      brokers: ['localhost:9092'],
      clientId: 'test-consumer',
      groupId: 'test-group',
    });
    expect(consumer.isConnected()).toBe(false);
    expect(consumer.isRunning()).toBe(false);
  });

  it('should connect successfully', async () => {
    const consumer = new KafkaEventConsumer({
      brokers: ['localhost:9092'],
      clientId: 'test-consumer',
      groupId: 'test-group',
    });
    await consumer.connect();
    expect(consumer.isConnected()).toBe(true);
  });

  it('should throw when subscribing without connection', async () => {
    const consumer = new KafkaEventConsumer({
      brokers: ['localhost:9092'],
      clientId: 'test-consumer',
      groupId: 'test-group',
    });
    await expect(
      consumer.subscribe({
        tenantId: 'tenant-001',
        aggregateType: 'student',
        handler: async () => {},
      })
    ).rejects.toThrow('KafkaEventConsumer is not connected');
  });

  it('should subscribe to a tenant topic', async () => {
    const consumer = new KafkaEventConsumer({
      brokers: ['localhost:9092'],
      clientId: 'test-consumer',
      groupId: 'test-group',
    });
    await consumer.connect();
    await consumer.subscribe({
      tenantId: 'tenant-001',
      aggregateType: 'student',
      handler: async () => {},
    });
    expect(consumer.getSubscriptions()).toHaveLength(1);
  });

  it('should start consuming', async () => {
    const consumer = new KafkaEventConsumer({
      brokers: ['localhost:9092'],
      clientId: 'test-consumer',
      groupId: 'test-group',
    });
    await consumer.connect();
    await consumer.subscribe({
      tenantId: 'tenant-001',
      aggregateType: 'student',
      handler: async () => {},
    });
    await consumer.start();
    expect(consumer.isRunning()).toBe(true);
  });

  it('should throw when starting without connection', async () => {
    const consumer = new KafkaEventConsumer({
      brokers: ['localhost:9092'],
      clientId: 'test-consumer',
      groupId: 'test-group',
    });
    await expect(consumer.start()).rejects.toThrow(
      'KafkaEventConsumer is not connected'
    );
  });

  it('should disconnect and stop consuming', async () => {
    const consumer = new KafkaEventConsumer({
      brokers: ['localhost:9092'],
      clientId: 'test-consumer',
      groupId: 'test-group',
    });
    await consumer.connect();
    await consumer.subscribe({
      tenantId: 'tenant-001',
      aggregateType: 'student',
      handler: async () => {},
    });
    await consumer.start();
    await consumer.disconnect();
    expect(consumer.isConnected()).toBe(false);
    expect(consumer.isRunning()).toBe(false);
  });
});
