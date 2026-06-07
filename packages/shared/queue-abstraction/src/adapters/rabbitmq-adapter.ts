/**
 * RabbitMQ implementation of the QueueAdapter interface.
 * Maps publish/subscribe to RabbitMQ exchanges/queues
 * with tenant-prefixed naming conventions.
 */

import type { ChannelModel, Channel, ConsumeMessage, Options } from 'amqplib';
import amqplib from 'amqplib';

import type {
  QueueAdapter,
  QueueMessage,
  PublishOptions,
  SubscribeOptions,
  MessageHandler,
  HealthCheckResult,
  RabbitMQAdapterConfig,
} from '../types';
import { buildTenantName } from '../types';

const DEFAULT_CONFIG: Partial<RabbitMQAdapterConfig> = {
  exchangeType: 'topic',
  deadLetterExchange: 'dlx',
  prefetchCount: 10,
  durable: true,
  heartbeat: 60,
};

export class RabbitMQAdapter implements QueueAdapter {
  private config: RabbitMQAdapterConfig;
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private connected = false;

  constructor(config: RabbitMQAdapterConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config } as RabbitMQAdapterConfig;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    this.connection = await amqplib.connect(this.config.url, {
      heartbeat: this.config.heartbeat,
    });

    this.channel = await this.connection.createChannel();
    await this.channel.prefetch(this.config.prefetchCount ?? 10);

    // Assert the main exchange
    await this.channel.assertExchange(
      this.config.exchange,
      this.config.exchangeType ?? 'topic',
      { durable: this.config.durable ?? true }
    );

    // Assert the dead-letter exchange
    if (this.config.deadLetterExchange) {
      await this.channel.assertExchange(
        this.config.deadLetterExchange,
        'topic',
        { durable: this.config.durable ?? true }
      );
    }

    this.connected = true;
  }

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

  async publish(message: QueueMessage, options?: PublishOptions): Promise<void> {
    if (!this.connected || !this.channel) {
      throw new Error('RabbitMQAdapter is not connected. Call connect() first.');
    }

    const routingKey = options?.topic
      ? buildTenantName(message.tenantId, options.topic)
      : buildTenantName(message.tenantId, message.type);

    const publishOptions: Options.Publish = {
      persistent: true,
      priority: options?.priority ?? message.metadata?.priority ?? 5,
      headers: {
        'x-tenant-id': message.tenantId,
        'x-message-type': message.type,
        'x-correlation-id': message.metadata?.correlationId ?? '',
        ...(options?.headers ?? {}),
      },
      messageId: message.id,
      contentType: 'application/json',
      timestamp: Date.now(),
    };

    if (options?.delay ?? message.metadata?.delay) {
      const delay = options?.delay ?? message.metadata?.delay ?? 0;
      (publishOptions.headers as Record<string, unknown>)['x-delay'] = delay;
      publishOptions.expiration = String(delay);
    }

    this.channel.publish(
      this.config.exchange,
      routingKey,
      Buffer.from(JSON.stringify(message)),
      publishOptions
    );
  }

  async subscribe(options: SubscribeOptions, handler: MessageHandler): Promise<void> {
    if (!this.connected || !this.channel) {
      throw new Error('RabbitMQAdapter is not connected. Call connect() first.');
    }

    const queueName = buildTenantName(
      options.groupId ?? 'shared',
      `sub.${options.topic}`
    );

    // Assert queue with dead-letter exchange
    await this.channel.assertQueue(queueName, {
      durable: this.config.durable ?? true,
      arguments: {
        'x-dead-letter-exchange': this.config.deadLetterExchange ?? '',
        'x-max-priority': 10,
      },
    });

    // Bind queue to exchange with the topic as routing key pattern
    await this.channel.bindQueue(
      queueName,
      this.config.exchange,
      options.topic
    );

    const channel = this.channel;
    const autoAck = options.autoAck ?? false;

    await channel.consume(
      queueName,
      (msg: ConsumeMessage | null) => {
        if (!msg) return;

        void (async () => {
          try {
            const message = JSON.parse(
              msg.content.toString()
            ) as QueueMessage;
            await handler(message);
            if (!autoAck) {
              channel.ack(msg);
            }
          } catch {
            channel.nack(msg, false, false);
          }
        })();
      },
      { noAck: autoAck }
    );
  }

  async dispatch(message: QueueMessage, options?: PublishOptions): Promise<void> {
    // Dispatch uses the same publish mechanism in RabbitMQ.
    // The competing consumer pattern is achieved by multiple consumers
    // on the same queue (via consume with the same groupId/queue name).
    await this.publish(message, options);
  }

  async consume(options: SubscribeOptions, handler: MessageHandler): Promise<void> {
    if (!this.connected || !this.channel) {
      throw new Error('RabbitMQAdapter is not connected. Call connect() first.');
    }

    // For consume (competing consumers), use a shared queue name
    const queueName = buildTenantName(
      options.groupId ?? 'workers',
      `task.${options.topic}`
    );

    // Assert queue with dead-letter exchange
    await this.channel.assertQueue(queueName, {
      durable: this.config.durable ?? true,
      arguments: {
        'x-dead-letter-exchange': this.config.deadLetterExchange ?? '',
        'x-max-priority': 10,
      },
    });

    // Bind queue to exchange
    await this.channel.bindQueue(
      queueName,
      this.config.exchange,
      options.topic
    );

    const channel = this.channel;
    const autoAck = options.autoAck ?? false;

    await channel.consume(
      queueName,
      (msg: ConsumeMessage | null) => {
        if (!msg) return;

        void (async () => {
          try {
            const message = JSON.parse(
              msg.content.toString()
            ) as QueueMessage;
            await handler(message);
            if (!autoAck) {
              channel.ack(msg);
            }
          } catch {
            channel.nack(msg, false, false);
          }
        })();
      },
      { noAck: autoAck }
    );
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now();

    try {
      if (!this.connected || !this.channel) {
        return {
          healthy: false,
          backend: 'rabbitmq',
          latencyMs: Date.now() - start,
          error: 'Not connected',
        };
      }

      // Check connection by asserting a temporary queue
      await this.channel.checkExchange(this.config.exchange);

      return {
        healthy: true,
        backend: 'rabbitmq',
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      return {
        healthy: false,
        backend: 'rabbitmq',
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  isConnected(): boolean {
    return this.connected;
  }
}
