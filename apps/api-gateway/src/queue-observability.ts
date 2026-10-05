/**
 * Gateway queue observability wiring.
 *
 * PRC-H086: every queue adapter in this process reports failed deliveries
 * through `@proctira/queue-abstraction`'s process-wide observer; this exports
 * them as `queue_delivery_failures_total{disposition,type}` on the gateway's
 * `/metrics` registry.
 */
import { createQueueDeliveryFailureObserver, recordQueueLag } from '@proctira/observability';
import { addDeliveryFailureObserver, addQueueDepthObserver } from '@proctira/queue-abstraction';
import type { FastifyInstance } from 'fastify';

/** Requires `observabilityPlugin` to be registered first (`app.metrics`). */
export function registerQueueObservability(app: FastifyInstance): void {
  if (!app.hasDecorator('metrics')) return;
  const unregister = addDeliveryFailureObserver(createQueueDeliveryFailureObserver(app.metrics));
  // PRC-L493: adapter depth samples → slo_queue_lag_messages{service,topic}.
  const metrics = app.metrics;
  const unregisterDepth = addQueueDepthObserver((report) => {
    recordQueueLag(metrics, 'api-gateway', [report]);
  });
  app.addHook('onClose', async () => {
    unregister();
    unregisterDepth();
  });
}
