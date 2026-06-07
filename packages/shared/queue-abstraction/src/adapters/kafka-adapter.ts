/**
 * Kafka implementation of the QueueAdapter interface.
 * Maps publish/subscribe to Kafka producer/consumer operations
 * with tenant-prefixed topic naming.
 */

import type { Producer, Consumer, EachMessagePayload, SASLOptions } from 'kafkajs';
import { Kafka } from 'kafkajs';

import type {
  QueueAdapter,
  QueueMessage,
  PublishOptions,
  SubscribeOptions,
  MessageHandler,
  HealthCheckResult,
  KafkaAdapterConfig,
} from '../types';
import { buildTenantName } from '../types';

const DEFAULT_CONFIG: Partial<KafkaAdapterConfig> = {
  connectionTimeout: 10000,
  requestTimeout: 30000,
  retries: 5,
  ssl: false,
};

export class KafkaAdapter implements QueueAdapter {
  private kafka: Kafka;
  private producer: Producer | null = null;
  private consumers: Consumer[] = [];
  private config: KafkaAdapterConfig;
  private connected = false;

  constructor(config: KafkaAdapterConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.kafka = new Kafka({
      clientId: this.config.clientId,
      brokers: this.config.brokers,
      connectionTimeout: this.config.connectionTimeout,
      requestTimeout: this.config.requestTimeout,
      retry: { retries: this.config.retries ?? 5 },
      ssl: this.config.ssl ? true : undefined,
      sasl: this.config.sasl as SASLOptions | undefined,
    });
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    this.producer = this.kafka.producer();
    await this.producer.connect();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;

    for (const consumer of this.consumers) {
      await consumer.disconnect();
    }
    this.consumers = [];

    if (this.producer) {
      await this.producer.disconnect();
      this.producer = null;
    }

    this.connected = false;
  }

  async publish(message: QueueMessage, options?: PublishOptions): Promise<void> {
    if (!this.connected || !this.producer) {
      throw new Error('KafkaAdapter is not connected. Call connect() first.');
    }

    const topic = options?.topic
      ? buildTenantName(message.tenantId, options.topic)
      : buildTenantName(message.tenantId, message.type);

    await this.producer.send({
      topic,
      messages: [
        {
          key: message.id,
          value: JSON.stringify(message),
          headers: {
            'message-type': message.type,
            'tenant-id': message.tenantId,
            'correlation-id': message.metadata?.correlationId ?? '',
            ...this.serializeHeaders(options?.headers),
          },
        },
      ],
    });
  }

  async subscribe(options: SubscribeOptions, handler: MessageHandler): Promise<void> {
    if (!this.connected) {
      throw new Error('KafkaAdapter is not connected. Call connect() first.');
    }

    const groupId = options.groupId ?? this.config.groupId ?? `${this.config.clientId}-group`;
    const consumer = this.kafka.consumer({ groupId });
    await consumer.connect();

    // Subscribe to the topic (already tenant-prefixed by caller or raw)
    const topic = options.topic;
    await consumer.subscribe({
      topic,
      fromBeginning: options.fromBeginning ?? false,
    });

    await consumer.run({
      eachMessage: async (payload: EachMessagePayload) => {
        if (!payload.message.value) return;

        const message = JSON.parse(
          payload.message.value.toString()
        ) as QueueMessage;

        await handler(message);
      },
    });

    this.consumers.push(consumer);
  }

  async dispatch(message: QueueMessage, options?: PublishOptions): Promise<void> {
    // In Kafka, dispatch and publish are the same operation.
    // The competing consumer pattern is achieved via consumer groups.
    await this.publish(message, options);
  }

  async consume(options: SubscribeOptions, handler: MessageHandler): Promise<void> {
    // In Kafka, consume and subscribe are the same operation.
    // Competing consumers are achieved via consumer groups with the same groupId.
    await this.subscribe(options, handler);
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now();

    try {
      const admin = this.kafka.admin();
      await admin.connect();
      await admin.listTopics();
      await admin.disconnect();

      return {
        healthy: true,
        backend: 'kafka',
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      return {
        healthy: false,
        backend: 'kafka',
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  private serializeHeaders(
    headers?: Record<string, string>
  ): Record<string, string> | undefined {
    if (!headers) return undefined;
    return headers;
  }
}
