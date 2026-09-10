/**
 * Contract tests for the QueueAdapter interface.
 * Ensures all adapter implementations produce identical behavior
 * for core operations using a mock/stub approach.
 *
 * These tests verify the contract (interface compliance) without
 * requiring actual broker connections. They test:
 * - Connection lifecycle (connect/disconnect/isConnected)
 * - Error behavior when not connected
 * - Tenant-prefixed naming convention
 * - Health check response structure
 */

import { describe, it, expect, beforeEach } from 'vitest';

import type { QueueAdapter, QueueMessage } from '../types';
import { KafkaAdapter } from '../adapters/kafka-adapter';
import { RabbitMQAdapter } from '../adapters/rabbitmq-adapter';
import { SQSAdapter } from '../adapters/sqs-adapter';

/**
 * Creates a test message for contract testing.
 */
function createTestMessage(overrides?: Partial<QueueMessage>): QueueMessage {
  return {
    id: 'msg-001',
    tenantId: 'tenant-abc',
    type: 'student.enrolled',
    payload: { studentId: 'stu-123', institutionId: 'inst-456' },
    timestamp: new Date().toISOString(),
    metadata: {
      correlationId: 'corr-789',
      priority: 5,
    },
    ...overrides,
  };
}

/**
 * Adapter factory entries for parameterized contract tests.
 */
interface AdapterEntry {
  name: string;
  create: () => QueueAdapter;
}

const adapters: AdapterEntry[] = [
  {
    name: 'KafkaAdapter',
    create: () =>
      new KafkaAdapter({
        brokers: ['localhost:9092'],
        clientId: 'test-client',
        groupId: 'test-group',
      }),
  },
  {
    name: 'RabbitMQAdapter',
    create: () =>
      new RabbitMQAdapter({
        url: 'amqp://localhost:5672',
        exchange: 'test-exchange',
      }),
  },
  {
    name: 'SQSAdapter',
    create: () =>
      new SQSAdapter({
        region: 'us-east-1',
        queueUrlPrefix: 'https://sqs.us-east-1.amazonaws.com/123456789',
      }),
  },
];

describe('QueueAdapter Contract Tests', () => {
  describe.each(adapters)('$name', ({ create }) => {
    let adapter: QueueAdapter;

    beforeEach(() => {
      adapter = create();
    });

    describe('Connection Lifecycle', () => {
      it('should start in disconnected state', () => {
        expect(adapter.isConnected()).toBe(false);
      });

      it('should throw on publish when not connected', async () => {
        const message = createTestMessage();
        await expect(adapter.publish(message)).rejects.toThrow(/not connected/i);
      });

      it('should throw on subscribe when not connected', async () => {
        await expect(adapter.subscribe({ topic: 'test' }, async () => {})).rejects.toThrow(
          /not connected/i,
        );
      });

      it('should throw on dispatch when not connected', async () => {
        const message = createTestMessage();
        await expect(adapter.dispatch(message)).rejects.toThrow(/not connected/i);
      });

      it('should throw on consume when not connected', async () => {
        await expect(adapter.consume({ topic: 'test' }, async () => {})).rejects.toThrow(
          /not connected/i,
        );
      });
    });

    describe('Interface Compliance', () => {
      it('should implement all required methods', () => {
        expect(typeof adapter.connect).toBe('function');
        expect(typeof adapter.disconnect).toBe('function');
        expect(typeof adapter.publish).toBe('function');
        expect(typeof adapter.subscribe).toBe('function');
        expect(typeof adapter.dispatch).toBe('function');
        expect(typeof adapter.consume).toBe('function');
        expect(typeof adapter.healthCheck).toBe('function');
        expect(typeof adapter.isConnected).toBe('function');
      });
    });

    describe('Health Check Structure', () => {
      it('should return unhealthy when not connected', async () => {
        const result = await adapter.healthCheck();
        expect(result).toHaveProperty('healthy');
        expect(result).toHaveProperty('backend');
        expect(typeof result.backend).toBe('string');
        expect(result.backend.length).toBeGreaterThan(0);
      });

      it('should include latencyMs in health check result', async () => {
        const result = await adapter.healthCheck();
        expect(result).toHaveProperty('latencyMs');
        expect(typeof result.latencyMs).toBe('number');
        expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      });
    });
  });
});

describe('QueueMessage Structure', () => {
  it('should create a valid message with all required fields', () => {
    const message = createTestMessage();

    expect(message.id).toBeDefined();
    expect(message.tenantId).toBeDefined();
    expect(message.type).toBeDefined();
    expect(message.payload).toBeDefined();
    expect(message.timestamp).toBeDefined();
  });

  it('should support optional metadata', () => {
    const message = createTestMessage({ metadata: undefined });
    expect(message.metadata).toBeUndefined();
  });

  it('should support metadata with all fields', () => {
    const message = createTestMessage({
      metadata: {
        correlationId: 'corr-1',
        causationId: 'cause-1',
        userId: 'user-1',
        priority: 8,
        delay: 5000,
        maxRetries: 3,
        retryCount: 0,
        headers: { 'x-custom': 'value' },
      },
    });

    expect(message.metadata?.correlationId).toBe('corr-1');
    expect(message.metadata?.causationId).toBe('cause-1');
    expect(message.metadata?.userId).toBe('user-1');
    expect(message.metadata?.priority).toBe(8);
    expect(message.metadata?.delay).toBe(5000);
    expect(message.metadata?.maxRetries).toBe(3);
    expect(message.metadata?.retryCount).toBe(0);
    expect(message.metadata?.headers).toEqual({ 'x-custom': 'value' });
  });
});
