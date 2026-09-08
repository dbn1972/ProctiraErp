/**
 * @proctira/backend-etl - ETL Pipeline Service
 *
 * Provides configurable extract-transform-load pipelines with
 * source and destination connection definitions, field mapping,
 * transformation rules, scheduled execution, retry with exponential
 * backoff, structured execution logging, and Kafka event publishing.
 */

// Plugin
export { etlPlugin, type ETLPluginOptions } from './etl-plugin.js';

// Service
export { ETLService, type ETLServiceConfig } from './etl-service.js';

// Repository
export type {
  PipelineRepository,
  PipelineListFilter,
  PipelineListResult,
} from './pipeline-repository.js';
export { InMemoryPipelineRepository } from './in-memory-repository.js';

// Scheduler
export {
  PipelineScheduler,
  type ScheduleEntry,
  type SchedulerConfig,
  normalizeCronExpression,
  isValidCronExpression,
  cronMatchesDate,
  getNextRunTime,
} from './pipeline-scheduler.js';

// Execution Logger
export {
  ExecutionLogger,
  ConsoleLogSink,
  InMemoryLogSink,
  type LogSink,
  type ExecutionLogEntry,
  type ExtractionLogData,
  type TransformationLogData,
  type LoadLogData,
  type RowError,
  type ExecutionSummary,
} from './execution-logger.js';

// Retry Executor
export {
  RetryExecutor,
  TestableRetryExecutor,
  InMemoryAdminNotifier,
  calculateBackoffDelay,
  type AdminNotifier,
  type PipelineFailureNotification,
  type RetryState,
  type RetryResult,
} from './retry-executor.js';

// Pipeline Events
export {
  InMemoryEventPublisher,
  createPipelineEvent,
  type PipelineEventPublisher,
  type PipelineEvent,
  type PipelineEventType,
  type ExecutionStartedPayload,
  type ExecutionCompletedPayload,
  type ExecutionFailedPayload,
  type ExecutionRetryingPayload,
  type ScheduleRegisteredPayload,
  type ScheduleRemovedPayload,
} from './pipeline-events.js';

// Schemas
export {
  CreatePipelineSchema,
  UpdatePipelineSchema,
  PipelineParamsSchema,
  PipelineListQuerySchema,
  DataSourceConfigSchema,
  DataDestinationConfigSchema,
  FieldMappingSchema,
  TransformationTypeSchema,
  RetryPolicySchema,
  SourceTypeSchema,
  DestinationTypeSchema,
  type CreatePipelineInput,
  type UpdatePipelineInput,
  type PipelineParams,
  type PipelineListQuery,
  type Pipeline,
  type PipelineExecution,
  type ExecutionError,
  type ExecutionStatus,
  type DataSourceConfig,
  type DataDestinationConfig,
  type FieldMapping,
  type TransformationType,
  type RetryPolicy,
  type SourceType,
  type DestinationType,
} from './schemas.js';

// Connectors
export {
  createSourceConnector,
  createDestinationConnector,
  type SourceConnector,
  type DestinationConnector,
  type DataRow,
  type ExtractionResult,
  type LoadResult,
} from './connectors/index.js';

// Transformations
export {
  transformRows,
  type TransformationResult,
  type TransformError,
} from './transformations/index.js';
