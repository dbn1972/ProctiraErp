/**
 * Pipeline Events
 *
 * Defines pipeline event types and a Kafka event publisher interface
 * for broadcasting pipeline lifecycle events to other services.
 */

export type PipelineEventType =
  | 'pipeline.execution.started'
  | 'pipeline.execution.completed'
  | 'pipeline.execution.failed'
  | 'pipeline.execution.retrying'
  | 'pipeline.schedule.registered'
  | 'pipeline.schedule.removed';

export interface PipelineEvent {
  type: PipelineEventType;
  timestamp: Date;
  tenantId: string;
  pipelineId: string;
  executionId?: string;
  payload: Record<string, unknown>;
}

export interface ExecutionStartedPayload {
  pipelineName: string;
  attempt: number;
  scheduledExecution: boolean;
}

export interface ExecutionCompletedPayload {
  pipelineName: string;
  extractedCount: number;
  transformedCount: number;
  loadedCount: number;
  errorCount: number;
  durationMs: number;
}

export interface ExecutionFailedPayload {
  pipelineName: string;
  error: string;
  attempt: number;
  retriesExhausted: boolean;
}

export interface ExecutionRetryingPayload {
  pipelineName: string;
  attempt: number;
  maxRetries: number;
  nextRetryAt: Date;
  lastError: string;
}

export interface ScheduleRegisteredPayload {
  pipelineName: string;
  cronExpression: string;
  nextRunAt: Date | null;
}

export interface ScheduleRemovedPayload {
  pipelineName: string;
}

/**
 * Event publisher interface for Kafka integration.
 * Implementations should publish events to the appropriate Kafka topic.
 */
export interface PipelineEventPublisher {
  /**
   * Publish a pipeline event to Kafka.
   * Topic naming convention: tenant.{tenantId}.etl.pipeline.events
   */
  publish(event: PipelineEvent): Promise<void>;
}

/**
 * In-memory event publisher for testing.
 */
export class InMemoryEventPublisher implements PipelineEventPublisher {
  public events: PipelineEvent[] = [];

  async publish(event: PipelineEvent): Promise<void> {
    this.events.push(event);
  }

  clear(): void {
    this.events = [];
  }

  getByType(type: PipelineEventType): PipelineEvent[] {
    return this.events.filter((e) => e.type === type);
  }

  getByPipeline(pipelineId: string): PipelineEvent[] {
    return this.events.filter((e) => e.pipelineId === pipelineId);
  }
}

/**
 * Helper to create typed pipeline events.
 */
export function createPipelineEvent(
  type: PipelineEventType,
  tenantId: string,
  pipelineId: string,
  payload: Record<string, unknown>,
  executionId?: string,
): PipelineEvent {
  return {
    type,
    timestamp: new Date(),
    tenantId,
    pipelineId,
    executionId,
    payload,
  };
}
