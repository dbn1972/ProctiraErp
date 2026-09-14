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
export {
  InMemoryDurableQueueAdapter,
  InMemoryDurableQueueStore,
  matchRoutingKey,
} from './adapters/in-memory-durable-adapter';
export type {
  DurableQueuedMessage,
  InMemoryDurableQueueAdapterOptions,
} from './adapters/in-memory-durable-adapter';

// Factory
export { createQueueAdapter, createQueueAdapterFromEnv } from './factory';

export {
  EXAM_DOCUMENT_JOB_TYPE,
  EXAM_DOCUMENT_CONSUME_TOPIC,
  WORKFLOW_ESCALATION_JOB_TYPE,
  WORKFLOW_ESCALATION_CONSUME_TOPIC,
  WORKFLOW_ESCALATION_NOTIFY_TYPE,
  NOTIFICATION_DELIVERY_JOB_TYPE,
  NOTIFICATION_DELIVERY_CONSUME_TOPIC,
  REPORT_CARD_JOB_TYPE,
  REPORT_CARD_CONSUME_TOPIC,
  STUDENT_IMPORT_JOB_TYPE,
  STUDENT_IMPORT_CONSUME_TOPIC,
  WEBHOOK_DELIVERY_JOB_TYPE,
  WEBHOOK_DELIVERY_CONSUME_TOPIC,
} from './job-types.js';

// Transactional outbox (W2-JOB-04)
export {
  InMemoryOutboxStore,
  PgOutboxStore,
  OutboxRelay,
  buildExamDocumentOutboxEntry,
  buildWorkflowEscalationOutboxEntry,
} from './outbox';
export type {
  OutboxStore,
  NewOutboxEntry,
  OutboxRecord,
  OutboxStatus,
  OutboxDispatchMode,
  OutboxQueryable,
  OutboxRelayOptions,
  PgOutboxPool,
  ExamDocumentOutboxInput,
  WorkflowEscalationOutboxInput,
} from './outbox';

