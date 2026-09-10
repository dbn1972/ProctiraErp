/**
 * Kafka event producer with tenant-prefixed topics.
 * Wraps kafkajs producer for publishing domain events.
 */

import type { Producer, ProducerRecord, RecordMetadata, SASLOptions } from 'kafkajs';
import { Kafka } from 'kafkajs';

import type { DomainEvent } from '../types';

import type { KafkaConfig } from './config';
import { DEFAULT_KAFKA_CONFIG, buildTenantTopic } from './config';

export class KafkaEventProducer {
  private kafka: Kafka;
  private producer: Producer;
  private connected = false;

  constructor(config: KafkaConfig) {
    const mergedConfig = { ...DEFAULT_KAFKA_CONFIG, ...config };

    this.kafka = new Kafka({
      clientId: mergedConfig.clientId,
      brokers: mergedConfig.brokers,
      connectionTimeout: mergedConfig.connectionTimeout,
      requestTimeout: mergedConfig.requestTimeout,
      retry: { retries: mergedConfig.retries ?? 5 },
      ssl: mergedConfig.ssl ? true : undefined,
      sasl: mergedConfig.sasl as SASLOptions | undefined,
    });

    this.producer = this.kafka.producer();
  }

  /**
   * Connect the producer to the Kafka cluster.
   */
  async connect(): Promise<void> {
    if (this.connected) return;
    await this.producer.connect();
    this.connected = true;
  }

  /**
   * Disconnect the producer from the Kafka cluster.
   */
  async disconnect(): Promise<void> {
    if (!this.connected) return;
    await this.producer.disconnect();
    this.connected = false;
  }

  /**
   * Publish a domain event to a tenant-prefixed Kafka topic.
   * Topic format: tenant.{tenantId}.{event.aggregateType}
   *
   * @param event - The domain event to publish
   * @returns Record metadata from Kafka
   */
  async publish(event: DomainEvent): Promise<RecordMetadata[]> {
    if (!this.connected) {
      throw new Error('KafkaEventProducer is not connected. Call connect() first.');
    }

    const topic = buildTenantTopic(event.tenantId, event.aggregateType);

    const record: ProducerRecord = {
      topic,
      messages: [
        {
          key: event.aggregateId,
          value: JSON.stringify(event),
          headers: {
            'event-type': event.type,
            'tenant-id': event.tenantId,
            'correlation-id': event.metadata.correlationId,
          },
        },
      ],
    };

    return this.producer.send(record);
  }

  /**
   * Publish multiple domain events in a single batch.
   *
   * @param events - Array of domain events to publish
   * @returns Record metadata from Kafka for each event
   */
  async publishBatch(events: DomainEvent[]): Promise<RecordMetadata[]> {
    if (!this.connected) {
      throw new Error('KafkaEventProducer is not connected. Call connect() first.');
    }

    const topicMessages = events.map((event) => ({
      topic: buildTenantTopic(event.tenantId, event.aggregateType),
      messages: [
        {
          key: event.aggregateId,
          value: JSON.stringify(event),
          headers: {
            'event-type': event.type,
            'tenant-id': event.tenantId,
            'correlation-id': event.metadata.correlationId,
          },
        },
      ],
    }));

    return this.producer.sendBatch({ topicMessages });
  }

  /**
   * Check if the producer is currently connected.
   */
  isConnected(): boolean {
    return this.connected;
  }
}
