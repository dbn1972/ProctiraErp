/**
 * Core types for the Queue Abstraction Layer.
 * Provides a unified interface for queue operations across
 * Kafka, RabbitMQ, and AWS SQS backends.
 */

/**
 * Message envelope for all queue operations.
 * Wraps the payload with routing and metadata information.
 */
export interface QueueMessage<T = unknown> {
  /** Unique message identifier (UUID) */
  id: string;
  /** Tenant that owns this message */
  tenantId: string;
  /** Message type/topic (e.g., 'student.enrolled', 'report.generate') */
  type: string;
  /** Message payload */
  payload: T;
  /** Optional metadata for tracing and routing */
  metadata?: QueueMessageMetadata;
  /** Timestamp when the message was created (ISO string) */
  timestamp: string;
}

/**
 * Metadata attached to queue messages for tracing and routing.
 */
export interface QueueMessageMetadata {
  /** Correlation ID for distributed tracing */
  correlationId?: string;
  /** Causation ID linking to the triggering event */
  causationId?: string;
  /** User ID who triggered the action */
  userId?: string;
  /** Priority level (1-10, higher = more urgent) */
  priority?: number;
  /** Delay in milliseconds before message becomes available */
  delay?: number;
  /** Maximum retry attempts */
  maxRetries?: number;
  /** Current retry count */
  retryCount?: number;
  /** Custom headers */
  headers?: Record<string, string>;
}

/**
 * Options for publishing a message.
 */
export interface PublishOptions {
  /** Override the default topic/queue name */
  topic?: string;
  /** Message priority (1-10) */
  priority?: number;
  /** Delay in milliseconds before delivery */
  delay?: number;
  /** Custom headers to attach */
  headers?: Record<string, string>;
}

/**
 * Options for subscribing to messages.
 */
export interface SubscribeOptions {
  /** Topic or queue pattern to subscribe to */
  topic: string;
  /** Consumer group ID (for load balancing across instances) */
  groupId?: string;
  /** Whether to start from the beginning of the topic */
  fromBeginning?: boolean;
  /** Maximum number of concurrent messages to process */
  concurrency?: number;
  /** Whether to automatically acknowledge messages on successful processing */
  autoAck?: boolean;
}

/**
 * Handler function for processing received messages.
 */
export type MessageHandler<T = unknown> = (message: QueueMessage<T>) => Promise<void>;

/**
 * Result of a health check operation.
 */
export interface HealthCheckResult {
  /** Whether the queue backend is healthy */
  healthy: boolean;
  /** Backend type identifier */
  backend: string;
  /** Optional latency in milliseconds */
  latencyMs?: number;
  /** Optional error message if unhealthy */
  error?: string;
}

/**
 * Configuration for the queue adapter factory.
 */
export interface QueueAdapterConfig {
  /** Which queue backend to use */
  backend: 'kafka' | 'rabbitmq' | 'sqs';
  /** Kafka-specific configuration */
  kafka?: KafkaAdapterConfig;
  /** RabbitMQ-specific configuration */
  rabbitmq?: RabbitMQAdapterConfig;
  /** SQS-specific configuration */
  sqs?: SQSAdapterConfig;
}

/**
 * Kafka adapter configuration.
 */
export interface KafkaAdapterConfig {
  /** Kafka broker addresses */
  brokers: string[];
  /** Client ID for this application instance */
  clientId: string;
  /** Consumer group ID */
  groupId?: string;
  /** Connection timeout in milliseconds */
  connectionTimeout?: number;
  /** Request timeout in milliseconds */
  requestTimeout?: number;
  /** Number of retries for failed operations */
  retries?: number;
  /** SSL configuration */
  ssl?: boolean;
  /** SASL authentication */
  sasl?: {
    mechanism: 'plain' | 'scram-sha-256' | 'scram-sha-512';
    username: string;
    password: string;
  };
}

/**
 * RabbitMQ adapter configuration.
 */
export interface RabbitMQAdapterConfig {
  /** RabbitMQ connection URL */
  url: string;
  /** Exchange name */
  exchange: string;
  /** Exchange type */
  exchangeType?: 'direct' | 'topic' | 'fanout' | 'headers';
  /** Dead-letter exchange name */
  deadLetterExchange?: string;
  /** Prefetch count for consumers */
  prefetchCount?: number;
  /** Whether exchanges/queues should be durable */
  durable?: boolean;
  /** Heartbeat interval in seconds */
  heartbeat?: number;
}

/**
 * AWS SQS adapter configuration.
 */
export interface SQSAdapterConfig {
  /** AWS region */
  region: string;
  /** SQS queue URL prefix (messages will be routed to tenant-prefixed queues) */
  queueUrlPrefix: string;
  /** AWS access key ID (optional, uses default credential chain if not provided) */
  accessKeyId?: string;
  /** AWS secret access key */
  secretAccessKey?: string;
  /** Custom endpoint URL (for LocalStack or testing) */
  endpoint?: string;
  /** Maximum number of messages to receive in a single poll */
  maxNumberOfMessages?: number;
  /** Wait time in seconds for long polling */
  waitTimeSeconds?: number;
  /** Visibility timeout in seconds */
  visibilityTimeout?: number;
}

/**
 * The unified Queue Adapter interface.
 * All queue backends implement this interface to provide
 * consistent behavior regardless of the underlying technology.
 */
export interface QueueAdapter {
  /**
   * Connect to the queue backend.
   * Must be called before any other operations.
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the queue backend.
   * Cleans up connections and resources.
   */
  disconnect(): Promise<void>;

  /**
   * Publish a message to a tenant-prefixed topic/queue.
   * Used for event broadcasting (fan-out pattern).
   *
   * @param message - The message to publish
   * @param options - Optional publish configuration
   */
  publish(message: QueueMessage, options?: PublishOptions): Promise<void>;

  /**
   * Subscribe to messages on a topic/queue pattern.
   * Registers a handler that will be called for each received message.
   *
   * @param options - Subscription configuration
   * @param handler - Function to process received messages
   */
  subscribe(options: SubscribeOptions, handler: MessageHandler): Promise<void>;

  /**
   * Dispatch a task message to a specific work queue.
   * Used for point-to-point task distribution (competing consumers).
   *
   * @param message - The task message to dispatch
   * @param options - Optional publish configuration
   */
  dispatch(message: QueueMessage, options?: PublishOptions): Promise<void>;

  /**
   * Consume task messages from a work queue.
   * Similar to subscribe but for competing consumer pattern.
   *
   * @param options - Consumption configuration
   * @param handler - Function to process received tasks
   */
  consume(options: SubscribeOptions, handler: MessageHandler): Promise<void>;

  /**
   * Check the health of the queue backend connection.
   *
   * @returns Health check result with status and latency
   */
  healthCheck(): Promise<HealthCheckResult>;

  /**
   * Check if the adapter is currently connected.
   */
  isConnected(): boolean;
}

/**
 * Builds a tenant-prefixed topic/queue name.
 * Format: tenant.{tenantId}.{name}
 *
 * @param tenantId - The tenant identifier
 * @param name - The base topic/queue name
 * @returns The tenant-prefixed name
 */
export function buildTenantName(tenantId: string, name: string): string {
  return `tenant.${tenantId}.${name}`;
}
