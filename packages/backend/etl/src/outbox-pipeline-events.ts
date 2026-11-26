/**
 * PRC-L098: durable pipeline events and failure alerts.
 *
 * The in-memory publisher and notifier keep everything in process memory, so a
 * pipeline failure reached nobody. These implementations write each event to the
 * shared transactional outbox (`transactional_outbox`, W2-JOB-04); the outbox
 * relay publishes it on the platform bus (`QUEUE_BACKEND` / `RABBITMQ_URL`,
 * topic exchange) and retries until the broker accepts it.
 *
 * Event contract (additive, topic 10 Option A), `dispatchMode: 'publish'`:
 *  - `etl.pipeline.execution.started|completed|failed|retrying`,
 *    `etl.pipeline.schedule.registered|removed`: payload {@link PipelineEventMessage}.
 *  - `etl.pipeline.failure_alert`: payload {@link PipelineFailureAlertMessage}, one per
 *    execution whose retries are exhausted (consumers notify tenant administrators).
 *
 * The writer port is structural (`OutboxStore.enqueue` satisfies it), so this
 * package does not depend on the queue package.
 */
import { randomUUID } from 'node:crypto';

import type {
  PipelineEvent,
  PipelineEventPublisher,
  PipelineEventType,
} from './pipeline-events.js';
import type { AdminNotifier, PipelineFailureNotification } from './retry-executor.js';

/** The subset of `NewOutboxEntry` these writers produce. */
export interface PipelineOutboxEntry {
  id: string;
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  metadata?: { correlationId?: string; headers?: Record<string, string> };
  dispatchMode?: 'dispatch' | 'publish';
}

/** Durable writer (the gateway passes `OutboxStore`). */
export interface PipelineOutboxWriter {
  enqueue(entry: PipelineOutboxEntry): Promise<unknown>;
}

export const ETL_PIPELINE_AGGREGATE_TYPE = 'etl_pipeline';
export const ETL_PIPELINE_FAILURE_ALERT_TYPE = 'etl.pipeline.failure_alert';

/** Routing key for a pipeline lifecycle event. */
export function etlPipelineEventType(type: PipelineEventType): string {
  return `etl.${type}`;
}

/** Wire shape of a pipeline lifecycle event (dates as ISO strings). */
export interface PipelineEventMessage {
  type: PipelineEventType;
  timestamp: string;
  tenantId: string;
  pipelineId: string;
  executionId: string | null;
  payload: Record<string, unknown>;
}

/** Wire shape of a failure alert. */
export interface PipelineFailureAlertMessage {
  tenantId: string;
  pipelineId: string;
  pipelineName: string;
  executionId: string;
  totalAttempts: number;
  lastError: string;
  failedAt: string;
}

function toWire(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toWire);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toWire(v)]));
  }
  return value;
}

/** Publishes pipeline lifecycle events through the transactional outbox. */
export class OutboxPipelineEventPublisher implements PipelineEventPublisher {
  constructor(private readonly outbox: PipelineOutboxWriter) {}

  async publish(event: PipelineEvent): Promise<void> {
    const message: PipelineEventMessage = {
      type: event.type,
      timestamp: event.timestamp.toISOString(),
      tenantId: event.tenantId,
      pipelineId: event.pipelineId,
      executionId: event.executionId ?? null,
      payload: toWire(event.payload) as Record<string, unknown>,
    };
    await this.outbox.enqueue({
      id: randomUUID(),
      tenantId: event.tenantId,
      aggregateType: ETL_PIPELINE_AGGREGATE_TYPE,
      aggregateId: event.pipelineId,
      eventType: etlPipelineEventType(event.type),
      payload: message,
      metadata: { correlationId: event.executionId ?? event.pipelineId },
      dispatchMode: 'publish',
    });
  }
}

/** Sends the retries-exhausted alert through the transactional outbox. */
export class OutboxAdminNotifier implements AdminNotifier {
  constructor(private readonly outbox: PipelineOutboxWriter) {}

  async notifyFinalFailure(notification: PipelineFailureNotification): Promise<void> {
    const message: PipelineFailureAlertMessage = {
      tenantId: notification.tenantId,
      pipelineId: notification.pipelineId,
      pipelineName: notification.pipelineName,
      executionId: notification.executionId,
      totalAttempts: notification.totalAttempts,
      lastError: notification.lastError,
      failedAt: notification.failedAt.toISOString(),
    };
    await this.outbox.enqueue({
      id: randomUUID(),
      tenantId: notification.tenantId,
      aggregateType: ETL_PIPELINE_AGGREGATE_TYPE,
      aggregateId: notification.pipelineId,
      eventType: ETL_PIPELINE_FAILURE_ALERT_TYPE,
      payload: message,
      metadata: { correlationId: notification.executionId },
      dispatchMode: 'publish',
    });
  }
}
