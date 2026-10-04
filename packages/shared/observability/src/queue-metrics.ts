/**
 * Queue consumer Prometheus instruments (PRC-H086, PRC-L493).
 *
 * Structural event types keep @proctira/observability free of a dependency on
 * @proctira/queue-abstraction; the queue package's `DeliveryFailureEvent` and
 * depth samples satisfy them.
 */
import type { MetricsRegistry } from './metrics-registry.js';

/** Metric name for failed queue deliveries (retried or dead-lettered). */
export const QUEUE_DELIVERY_FAILURES_METRIC = 'queue_delivery_failures_total';

/** Gauge name used by SLO queue-lag indicators (see registerServiceSLO). */
export const SLO_QUEUE_LAG_METRIC = 'slo_queue_lag_messages';

/** Minimal shape of a failed-delivery event. */
export interface QueueDeliveryFailureLike {
  type: string | undefined;
  disposition: 'retry' | 'dead-letter';
}

/**
 * Register `queue_delivery_failures_total{disposition,type}` on `registry` and
 * return an observer that increments it. Tenant ids are deliberately not used
 * as labels (unbounded cardinality, and they are tenant-identifying).
 */
export function createQueueDeliveryFailureObserver(
  registry: MetricsRegistry,
): (event: QueueDeliveryFailureLike) => void {
  const counter = registry.counter({
    name: QUEUE_DELIVERY_FAILURES_METRIC,
    help: 'Failed queue deliveries by disposition (retry | dead-letter) and message type',
    labelNames: ['disposition', 'type'] as const,
  });
  return (event) => {
    counter.inc({ disposition: event.disposition, type: event.type ?? 'unknown' });
  };
}

/** One queue-depth sample (messages waiting) for a consumer topic. */
export interface QueueDepthSample {
  topic: string;
  depth: number;
}

/**
 * Record queue depth samples on the `slo_queue_lag_messages{service,topic}`
 * gauge. Negative / non-finite samples are ignored.
 */
export function recordQueueLag(
  registry: MetricsRegistry,
  service: string,
  samples: readonly QueueDepthSample[],
): void {
  const gauge = registry.gauge({
    name: SLO_QUEUE_LAG_METRIC,
    help: 'Current consumer lag in messages for SLO tracking',
    labelNames: ['service', 'topic'] as const,
  });
  for (const sample of samples) {
    if (!Number.isFinite(sample.depth) || sample.depth < 0) continue;
    gauge.set({ service, topic: sample.topic }, sample.depth);
  }
}
