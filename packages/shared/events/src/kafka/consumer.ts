/**
 * Kafka event consumer with tenant-prefixed topics and group management.
 * Wraps kafkajs consumer for subscribing to domain events.
 */

import type { Consumer, EachMessagePayload, SASLOptions } from 'kafkajs';
import { Kafka } from 'kafkajs';

import type { DomainEvent, EventHandler } from '../types';

import type { KafkaConfig} from './config';
import { DEFAULT_KAFKA_CONFIG, buildTenantTopic } from './config';

export interface ConsumerSubscription {
  /** Tenant ID to scope the subscription */
  tenantId: string;
  /** Aggregate type to subscribe to (becomes part of the topic name) */
  aggregateType: string;
  /** Handler function to process received events */
  handler: EventHandler;
  /** Optional: only process events of this specific type */
  eventType?: string;
}

export class KafkaEventConsumer {
  private kafka: Kafka;
  private consumer: Consumer;
  private connected = false;
  private running = false;
  private subscriptions: ConsumerSubscription[] = [];
  private handlerMap: Map<string, EventHandler[]> = new Map();

  constructor(config: KafkaConfig) {
    const mergedConfig = { ...DEFAULT_KAFKA_CONFIG, ...config };

    if (!mergedConfig.groupId) {
      throw new Error('KafkaEventConsumer requires a groupId in config.');
    }

    this.kafka = new Kafka({
      clientId: mergedConfig.clientId,
      brokers: mergedConfig.brokers,
      connectionTimeout: mergedConfig.connectionTimeout,
      requestTimeout: mergedConfig.requestTimeout,
      retry: { retries: mergedConfig.retries ?? 5 },
      ssl: mergedConfig.ssl ? true : undefined,
      sasl: mergedConfig.sasl as SASLOptions | undefined,
    });

    this.consumer = this.kafka.consumer({ groupId: mergedConfig.groupId });
  }

  /**
   * Connect the consumer to the Kafka cluster.
   */
  async connect(): Promise<void> {
    if (this.connected) return;
    await this.consumer.connect();
    this.connected = true;
  }

  /**
   * Disconnect the consumer from the Kafka cluster.
   */
  async disconnect(): Promise<void> {
    if (this.running) {
      await this.consumer.stop();
      this.running = false;
    }
    if (!this.connected) return;
    await this.consumer.disconnect();
    this.connected = false;
  }

  /**
   * Subscribe to domain events for a specific tenant and aggregate type.
   * Must be called before start().
   */
  async subscribe(subscription: ConsumerSubscription): Promise<void> {
    if (!this.connected) {
      throw new Error('KafkaEventConsumer is not connected. Call connect() first.');
    }

    const topic = buildTenantTopic(subscription.tenantId, subscription.aggregateType);

    await this.consumer.subscribe({ topic, fromBeginning: false });

    this.subscriptions.push(subscription);

    // Register handler in the map
    const key = subscription.eventType
      ? `${topic}:${subscription.eventType}`
      : topic;

    const existing = this.handlerMap.get(key) ?? [];
    existing.push(subscription.handler);
    this.handlerMap.set(key, existing);
  }

  /**
   * Start consuming messages. Dispatches to registered handlers.
   */
  async start(): Promise<void> {
    if (!this.connected) {
      throw new Error('KafkaEventConsumer is not connected. Call connect() first.');
    }
    if (this.running) return;

    await this.consumer.run({
      eachMessage: async (payload: EachMessagePayload) => {
        await this.handleMessage(payload);
      },
    });

    this.running = true;
  }

  /**
   * Internal message handler that dispatches to registered event handlers.
   */
  private async handleMessage(payload: EachMessagePayload): Promise<void> {
    const { topic, message } = payload;

    if (!message.value) return;

    const event = JSON.parse(message.value.toString()) as DomainEvent;

    // Try specific event type handlers first
    const specificKey = `${topic}:${event.type}`;
    const specificHandlers = this.handlerMap.get(specificKey) ?? [];
    for (const handler of specificHandlers) {
      await handler(event);
    }

    // Then try topic-level handlers (no event type filter)
    const topicHandlers = this.handlerMap.get(topic) ?? [];
    for (const handler of topicHandlers) {
      await handler(event);
    }
  }

  /**
   * Check if the consumer is currently connected.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Check if the consumer is currently running (processing messages).
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get the list of active subscriptions.
   */
  getSubscriptions(): ConsumerSubscription[] {
    return [...this.subscriptions];
  }
}
