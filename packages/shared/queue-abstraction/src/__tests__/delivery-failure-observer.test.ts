/**
 * PRC-H086: a process-wide observer (the gateway's Prometheus counter) sees
 * every failed delivery from adapters it did not construct.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addDeliveryFailureObserver } from '../adapters/delivery-failure';
import { InMemoryDurableQueueAdapter } from '../adapters/in-memory-durable-adapter';

async function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  while (!pred()) {
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('addDeliveryFailureObserver (PRC-H086)', () => {
  let adapter: InMemoryDurableQueueAdapter | undefined;
  afterEach(async () => {
    await adapter?.disconnect();
    adapter = undefined;
  });

  it('notifies global observers for each failed delivery and stops after unregister', async () => {
    const observer = vi.fn();
    const throwing = vi.fn(() => {
      throw new Error('observer bug');
    });
    const off = addDeliveryFailureObserver(observer);
    const offThrowing = addDeliveryFailureObserver(throwing);
    adapter = new InMemoryDurableQueueAdapter({ pollIntervalMs: 5 });
    await adapter.connect();
    await adapter.dispatch({
      id: 'job-1',
      tenantId: 'tenant-a',
      type: 'report.generate',
      payload: {},
      timestamp: new Date().toISOString(),
      metadata: { maxRetries: 1 },
    });
    await adapter.consume({ topic: 'tenant.*.report.generate' }, async () => {
      throw new Error('boom');
    });
    await waitFor(() => adapter!.getQueueStore().deadLetterCount === 1);
    expect(observer).toHaveBeenCalledTimes(2);
    expect(observer.mock.calls.map((c) => c[0].disposition)).toEqual(['retry', 'dead-letter']);
    // A throwing observer never breaks consumption.
    expect(throwing).toHaveBeenCalledTimes(2);
    off();
    offThrowing();
    expect(adapter.failures.total).toBe(2);
  });
});
