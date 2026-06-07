/**
 * @proctira/events - Event streaming and task queue infrastructure.
 *
 * Provides:
 * - Kafka producer/consumer for domain events (pub/sub)
 * - RabbitMQ publisher/subscriber for task queues (work distribution)
 * - Tenant-prefixed topics and queues for multi-tenant isolation
 */

// Core types
export type {
  DomainEvent,
  EventMetadata,
  TaskMessage,
  TaskOptions,
  EventHandler,
  TaskHandler,
} from './types';

// Kafka
export { KafkaEventProducer } from './kafka/producer';
export { KafkaEventConsumer } from './kafka/consumer';
export type { ConsumerSubscription } from './kafka/consumer';
export { buildTenantTopic, DEFAULT_KAFKA_CONFIG } from './kafka/config';
export type { KafkaConfig } from './kafka/config';

// RabbitMQ
export { RabbitMQPublisher } from './rabbitmq/publisher';
export { RabbitMQSubscriber } from './rabbitmq/subscriber';
export type { SubscriberOptions } from './rabbitmq/subscriber';
export { buildTenantQueue, buildTenantRoutingKey, DEFAULT_RABBITMQ_CONFIG } from './rabbitmq/config';
export type { RabbitMQConfig } from './rabbitmq/config';
