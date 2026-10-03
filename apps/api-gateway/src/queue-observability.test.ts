/**
 * PRC-H086: failed queue deliveries are exported on the gateway /metrics
 * registry as queue_delivery_failures_total.
 */
import { MetricsRegistry, observabilityPlugin } from '@proctira/observability';
import { InMemoryDurableQueueAdapter } from '@proctira/queue-abstraction';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { registerQueueObservability } from './queue-observability.js';

async function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  while (!pred()) {
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('registerQueueObservability (PRC-H086)', () => {
  const adapters: InMemoryDurableQueueAdapter[] = [];
  afterEach(async () => {
    await Promise.all(adapters.map((a) => a.disconnect()));
    adapters.length = 0;
  });

  it('counts retried and dead-lettered deliveries from any adapter in the process', async () => {
    const registry = new MetricsRegistry('api-gateway');
    const app = Fastify();
    await app.register(observabilityPlugin, { serviceName: 'api-gateway', registry });
    registerQueueObservability(app);
    await app.ready();

    const adapter = new InMemoryDurableQueueAdapter({ pollIntervalMs: 5 });
    adapters.push(adapter);
    await adapter.connect();
    await adapter.dispatch({
      id: 'job-1',
      tenantId: '11111111-1111-4111-8111-111111111111',
      type: 'report-card.generate',
      payload: {},
      timestamp: new Date().toISOString(),
      metadata: { maxRetries: 1 },
    });
    await adapter.consume({ topic: 'tenant.*.report-card.generate' }, async () => {
      throw new Error('boom');
    });
    await waitFor(() => adapter.getQueueStore().deadLetterCount === 1);

    const text = await registry.metrics();
    expect(text).toMatch(
      /queue_delivery_failures_total\{disposition="retry",type="report-card.generate",service="api-gateway"\} 1/,
    );
    expect(text).toMatch(
      /queue_delivery_failures_total\{disposition="dead-letter",type="report-card.generate",service="api-gateway"\} 1/,
    );

    // Observer is removed on close: later failures are not counted on this registry.
    await app.close();
    const second = new InMemoryDurableQueueAdapter({ pollIntervalMs: 5 });
    adapters.push(second);
    await second.connect();
    await second.dispatch({
      id: 'job-2',
      tenantId: '11111111-1111-4111-8111-111111111111',
      type: 'report-card.generate',
      payload: {},
      timestamp: new Date().toISOString(),
      metadata: { maxRetries: 0 },
    });
    await second.consume({ topic: 'tenant.*.report-card.generate' }, async () => {
      throw new Error('boom');
    });
    await waitFor(() => second.getQueueStore().deadLetterCount === 1);
    expect(await registry.metrics()).toMatch(
      /queue_delivery_failures_total\{disposition="dead-letter",type="report-card.generate",service="api-gateway"\} 1/,
    );
  });

  it('records adapter queue depth on slo_queue_lag_messages (PRC-L493)', async () => {
    const registry = new MetricsRegistry('api-gateway');
    const app = Fastify();
    await app.register(observabilityPlugin, { serviceName: 'api-gateway', registry });
    registerQueueObservability(app);
    await app.ready();
    const adapter = new InMemoryDurableQueueAdapter({ pollIntervalMs: 5 });
    adapters.push(adapter);
    await adapter.connect();
    for (const id of ['a', 'b']) {
      await adapter.dispatch({
        id,
        tenantId: '11111111-1111-4111-8111-111111111111',
        type: 'privacy.anonymize',
        payload: {},
        timestamp: new Date().toISOString(),
      });
    }
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await adapter.consume({ topic: 'tenant.*.privacy.anonymize' }, async () => gate);
    await waitFor(() => adapter.getQueueStore().inFlightCount === 1);
    const text = await registry.metrics();
    expect(text).toMatch(
      /slo_queue_lag_messages\{service="api-gateway",topic="tenant\.\*\.privacy\.anonymize"\} 2/,
    );
    release();
    await app.close();
  });
});
