/**
 * Core event and task queue type definitions for the ProctiraERP platform.
 * Used by both Kafka (domain events) and RabbitMQ (task queues).
 */

/**
 * Metadata attached to every domain event for tracing and auditing.
 */
export interface EventMetadata {
  /** ISO timestamp when the event was created */
  timestamp: string;
  /** Correlation ID for tracing a request across services */
  correlationId: string;
  /** ID of the event that caused this event (causal chain) */
  causationId: string;
  /** ID of the user who triggered the action */
  userId: string;
}

/**
 * A domain event published to Kafka for cross-service communication.
 * All events are tenant-scoped and carry aggregate context.
 */
export interface DomainEvent<T = unknown> {
  /** Unique event identifier (UUID) */
  id: string;
  /** Tenant that owns this event */
  tenantId: string;
  /** Event type (e.g., 'student.enrolled', 'institution.created') */
  type: string;
  /** ID of the aggregate root that produced this event */
  aggregateId: string;
  /** Type of the aggregate (e.g., 'student', 'institution', 'workflow') */
  aggregateType: string;
  /** Event payload — domain-specific data */
  payload: T;
  /** Tracing and audit metadata */
  metadata: EventMetadata;
}

/**
 * Options controlling task execution behavior in RabbitMQ queues.
 */
export interface TaskOptions {
  /** Priority level (1 = lowest, 10 = highest) */
  priority: number;
  /** Delay in milliseconds before the task becomes available for processing */
  delay: number;
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Current retry count (incremented on each failure) */
  retryCount: number;
}

/**
 * A task message published to RabbitMQ for work distribution.
 * Tasks are tenant-scoped and carry execution options.
 */
export interface TaskMessage<T = unknown> {
  /** Unique task identifier (UUID) */
  id: string;
  /** Tenant that owns this task */
  tenantId: string;
  /** Task type (e.g., 'report.generate', 'import.process') */
  type: string;
  /** Task payload — task-specific data */
  payload: T;
  /** Execution options (priority, delay, retries) */
  options: TaskOptions;
}

/**
 * Handler function for processing domain events from Kafka.
 */
export type EventHandler<T = unknown> = (event: DomainEvent<T>) => Promise<void>;

/**
 * Handler function for processing task messages from RabbitMQ.
 */
export type TaskHandler<T = unknown> = (task: TaskMessage<T>) => Promise<void>;
