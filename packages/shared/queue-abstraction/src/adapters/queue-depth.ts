/**
 * PRC-L493: process-wide queue-depth (consumer lag) observers. Adapters report
 * the number of messages waiting on each consumed queue; the service bootstrap
 * maps reports onto the `slo_queue_lag_messages{service,topic}` gauge.
 */

export interface QueueDepthReport {
  /** Consumer topic / binding pattern. */
  topic: string;
  /** Messages waiting (ready, not yet delivered). */
  depth: number;
}

const observers = new Set<(report: QueueDepthReport) => void>();

/** Register a queue-depth observer; returns an unregister function. */
export function addQueueDepthObserver(observer: (report: QueueDepthReport) => void): () => void {
  observers.add(observer);
  return () => {
    observers.delete(observer);
  };
}

/** Report one depth sample to every observer (observer errors are swallowed). */
export function reportQueueDepth(report: QueueDepthReport): void {
  if (!Number.isFinite(report.depth) || report.depth < 0) return;
  for (const observer of observers) {
    try {
      observer(report);
    } catch {
      // Metrics must never break consumption.
    }
  }
}

/** Default interval between broker depth samples. */
export const DEFAULT_DEPTH_SAMPLE_INTERVAL_MS = 15_000;
