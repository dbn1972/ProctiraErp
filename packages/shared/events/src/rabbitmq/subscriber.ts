/**
 * RabbitMQ subscriber with acknowledgment and retry support.
 * Used for consuming task messages from work queues.
 */

import type { ChannelModel, Channel, ConsumeMessage } from 'amqplib';
import amqplib from 'amqplib';

import type { TaskMessage, TaskHandler } from '../types';

import type {
  RabbitMQConfig} from './config';
import {
  DEFAULT_RABBITMQ_CONFIG,
  buildTenantQueue,
  buildTenantRoutingKey,
} from './config';

export interface SubscriberOptions {
  /** Tenant ID for queue scoping */
  tenantId: string;
  /** Queue name (will be prefixed with tenant) */
  queueName: string;
  /** Routing key pattern to bind (e.g., 'report.*') */
  routingPattern: string;
  /** Handler function to process received tasks */
  handler: TaskHandler;
  /** Whether to automatically retry failed messages (default: true) */
  autoRetry?: boolean;
}

export class RabbitMQSubscriber {
  private config: Required<
    Pick<RabbitMQConfig, 'url' | 'exchange' | 'exchangeType' | 'deadLetterExchange' | 'prefetchCount' | 'durable' | 'heartbeat'>
  > &
    RabbitMQConfig;
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private connected = false;
  private consuming = false;
  private consumerTags: string[] = [];

  constructor(config: RabbitMQConfig) {
    this.config = { ...DEFAULT_RABBITMQ_CONFIG, ...config } as typeof this.config;
  }

  /**
   * Connect to RabbitMQ.
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    this.connection = await amqplib.connect(this.config.url, {
      heartbeat: this.config.heartbeat,
    });

    this.channel = await this.connection.createChannel();
    await this.channel.prefetch(this.config.prefetchCount ?? 10);

    // Assert exchanges
    await this.channel.assertExchange(
      this.config.exchange,
      this.config.exchangeType ?? 'topic',
      { durable: this.config.durable }
    );

    if (this.config.deadLetterExchange) {
      await this.channel.assertExchange(
        this.config.deadLetterExchange,
        'topic',
        { durable: this.config.durable }
      );
    }

    this.connected = true;
  }

  /**
   * Disconnect from RabbitMQ.
   */
  async disconnect(): Promise<void> {
    if (!this.connected) return;

    // Cancel all consumers
    if (this.channel) {
      for (const tag of this.consumerTags) {
        await this.channel.cancel(tag);
      }
      this.consumerTags = [];
      await this.channel.close();
      this.channel = null;
    }

    if (this.connection) {
      await this.connection.close();
      this.connection = null;
    }

    this.connected = false;
    this.consuming = false;
  }

  /**
   * Subscribe to a task queue and start processing messages.
   * Sets up the queue with dead-letter exchange binding and starts consuming.
   *
   * @param options - Subscription configuration
   */
  async subscribe(options: SubscriberOptions): Promise<void> {
    if (!this.connected || !this.channel) {
      throw new Error('RabbitMQSubscriber is not connected. Call connect() first.');
    }

    const { tenantId, queueName, routingPattern, handler, autoRetry = true } = options;

    const fullQueueName = buildTenantQueue(tenantId, queueName);
    const dlqName = `${fullQueueName}.dlq`;
    const routingKey = buildTenantRoutingKey(tenantId, routingPattern);

    // Assert dead-letter queue
    if (this.config.deadLetterExchange) {
      await this.channel.assertQueue(dlqName, {
        durable: this.config.durable,
      });
      await this.channel.bindQueue(
        dlqName,
        this.config.deadLetterExchange,
        routingKey
      );
    }

    // Assert main queue with dead-letter exchange
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

    // Start consuming
    const channel = this.channel;
    const { consumerTag } = await channel.consume(
      fullQueueName,
      (msg: ConsumeMessage | null) => {
        if (!msg) return;

        void (async () => {
          try {
            const task: TaskMessage = JSON.parse(msg.content.toString()) as TaskMessage;
            await handler(task);
            channel.ack(msg);
          } catch {
            await this.handleFailure(msg, channel, autoRetry);
          }
        })();
      }
    );

    this.consumerTags.push(consumerTag);
    this.consuming = true;
  }

  /**
   * Handle a failed message: retry or send to dead-letter queue.
   */
  private async handleFailure(
    msg: ConsumeMessage,
    channel: Channel,
    autoRetry: boolean
  ): Promise<void> {
    if (!autoRetry) {
      // No retry — reject and send to DLQ
      channel.nack(msg, false, false);
      return;
    }

    // Parse the task to check retry count
    try {
      const task = JSON.parse(msg.content.toString()) as TaskMessage;
      const retryCount = task.options.retryCount;
      const maxRetries = task.options.maxRetries;

      if (retryCount < maxRetries) {
        // Increment retry count and republish
        task.options.retryCount = retryCount + 1;

        // Calculate exponential backoff delay
        const backoffDelay = Math.min(
          1000 * Math.pow(2, task.options.retryCount),
          60000 // Max 60 seconds
        );
        task.options.delay = backoffDelay;

        // Acknowledge original message
        channel.ack(msg);

        // Republish with updated retry count and delay
        const routingKey = msg.fields.routingKey;
        channel.publish(
          this.config.exchange,
          routingKey,
          Buffer.from(JSON.stringify(task)),
          {
            persistent: true,
            priority: task.options.priority,
            headers: {
              ...(msg.properties.headers as Record<string, unknown>),
              'x-retry-count': task.options.retryCount,
              'x-delay': backoffDelay,
            },
            expiration: String(backoffDelay),
            messageId: task.id,
            contentType: 'application/json',
          }
        );
      } else {
        // Max retries exceeded — send to DLQ
        channel.nack(msg, false, false);
      }
    } catch {
      // Can't parse message — send to DLQ
      channel.nack(msg, false, false);
    }
  }

  /**
   * Check if the subscriber is currently connected.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Check if the subscriber is currently consuming messages.
   */
  isConsuming(): boolean {
    return this.consuming;
  }
}
