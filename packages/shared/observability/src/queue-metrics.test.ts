import { describe, expect, it } from 'vitest';
import { MetricsRegistry } from './metrics-registry.js';
import { createQueueDeliveryFailureObserver, recordQueueLag } from './queue-metrics.js';

describe('queue metrics (PRC-H086 / PRC-L493)', () => {
  it('exports failed deliveries as a Prometheus counter without tenant labels', async () => {
    const registry = new MetricsRegistry('api-gateway');
    const observe = createQueueDeliveryFailureObserver(registry);
    observe({ type: 'report-card.generate', disposition: 'retry' });
    observe({ type: 'report-card.generate', disposition: 'retry' });
    observe({ type: undefined, disposition: 'dead-letter' });
    const text = await registry.metrics();
    expect(text).toContain('# TYPE queue_delivery_failures_total counter');
    expect(text).toMatch(
      /queue_delivery_failures_total\{disposition="retry",type="report-card.generate",service="api-gateway"\} 2/,
    );
    expect(text).toMatch(/queue_delivery_failures_total\{disposition="dead-letter",type="unknown"/);
    expect(text).not.toContain('tenant');
  });

  it('records queue depth on slo_queue_lag_messages and ignores invalid samples', async () => {
    const registry = new MetricsRegistry('api-gateway');
    recordQueueLag(registry, 'api-gateway', [
      { topic: 'tenant.*.report-card.generate', depth: 7 },
      { topic: 'bad', depth: -1 },
      { topic: 'nan', depth: Number.NaN },
    ]);
    const text = await registry.metrics();
    expect(text).toMatch(
      /slo_queue_lag_messages\{service="api-gateway",topic="tenant.\*.report-card.generate"\} 7/,
    );
    expect(text).not.toContain('topic="bad"');
    expect(text).not.toContain('topic="nan"');
  });
});
