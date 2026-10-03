/**
 * Kafka implementation of the QueueAdapter interface.
 * Maps publish/subscribe to Kafka producer/consumer operations
 * with tenant-prefixed topic naming.
 */

import type { Producer, Consumer, EachMessagePayload, SASLOptions } from 'kafkajs';
import { Kafka } from 'kafkajs';

import {
  assertTenantScopedSubscribeTopic,
  isProductionEnv,
  messageTenantMatchesRoute,
} from '../tenant-scope';
import type {
  QueueAdapter,
  QueueMessage,
  PublishOptions,
  SubscribeOptions,
  MessageHandler,
  HealthCheckResult,
  KafkaAdapterConfig,
} from '../types';
import { buildTenantName, QueueUnsupportedOperationError, requestedDelayMs } from '../types';

import { DEFAULT_MAX_RETRIES, errorMessage, type QueueConsumerLogger } from './delivery-failure';

export interface KafkaAdapterRuntimeOptions {
  logger?: QueueConsumerLogger;
}

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

  private readonly logger: QueueConsumerLogger | undefined;

  constructor(config: KafkaAdapterConfig, runtime: KafkaAdapterRuntimeOptions = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = runtime.logger;

    // PRC-L356: never ship credentials / tenant payloads over plaintext in production.
    if (isProductionEnv() && !this.config.ssl) {
      throw new Error(
        'KafkaAdapter: ssl must be enabled in production (plaintext' +
          (this.config.sasl?.mechanism === 'plain' ? ' SASL/PLAIN credentials' : '') +
          ' refused; set KAFKA_SSL=true) (PRC-L356)',
      );
    }

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
    // PRC-M360: Kafka has no delayed delivery; never deliver early silently.
    if (requestedDelayMs(message, options) > 0) {
      throw new QueueUnsupportedOperationError(
        'KafkaAdapter does not support delayed delivery; schedule via the outbox (availableAt)',
      );
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

    // W1-SEC-11: reject unscoped caller topics (not convention-only).
    assertTenantScopedSubscribeTopic(options.topic, { surface: 'queue.kafka.subscribe' });

    const groupId = options.groupId ?? this.config.groupId ?? `${this.config.clientId}-group`;
    const consumer = this.kafka.consumer({ groupId });
    await consumer.connect();

    const topic = options.topic;
    await consumer.subscribe({
      topic,
      fromBeginning: options.fromBeginning ?? false,
    });

    await consumer.run({
      eachMessage: async (payload: EachMessagePayload) => {
        if (!payload.message.value) return;
        // PRC-M364: a malformed payload must not wedge the partition - park it
        // on the DLQ topic and let the offset commit.
        let message: QueueMessage;
        try {
          message = JSON.parse(payload.message.value.toString()) as QueueMessage;
        } catch (err: unknown) {
          await this.deadLetter(payload, 'parse-error', err);
          return;
        }
        // PRC-L355: body tenant must match the concrete topic the broker routed on.
        if (!messageTenantMatchesRoute(payload.topic, message)) return;
        await this.handleWithRetry(payload, message, handler);
      },
    });

    this.consumers.push(consumer);
  }

  /**
   * PRC-M364: bounded in-process retry with exponential backoff, then DLQ so a
   * failing message cannot block the partition forever.
   */
  private async handleWithRetry(
    payload: EachMessagePayload,
    message: QueueMessage,
    handler: MessageHandler,
  ): Promise<void> {
    const maxRetries = this.config.maxHandlerRetries ?? DEFAULT_MAX_RETRIES;
    const base = this.config.handlerRetryBackoffMs ?? 200;
    for (let attempt = 0; ; attempt += 1) {
      try {
        await handler(message);
        return;
      } catch (err: unknown) {
        if (attempt >= maxRetries) {
          await this.deadLetter(payload, 'handler-failed', err);
          return;
        }
        this.logger?.warn?.(
          {
            topic: payload.topic,
            messageId: message.id,
            attempt: attempt + 1,
            err: errorMessage(err),
          },
          'kafka handler failed; retrying',
        );
        await new Promise((r) => setTimeout(r, base * 2 ** attempt));
      }
    }
  }

  /** Name of the dead-letter topic for `topic`. */
  deadLetterTopic(topic: string): string {
    return `${topic}${this.config.deadLetterSuffix ?? '.dlq'}`;
  }

  private async deadLetter(
    payload: EachMessagePayload,
    reason: string,
    err: unknown,
  ): Promise<void> {
    if (!this.producer) {
      // Cannot park it: throw so the offset is NOT committed (kafkajs retries).
      throw new Error(`KafkaAdapter: cannot dead-letter (${reason}); producer not connected`);
    }
    const dlq = this.deadLetterTopic(payload.topic);
    await this.producer.send({
      topic: dlq,
      messages: [
        {
          key: payload.message.key ?? null,
          value: payload.message.value,
          headers: {
            ...(payload.message.headers ?? {}),
            'x-dlq-reason': reason,
            'x-dlq-error': errorMessage(err).slice(0, 500),
            'x-dlq-source-topic': payload.topic,
            'x-dlq-source-partition': String(payload.partition),
            'x-dlq-source-offset': String(payload.message.offset),
          },
        },
      ],
    });
    this.logger?.error?.(
      { topic: payload.topic, dlq, reason, offset: payload.message.offset, err: errorMessage(err) },
      'kafka message dead-lettered',
    );
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

  private serializeHeaders(headers?: Record<string, string>): Record<string, string> | undefined {
    if (!headers) return undefined;
    return headers;
  }
}
