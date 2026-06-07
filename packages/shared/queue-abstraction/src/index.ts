/**
 * @proctira/queue-abstraction - Unified queue adapter layer.
 *
 * Provides a single QueueAdapter interface that abstracts over
 * Kafka, RabbitMQ, and AWS SQS backends. The adapter is selected
 * at install-time via configuration, allowing services to use
 * queue operations without coupling to a specific backend.
 *
 * Features:
 * - Unified publish/subscribe/dispatch/consume interface
 * - Tenant-prefixed topic/queue naming convention
 * - Health check support for all backends
 * - Factory pattern for configuration-driven adapter selection
 * - Environment variable-based configuration
 */

// Core types and interface
export type {
  QueueAdapter,
  QueueMessage,
  QueueMessageMetadata,
  PublishOptions,
  SubscribeOptions,
  MessageHandler,
  HealthCheckResult,
  QueueAdapterConfig,
  KafkaAdapterConfig,
  RabbitMQAdapterConfig,
  SQSAdapterConfig,
} from './types';

export { buildTenantName } from './types';

// Adapter implementations
export { KafkaAdapter } from './adapters/kafka-adapter';
export { RabbitMQAdapter } from './adapters/rabbitmq-adapter';
export { SQSAdapter } from './adapters/sqs-adapter';

// Factory
export { createQueueAdapter, createQueueAdapterFromEnv } from './factory';
