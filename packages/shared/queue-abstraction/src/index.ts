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

/** Well-known job type for examination document generation workers (P0-06). */
export const EXAM_DOCUMENT_JOB_TYPE = 'exam.document.generate';

/** Consumer binding pattern for all tenants' exam document jobs. */
export const EXAM_DOCUMENT_CONSUME_TOPIC = 'tenant.*.exam.document.generate';

/** Well-known job type for workflow timeout escalations (P1-WF). */
export const WORKFLOW_ESCALATION_JOB_TYPE = 'workflow.escalation';

/** Consumer binding pattern for all tenants' workflow escalation jobs. */
export const WORKFLOW_ESCALATION_CONSUME_TOPIC = 'tenant.*.workflow.escalation';

/** Optional side-channel when an escalation transition notifies a role. */
export const WORKFLOW_ESCALATION_NOTIFY_TYPE = 'workflow.escalation.notified';

/** Well-known job type for notification delivery / retry workers (W2-JOB-01). */
export const NOTIFICATION_DELIVERY_JOB_TYPE = 'notification.delivery';

/** Consumer binding pattern for all tenants' notification delivery jobs. */
export const NOTIFICATION_DELIVERY_CONSUME_TOPIC = 'tenant.*.notification.delivery';

/** Well-known job type for assessment report-card generation workers (W2-JOB-02). */
export const REPORT_CARD_JOB_TYPE = 'report-card.generate';

/** Consumer binding pattern for all tenants' report-card generation jobs. */
export const REPORT_CARD_CONSUME_TOPIC = 'tenant.*.report-card.generate';

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
