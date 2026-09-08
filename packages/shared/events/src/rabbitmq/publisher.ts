/**
 * RabbitMQ publisher with dead-letter exchange support.
 * Used for publishing task messages to work queues.
 */

import type { ChannelModel, Channel, Options } from 'amqplib';
import amqplib from 'amqplib';

import type { TaskMessage } from '../types';

import type { RabbitMQConfig } from './config';
import { DEFAULT_RABBITMQ_CONFIG, buildTenantRoutingKey } from './config';

export class RabbitMQPublisher {
  private config: Required<
    Pick<
      RabbitMQConfig,
      'url' | 'exchange' | 'exchangeType' | 'deadLetterExchange' | 'durable' | 'heartbeat'
    >
  > &
    RabbitMQConfig;
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private connected = false;

  constructor(config: RabbitMQConfig) {
    this.config = { ...DEFAULT_RABBITMQ_CONFIG, ...config } as typeof this.config;
  }

  /**
   * Connect to RabbitMQ and set up exchanges.
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    this.connection = await amqplib.connect(this.config.url, {
      heartbeat: this.config.heartbeat,
    });

    this.channel = await this.connection.createChannel();

    // Assert the main exchange
    await this.channel.assertExchange(this.config.exchange, this.config.exchangeType ?? 'topic', {
      durable: this.config.durable,
    });

    // Assert the dead-letter exchange
    if (this.config.deadLetterExchange) {
      await this.channel.assertExchange(this.config.deadLetterExchange, 'topic', {
        durable: this.config.durable,
      });
    }

    this.connected = true;
  }

  /**
   * Disconnect from RabbitMQ.
   */
  async disconnect(): Promise<void> {
    if (!this.connected) return;

    if (this.channel) {
      await this.channel.close();
      this.channel = null;
    }
    if (this.connection) {
      await this.connection.close();
      this.connection = null;
    }

    this.connected = false;
  }

  /**
   * Publish a task message to a tenant-prefixed routing key.
   * Routing key format: tenant.{tenantId}.{task.type}
   *
   * @param task - The task message to publish
   */
  async publish(task: TaskMessage): Promise<void> {
    if (!this.connected || !this.channel) {
      throw new Error('RabbitMQPublisher is not connected. Call connect() first.');
    }

    const routingKey = buildTenantRoutingKey(task.tenantId, task.type);

    const publishOptions: Options.Publish = {
      persistent: true,
      priority: task.options.priority,
      headers: {
        'x-tenant-id': task.tenantId,
        'x-task-type': task.type,
        'x-max-retries': task.options.maxRetries,
        'x-retry-count': task.options.retryCount,
      },
      messageId: task.id,
      contentType: 'application/json',
    };

    // If delay is specified, use the x-delay header (requires rabbitmq_delayed_message_exchange plugin)
    // or publish to a delay queue with TTL
    if (task.options.delay > 0) {
      (publishOptions.headers as Record<string, unknown>)['x-delay'] = task.options.delay;
      publishOptions.expiration = String(task.options.delay);
    }

    this.channel.publish(
      this.config.exchange,
      routingKey,
      Buffer.from(JSON.stringify(task)),
      publishOptions,
    );
  }

  /**
   * Publish multiple task messages in sequence.
   *
   * @param tasks - Array of task messages to publish
   */
  async publishBatch(tasks: TaskMessage[]): Promise<void> {
    for (const task of tasks) {
      await this.publish(task);
    }
  }

  /**
   * Ensure a queue exists with dead-letter exchange binding.
   * Useful for pre-creating queues before subscribers connect.
   *
   * @param tenantId - Tenant ID for queue naming
   * @param queueName - Base queue name
   * @param routingPattern - Routing key pattern to bind (e.g., 'report.*')
   */
  async ensureQueue(tenantId: string, queueName: string, routingPattern: string): Promise<void> {
    if (!this.connected || !this.channel) {
      throw new Error('RabbitMQPublisher is not connected. Call connect() first.');
    }

    const fullQueueName = `tenant.${tenantId}.${queueName}`;
    const dlqName = `${fullQueueName}.dlq`;
    const routingKey = buildTenantRoutingKey(tenantId, routingPattern);

    // Assert dead-letter queue
    if (this.config.deadLetterExchange) {
      await this.channel.assertQueue(dlqName, {
        durable: this.config.durable,
      });
      await this.channel.bindQueue(dlqName, this.config.deadLetterExchange, routingKey);
    }

    // Assert main queue with dead-letter exchange configuration
    await this.channel.assertQueue(fullQueueName, {
      durable: this.config.durable,
      arguments: {
        'x-dead-letter-exchange': this.config.deadLetterExchange ?? '',
        'x-dead-letter-routing-key': routingKey,
        'x-max-priority': 10,
      },
    });

    // Bind queue to exchange
    await this.channel.bindQueue(fullQueueName, this.config.exchange, routingKey);
  }

  /**
   * Check if the publisher is currently connected.
   */
  isConnected(): boolean {
    return this.connected;
  }
}
