/**
 * PRC-H086: handler failures are retried up to maxRetries then dead-lettered
 * with the original payload; every failure is logged and counted.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import { InMemoryDurableQueueAdapter } from '../adapters/in-memory-durable-adapter';
import type { QueueMessage } from '../types';

function msg(overrides: Partial<QueueMessage> = {}): QueueMessage {
  return {
    id: 'job-1',
    tenantId: 'tenant-a',
    type: 'report.generate',
    payload: { jobId: 'job-1' },
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

async function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  while (!pred()) {
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('InMemoryDurableQueueAdapter retry + DLQ (PRC-H086)', () => {
  let adapter: InMemoryDurableQueueAdapter | undefined;
  afterEach(async () => {
    await adapter?.disconnect();
    adapter = undefined;
  });

  it('retries a failing handler up to maxRetries then dead-letters the original payload', async () => {
    const logger = { warn: vi.fn(), error: vi.fn() };
    const onDeliveryFailure = vi.fn();
    adapter = new InMemoryDurableQueueAdapter({ pollIntervalMs: 5, logger, onDeliveryFailure });
    await adapter.connect();
    await adapter.dispatch(msg({ metadata: { maxRetries: 2 } }));

    const seen: number[] = [];
    await adapter.consume({ topic: 'tenant.*.report.generate' }, async (m) => {
      seen.push(m.metadata?.retryCount ?? 0);
      throw new Error('boom');
    });

    const store = adapter.getQueueStore();
    await waitFor(() => store.deadLetterCount === 1);
    expect(seen).toEqual([0, 1, 2]);
    expect(store.pendingCount).toBe(0);
    expect(store.inFlightCount).toBe(0);
    expect(store.deadLetters[0]!.message.payload).toEqual({ jobId: 'job-1' });
    expect(store.deadLetters[0]!.message.id).toBe('job-1');
    expect(adapter.failures.retried).toBe(2);
    expect(adapter.failures.deadLettered).toBe(1);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0]![0]).toMatchObject({
      messageId: 'job-1',
      type: 'report.generate',
      tenantId: 'tenant-a',
      disposition: 'dead-letter',
    });
    expect(onDeliveryFailure).toHaveBeenCalledTimes(3);
  });

  it('a transient failure is retried and eventually succeeds (job not lost)', async () => {
    adapter = new InMemoryDurableQueueAdapter({ pollIntervalMs: 5 });
    await adapter.connect();
    await adapter.dispatch(msg());
    let calls = 0;
    const done: string[] = [];
    await adapter.consume({ topic: 'tenant.*.report.generate' }, async (m) => {
      calls += 1;
      if (calls === 1) throw new Error('transient');
      done.push(m.id);
    });
    await waitFor(() => done.length === 1);
    expect(calls).toBe(2);
    expect(adapter.getQueueStore().deadLetterCount).toBe(0);
  });

  it('uses the adapter default retry budget when metadata.maxRetries is absent', async () => {
    adapter = new InMemoryDurableQueueAdapter({ pollIntervalMs: 5, defaultMaxRetries: 1 });
    await adapter.connect();
    await adapter.dispatch(msg());
    let calls = 0;
    await adapter.consume({ topic: 'tenant.*.report.generate' }, async () => {
      calls += 1;
      throw new Error('boom');
    });
    await waitFor(() => adapter!.getQueueStore().deadLetterCount === 1);
    expect(calls).toBe(2);
  });
});
