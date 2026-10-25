/**
 * ETL pipeline audit events (PRC-L302).
 *
 * Every successful pipeline mutation (create/update/delete) and every settled execution emits
 * exactly one event carrying tenant, actor, action and resource identifiers. Events never
 * include connector config, credentials, field mappings or row data. Follows the injectable
 * sink precedent in `@proctira/backend-data-warehouse` (`audit.ts`, PRC-L452).
 */
import type { LogSink } from './execution-logger.js';

export type EtlAuditAction =
  'pipeline.create' | 'pipeline.update' | 'pipeline.delete' | 'pipeline.execute';

export interface EtlAuditEvent {
  tenantId: string;
  /** Verified caller identity; `null` for scheduler-initiated runs. */
  actorId: string | null;
  action: EtlAuditAction;
  pipelineId: string;
  executionId: string | null;
  /** Execution status for `pipeline.execute` (e.g. `completed`, `failed`). */
  outcome?: string;
  occurredAt: Date;
}

export type EtlAuditSink = (event: EtlAuditEvent) => void | Promise<void>;

/** Caller identity passed from routes into mutating service calls. */
export interface EtlAuditContext {
  actorId?: string | null;
}

/**
 * Default sink: one structured `audit` entry on the service's log sink. This is a log line,
 * not durable audit storage; inject a persistent `auditSink` where one is available.
 */
export function createLogSinkAuditSink(logSink: LogSink): EtlAuditSink {
  return (event) => {
    logSink.info({
      timestamp: event.occurredAt,
      level: 'info',
      phase: 'audit',
      pipelineId: event.pipelineId,
      executionId: event.executionId ?? '',
      tenantId: event.tenantId,
      message: `Audit: ${event.action}`,
      metadata: {
        action: event.action,
        actorId: event.actorId,
        ...(event.outcome !== undefined ? { outcome: event.outcome } : {}),
      },
    });
  };
}
