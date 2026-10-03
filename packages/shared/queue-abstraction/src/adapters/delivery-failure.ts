/**
 * Shared consumer failure semantics (PRC-H086).
 *
 * On handler error a delivery is retried (republished with an incremented
 * `metadata.retryCount`) until `metadata.maxRetries` (or the adapter default)
 * is exhausted, then dead-lettered with the original payload. Every failed
 * delivery is logged with message id/type/tenantId and counted.
 */

import type { QueueMessage } from '../types';

/** Default retry budget when a message carries no `metadata.maxRetries`. */
export const DEFAULT_MAX_RETRIES = 3;

export interface QueueConsumerLogger {
  warn?: (obj: Record<string, unknown>, msg?: string) => void;
  error?: (obj: Record<string, unknown>, msg?: string) => void;
}

export type DeliveryFailureDisposition = 'retry' | 'dead-letter';

export interface DeliveryFailureEvent {
  messageId: string | undefined;
  type: string | undefined;
  tenantId: string | undefined;
  retryCount: number;
  maxRetries: number;
  disposition: DeliveryFailureDisposition;
  error: string;
}

/** Process-local failure counter, labelled by disposition (metric surrogate). */
export class DeliveryFailureCounter {
  retried = 0;
  deadLettered = 0;

  get total(): number {
    return this.retried + this.deadLettered;
  }

  record(disposition: DeliveryFailureDisposition): void {
    if (disposition === 'retry') this.retried += 1;
    else this.deadLettered += 1;
  }
}

export function resolveMaxRetries(message: QueueMessage | undefined, fallback: number): number {
  const raw = message?.metadata?.maxRetries;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return Math.floor(raw);
  return Math.max(0, Math.floor(fallback));
}

export function currentRetryCount(message: QueueMessage | undefined): number {
  const raw = message?.metadata?.retryCount;
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0;
}

/** Decide retry vs dead-letter for a failed delivery. */
export function decideDisposition(
  message: QueueMessage | undefined,
  defaultMaxRetries: number,
): { disposition: DeliveryFailureDisposition; retryCount: number; maxRetries: number } {
  const retryCount = currentRetryCount(message);
  const maxRetries = resolveMaxRetries(message, defaultMaxRetries);
  // Unparseable messages cannot be retried meaningfully → dead-letter.
  if (!message) return { disposition: 'dead-letter', retryCount, maxRetries };
  return {
    disposition: retryCount < maxRetries ? 'retry' : 'dead-letter',
    retryCount,
    maxRetries,
  };
}

/** Copy of `message` with `metadata.retryCount` incremented. */
export function withIncrementedRetry(message: QueueMessage): QueueMessage {
  return {
    ...message,
    metadata: { ...(message.metadata ?? {}), retryCount: currentRetryCount(message) + 1 },
  };
}

export function reportDeliveryFailure(
  event: DeliveryFailureEvent,
  counter: DeliveryFailureCounter,
  logger: QueueConsumerLogger | undefined,
  onFailure: ((event: DeliveryFailureEvent) => void) | undefined,
): void {
  counter.record(event.disposition);
  const fields: Record<string, unknown> = {
    messageId: event.messageId,
    type: event.type,
    tenantId: event.tenantId,
    retryCount: event.retryCount,
    maxRetries: event.maxRetries,
    disposition: event.disposition,
    err: event.error,
  };
  if (event.disposition === 'dead-letter') {
    logger?.error?.(fields, 'queue delivery dead-lettered');
  } else {
    logger?.warn?.(fields, 'queue delivery failed; retrying');
  }
  try {
    onFailure?.(event);
  } catch {
    // Observability hooks must never break consumption.
  }
  for (const listener of globalFailureListeners) {
    try {
      listener(event);
    } catch {
      // Observability hooks must never break consumption.
    }
  }
}

const globalFailureListeners = new Set<(event: DeliveryFailureEvent) => void>();

/**
 * PRC-H086: process-wide hook invoked for every failed delivery of every adapter instance
 * (adapters are built by env factories that take no metric hook). Used to export the consumer
 * failure counter as a Prometheus metric. Returns an unsubscribe function.
 */
export function addQueueDeliveryFailureListener(
  listener: (event: DeliveryFailureEvent) => void,
): () => void {
  globalFailureListeners.add(listener);
  return () => {
    globalFailureListeners.delete(listener);
  };
}

/** Minimal structural view of a metrics registry (avoids a prom-client dependency here). */
export interface QueueFailureMetricsRegistry {
  counter(config: { name: string; help: string; labelNames?: readonly string[] }): {
    inc(labels: Record<string, string>, value?: number): void;
  };
}

export const QUEUE_CONSUMER_FAILURES_METRIC = 'proctira_queue_consumer_failures_total';

/**
 * PRC-H086: export consumer failures as `proctira_queue_consumer_failures_total{type,disposition}`.
 * Labels stay bounded: job type (catalogue of job names) and retry|dead-letter — never tenant
 * or message ids.
 */
export function bindQueueFailureMetrics(registry: QueueFailureMetricsRegistry): () => void {
  const counter = registry.counter({
    name: QUEUE_CONSUMER_FAILURES_METRIC,
    help: 'Queue consumer handler failures by job type and disposition (retry or dead-letter)',
    labelNames: ['type', 'disposition'],
  });
  return addQueueDeliveryFailureListener((event) => {
    counter.inc({ type: event.type ?? 'unknown', disposition: event.disposition });
  });
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
