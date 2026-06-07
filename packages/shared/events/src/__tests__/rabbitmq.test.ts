import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildTenantQueue, buildTenantRoutingKey, DEFAULT_RABBITMQ_CONFIG } from '../rabbitmq/config';
import type { TaskMessage } from '../types';

// Create mock objects at module level using vi.hoisted
const mocks = vi.hoisted(() => {
  const mockChannel = {
    assertExchange: vi.fn().mockResolvedValue(undefined),
    assertQueue: vi.fn().mockResolvedValue({ queue: 'test-queue' }),
    bindQueue: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn().mockReturnValue(true),
    consume: vi.fn().mockResolvedValue({ consumerTag: 'tag-1' }),
    ack: vi.fn(),
    nack: vi.fn(),
    cancel: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    prefetch: vi.fn().mockResolvedValue(undefined),
  };

  const mockConnection = {
    createChannel: vi.fn().mockResolvedValue(mockChannel),
    close: vi.fn().mockResolvedValue(undefined),
  };

  return { mockChannel, mockConnection };
});

// Mock amqplib using hoisted mocks
vi.mock('amqplib', () => ({
  default: {
    connect: vi.fn().mockResolvedValue(mocks.mockConnection),
  },
}));

import { RabbitMQPublisher } from '../rabbitmq/publisher';
import { RabbitMQSubscriber } from '../rabbitmq/subscriber';

describe('RabbitMQ Config', () => {
  describe('buildTenantQueue', () => {
    it('should build a tenant-prefixed queue name', () => {
      expect(buildTenantQueue('tenant-001', 'reports')).toBe('tenant.tenant-001.reports');
    });

    it('should handle different tenant IDs', () => {
      expect(buildTenantQueue('abc', 'notifications')).toBe('tenant.abc.notifications');
    });
  });

  describe('buildTenantRoutingKey', () => {
    it('should build a tenant-prefixed routing key', () => {
      expect(buildTenantRoutingKey('tenant-001', 'report.generate')).toBe(
        'tenant.tenant-001.report.generate'
      );
    });
  });

  describe('DEFAULT_RABBITMQ_CONFIG', () => {
    it('should have sensible defaults', () => {
      expect(DEFAULT_RABBITMQ_CONFIG.exchangeType).toBe('topic');
      expect(DEFAULT_RABBITMQ_CONFIG.deadLetterExchange).toBe('dlx');
      expect(DEFAULT_RABBITMQ_CONFIG.prefetchCount).toBe(10);
      expect(DEFAULT_RABBITMQ_CONFIG.durable).toBe(true);
      expect(DEFAULT_RABBITMQ_CONFIG.heartbeat).toBe(60);
    });
  });
});

describe('RabbitMQPublisher', () => {
  let publisher: RabbitMQPublisher;

  const testTask: TaskMessage = {
    id: 'task-001',
    tenantId: 'tenant-001',
    type: 'report.generate',
    payload: { reportId: 'rpt-123' },
    options: {
      priority: 5,
      delay: 0,
      maxRetries: 3,
      retryCount: 0,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    publisher = new RabbitMQPublisher({
      url: 'amqp://localhost:5672',
      exchange: 'proctira.tasks',
    });
  });

  it('should not be connected initially', () => {
    expect(publisher.isConnected()).toBe(false);
  });

  it('should connect successfully', async () => {
    await publisher.connect();
    expect(publisher.isConnected()).toBe(true);
  });

  it('should assert exchanges on connect', async () => {
    await publisher.connect();
    // Main exchange + dead-letter exchange
    expect(mocks.mockChannel.assertExchange).toHaveBeenCalledTimes(2);
  });

  it('should disconnect successfully', async () => {
    await publisher.connect();
    await publisher.disconnect();
    expect(publisher.isConnected()).toBe(false);
  });

  it('should throw when publishing without connection', async () => {
    await expect(publisher.publish(testTask)).rejects.toThrow(
      'RabbitMQPublisher is not connected'
    );
  });

  it('should publish a task message', async () => {
    await publisher.connect();
    await publisher.publish(testTask);
    expect(mocks.mockChannel.publish).toHaveBeenCalledWith(
      'proctira.tasks',
      'tenant.tenant-001.report.generate',
      expect.any(Buffer),
      expect.objectContaining({
        persistent: true,
        priority: 5,
        messageId: 'task-001',
        contentType: 'application/json',
      })
    );
  });

  it('should include delay headers when delay > 0', async () => {
    await publisher.connect();
    const delayedTask: TaskMessage = {
      ...testTask,
      options: { ...testTask.options, delay: 5000 },
    };
    await publisher.publish(delayedTask);
    expect(mocks.mockChannel.publish).toHaveBeenCalledWith(
      'proctira.tasks',
      'tenant.tenant-001.report.generate',
      expect.any(Buffer),
      expect.objectContaining({
        expiration: '5000',
        headers: expect.objectContaining({
          'x-delay': 5000,
        }),
      })
    );
  });

  it('should publish a batch of tasks', async () => {
    await publisher.connect();
    const tasks: TaskMessage[] = [testTask, { ...testTask, id: 'task-002' }];
    await publisher.publishBatch(tasks);
    expect(mocks.mockChannel.publish).toHaveBeenCalledTimes(2);
  });

  it('should ensure a queue with dead-letter exchange', async () => {
    await publisher.connect();
    await publisher.ensureQueue('tenant-001', 'reports', 'report.*');
    expect(mocks.mockChannel.assertQueue).toHaveBeenCalledTimes(2); // DLQ + main queue
    expect(mocks.mockChannel.bindQueue).toHaveBeenCalledTimes(2); // DLQ binding + main binding
  });

  it('should throw when ensuring queue without connection', async () => {
    await expect(publisher.ensureQueue('t1', 'q1', 'r1')).rejects.toThrow(
      'RabbitMQPublisher is not connected'
    );
  });
});

describe('RabbitMQSubscriber', () => {
  let subscriber: RabbitMQSubscriber;

  beforeEach(() => {
    vi.clearAllMocks();
    subscriber = new RabbitMQSubscriber({
      url: 'amqp://localhost:5672',
      exchange: 'proctira.tasks',
    });
  });

  it('should not be connected initially', () => {
    expect(subscriber.isConnected()).toBe(false);
    expect(subscriber.isConsuming()).toBe(false);
  });

  it('should connect successfully', async () => {
    await subscriber.connect();
    expect(subscriber.isConnected()).toBe(true);
  });

  it('should set prefetch on connect', async () => {
    await subscriber.connect();
    expect(mocks.mockChannel.prefetch).toHaveBeenCalledWith(10);
  });

  it('should disconnect successfully', async () => {
    await subscriber.connect();
    await subscriber.disconnect();
    expect(subscriber.isConnected()).toBe(false);
  });

  it('should throw when subscribing without connection', async () => {
    await expect(
      subscriber.subscribe({
        tenantId: 'tenant-001',
        queueName: 'reports',
        routingPattern: 'report.*',
        handler: async () => {},
      })
    ).rejects.toThrow('RabbitMQSubscriber is not connected');
  });

  it('should subscribe to a queue', async () => {
    await subscriber.connect();
    await subscriber.subscribe({
      tenantId: 'tenant-001',
      queueName: 'reports',
      routingPattern: 'report.*',
      handler: async () => {},
    });
    expect(subscriber.isConsuming()).toBe(true);
    expect(mocks.mockChannel.consume).toHaveBeenCalledWith(
      'tenant.tenant-001.reports',
      expect.any(Function)
    );
  });

  it('should set up dead-letter queue on subscribe', async () => {
    await subscriber.connect();
    await subscriber.subscribe({
      tenantId: 'tenant-001',
      queueName: 'reports',
      routingPattern: 'report.*',
      handler: async () => {},
    });
    // DLQ + main queue
    expect(mocks.mockChannel.assertQueue).toHaveBeenCalledTimes(2);
    // DLQ should be named with .dlq suffix
    expect(mocks.mockChannel.assertQueue).toHaveBeenCalledWith(
      'tenant.tenant-001.reports.dlq',
      expect.objectContaining({ durable: true })
    );
  });

  it('should acknowledge successful messages', async () => {
    // Capture the message handler
    let messageHandler: ((msg: unknown) => Promise<void>) | undefined;
    mocks.mockChannel.consume.mockImplementation(async (_queue: string, handler: (msg: unknown) => Promise<void>) => {
      messageHandler = handler;
      return { consumerTag: 'tag-1' };
    });

    await subscriber.connect();
    await subscriber.subscribe({
      tenantId: 'tenant-001',
      queueName: 'reports',
      routingPattern: 'report.*',
      handler: async () => {
        // Successful processing
      },
    });

    // Simulate receiving a message
    const mockMsg = {
      content: Buffer.from(
        JSON.stringify({
          id: 'task-001',
          tenantId: 'tenant-001',
          type: 'report.generate',
          payload: {},
          options: { priority: 5, delay: 0, maxRetries: 3, retryCount: 0 },
        })
      ),
      fields: { routingKey: 'tenant.tenant-001.report.generate' },
      properties: { headers: {} },
    };

    await messageHandler!(mockMsg);
    expect(mocks.mockChannel.ack).toHaveBeenCalledWith(mockMsg);
  });

  it('should nack messages that exceed max retries', async () => {
    let messageHandler: ((msg: unknown) => Promise<void>) | undefined;
    mocks.mockChannel.consume.mockImplementation(async (_queue: string, handler: (msg: unknown) => Promise<void>) => {
      messageHandler = handler;
      return { consumerTag: 'tag-1' };
    });

    await subscriber.connect();
    await subscriber.subscribe({
      tenantId: 'tenant-001',
      queueName: 'reports',
      routingPattern: 'report.*',
      handler: async () => {
        throw new Error('Processing failed');
      },
    });

    // Message at max retries
    const mockMsg = {
      content: Buffer.from(
        JSON.stringify({
          id: 'task-001',
          tenantId: 'tenant-001',
          type: 'report.generate',
          payload: {},
          options: { priority: 5, delay: 0, maxRetries: 3, retryCount: 3 },
        })
      ),
      fields: { routingKey: 'tenant.tenant-001.report.generate' },
      properties: { headers: {} },
    };

    await messageHandler!(mockMsg);
    // Should nack (send to DLQ) since retryCount >= maxRetries
    expect(mocks.mockChannel.nack).toHaveBeenCalledWith(mockMsg, false, false);
  });

  it('should retry messages that have not exceeded max retries', async () => {
    let messageHandler: ((msg: unknown) => Promise<void>) | undefined;
    mocks.mockChannel.consume.mockImplementation(async (_queue: string, handler: (msg: unknown) => Promise<void>) => {
      messageHandler = handler;
      return { consumerTag: 'tag-1' };
    });

    await subscriber.connect();
    await subscriber.subscribe({
      tenantId: 'tenant-001',
      queueName: 'reports',
      routingPattern: 'report.*',
      handler: async () => {
        throw new Error('Processing failed');
      },
    });

    // Message with retries remaining
    const mockMsg = {
      content: Buffer.from(
        JSON.stringify({
          id: 'task-001',
          tenantId: 'tenant-001',
          type: 'report.generate',
          payload: {},
          options: { priority: 5, delay: 0, maxRetries: 3, retryCount: 1 },
        })
      ),
      fields: { routingKey: 'tenant.tenant-001.report.generate' },
      properties: { headers: {} },
    };

    await messageHandler!(mockMsg);
    // Should ack original and republish with incremented retry count
    expect(mocks.mockChannel.ack).toHaveBeenCalledWith(mockMsg);
    expect(mocks.mockChannel.publish).toHaveBeenCalled();
  });

  it('should cancel consumers on disconnect', async () => {
    await subscriber.connect();
    await subscriber.subscribe({
      tenantId: 'tenant-001',
      queueName: 'reports',
      routingPattern: 'report.*',
      handler: async () => {},
    });
    await subscriber.disconnect();
    expect(mocks.mockChannel.cancel).toHaveBeenCalledWith('tag-1');
  });
});
