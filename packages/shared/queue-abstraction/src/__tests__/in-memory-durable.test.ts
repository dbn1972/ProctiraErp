import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  InMemoryDurableQueueAdapter,
  InMemoryDurableQueueStore,
  matchRoutingKey,
  buildTenantName,
  EXAM_DOCUMENT_JOB_TYPE,
  EXAM_DOCUMENT_CONSUME_TOPIC,
  type QueueMessage,
} from '../index';

describe('matchRoutingKey', () => {
  it('matches exact keys', () => {
    expect(matchRoutingKey('a.b.c', 'a.b.c')).toBe(true);
    expect(matchRoutingKey('a.b.c', 'a.b.d')).toBe(false);
  });

  it('matches single-segment wildcards', () => {
    expect(
      matchRoutingKey('tenant.*.exam.document.generate', 'tenant.t1.exam.document.generate'),
    ).toBe(true);
    expect(
      matchRoutingKey('tenant.*.exam.document.generate', 'tenant.t1.other.document.generate'),
    ).toBe(false);
  });

  it('matches hash wildcards', () => {
    expect(matchRoutingKey('tenant.#', 'tenant.t1.exam.document.generate')).toBe(true);
    expect(matchRoutingKey('#', 'anything.at.all')).toBe(true);
  });
});

describe('InMemoryDurableQueueAdapter restart safety', () => {
  let store: InMemoryDurableQueueStore;
  let adapter: InMemoryDurableQueueAdapter;

  beforeEach(async () => {
    store = new InMemoryDurableQueueStore();
    adapter = new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 });
    await adapter.connect();
  });

  afterEach(async () => {
    if (adapter.isConnected()) await adapter.disconnect();
  });

  function msg(tenantId = 't1'): QueueMessage {
    return {
      id: 'm1',
      tenantId,
      type: EXAM_DOCUMENT_JOB_TYPE,
      payload: { jobId: 'job-1' },
      timestamp: new Date().toISOString(),
    };
  }

  it('publishes with tenant-prefixed routing key', async () => {
    await adapter.publish(msg());
    expect(store.pendingCount).toBe(1);
    expect(store.pending[0]?.routingKey).toBe(buildTenantName('t1', EXAM_DOCUMENT_JOB_TYPE));
  });

  it('reclaims in-flight messages on disconnect (crash) and redelivers after restart', async () => {
    const firstDeliveries: string[] = [];
    const secondDeliveries: string[] = [];

    let hangResolve!: () => void;
    const hang = new Promise<void>((resolve) => {
      hangResolve = resolve;
    });

    await adapter.consume({ topic: EXAM_DOCUMENT_CONSUME_TOPIC }, async (message) => {
      firstDeliveries.push(String((message.payload as { jobId: string }).jobId));
      await hang; // simulate work in progress when the process dies
    });

    await adapter.dispatch(msg());

    // Wait until the message is leased (in-flight).
    await viWaitUntil(() => store.inFlightCount === 1, 1000);
    expect(firstDeliveries).toEqual(['job-1']);
    expect(store.pendingCount).toBe(0);

    // Crash: disconnect reclaims unacked delivery.
    await adapter.disconnect();
    expect(store.inFlightCount).toBe(0);
    expect(store.pendingCount).toBe(1);

    // Restart worker with the same durable store.
    const restarted = new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 });
    await restarted.connect();
    await restarted.consume({ topic: EXAM_DOCUMENT_CONSUME_TOPIC }, async (message) => {
      secondDeliveries.push(String((message.payload as { jobId: string }).jobId));
    });

    await viWaitUntil(() => secondDeliveries.length === 1, 1000);
    expect(secondDeliveries).toEqual(['job-1']);
    expect(store.pendingCount).toBe(0);
    expect(store.inFlightCount).toBe(0);

    hangResolve();
    await restarted.disconnect();
  });
});

async function viWaitUntil(pred: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitUntil timed out after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('InMemoryDurableQueueAdapter receive-side guard (PRC-L355)', () => {
  it('dead-letters (does not deliver) a message whose tenantId differs from its routing key', async () => {
    const { InMemoryDurableQueueAdapter, InMemoryDurableQueueStore } =
      await import('../adapters/in-memory-durable-adapter');
    const store = new InMemoryDurableQueueStore();
    const adapter = new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 });
    await adapter.connect();
    const ok = {
      id: 'ok',
      tenantId: 'tenant-a',
      type: 'report.generate',
      payload: {},
      timestamp: new Date().toISOString(),
    };
    // Spoofed: routed under tenant-a but claims tenant-b in the body.
    store.enqueue('tenant.tenant-a.report.generate', { ...ok, id: 'spoof', tenantId: 'tenant-b' });
    // Invalid envelope (missing type/timestamp).
    store.enqueue('tenant.tenant-a.report.generate', {
      id: 'bad',
      tenantId: 'tenant-a',
    } as never);
    store.enqueue('tenant.tenant-a.report.generate', ok);
    const seen: string[] = [];
    await adapter.consume({ topic: 'tenant.*.report.generate' }, async (m) => {
      seen.push(m.id);
    });
    const started = Date.now();
    while (store.pendingCount > 0 && Date.now() - started < 2000) {
      await new Promise((r) => setTimeout(r, 5));
    }
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toEqual(['ok']);
    expect(store.deadLetters.map((d) => d.message.id).sort()).toEqual(['bad', 'spoof']);
    expect(adapter.failures.deadLettered).toBe(2);
    await adapter.disconnect();
  });
});
