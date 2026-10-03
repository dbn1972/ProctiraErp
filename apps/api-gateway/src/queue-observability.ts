/**
 * Gateway queue observability wiring.
 *
 * PRC-H086: every queue adapter in this process reports failed deliveries
 * through `@proctira/queue-abstraction`'s process-wide observer; this exports
 * them as `queue_delivery_failures_total{disposition,type}` on the gateway's
 * `/metrics` registry.
 */
import { createQueueDeliveryFailureObserver } from '@proctira/observability';
import { addDeliveryFailureObserver } from '@proctira/queue-abstraction';
import type { FastifyInstance } from 'fastify';

/** Requires `observabilityPlugin` to be registered first (`app.metrics`). */
export function registerQueueObservability(app: FastifyInstance): void {
  if (!app.hasDecorator('metrics')) return;
  const unregister = addDeliveryFailureObserver(createQueueDeliveryFailureObserver(app.metrics));
  app.addHook('onClose', async () => {
    unregister();
  });
}
