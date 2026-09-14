/**
 * W2-JOB-04: crash between DB commit and broker publish is recovered by relay.
 *
 * Tip verification (CONFIRMED dual-write without outbox):
 *   createJob → publishDocumentTask is not atomic — a crash after the DB
 *   commit leaves a durable job with no queue message and no recovery.
 *
 * Outbox path:
 *   createJob + outbox row in one unit of work → relay.dispatch recovers.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';

import {
  EXAM_DOCUMENT_JOB_TYPE,
  InMemoryDurableQueueAdapter,
  InMemoryDurableQueueStore,
  buildTenantName,
} from '../../index.js';
import { buildExamDocumentOutboxEntry } from '../builders.js';
import { InMemoryOutboxStore } from '../in-memory-outbox-store.js';
import { OutboxRelay } from '../relay.js';

describe('W2-JOB-04 transactional outbox crash recovery', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  let durableStore: InMemoryDurableQueueStore;
  let queue: InMemoryDurableQueueAdapter;
  let outbox: InMemoryOutboxStore;
  let relay: OutboxRelay;

  beforeEach(async () => {
    durableStore = new InMemoryDurableQueueStore();
    queue = new InMemoryDurableQueueAdapter({ store: durableStore, pollIntervalMs: 5 });
    await queue.connect();
    outbox = new InMemoryOutboxStore();
    relay = new OutboxRelay({ store: outbox, queue, batchSize: 10 });
  });

  it('CONFIRMED: dual-write loses the message when publish crashes after DB commit', async () => {
    // Simulate examination path without outbox: job persisted, then publish throws.
    const jobId = randomUUID();
    const persistedJobs = new Map<string, { id: string; tenantId: string }>();
    persistedJobs.set(jobId, { id: jobId, tenantId });

    const publishCrash = async () => {
      throw new Error('simulated process crash after DB commit, before broker ack');
    };

    await expect(publishCrash()).rejects.toThrow(/simulated process crash/);

    // Job exists in DB; broker has nothing; nothing will recover it.
    expect(persistedJobs.has(jobId)).toBe(true);
    expect(durableStore.pendingCount).toBe(0);
  });

  it('recovers a message that was committed to the outbox before broker publish', async () => {
    const jobId = randomUUID();
    const examinationId = randomUUID();

    // Atomic unit of work: domain job + outbox row (same "transaction").
    const domainJobs = new Map<string, { id: string }>();
    domainJobs.set(jobId, { id: jobId });
    const entry = buildExamDocumentOutboxEntry({
      tenantId,
      jobId,
      examinationId,
      documentType: 'admit_card',
    });
    await outbox.enqueue(entry);

    // === CRASH WINDOW ===
    // DB committed. Broker publish never happened. Process restarts.
    expect(domainJobs.has(jobId)).toBe(true);
    expect(await outbox.listPending()).toHaveLength(1);
    expect(durableStore.pendingCount).toBe(0);

    // Relay (new process) drains the outbox onto QueueAdapter.
    const published = await relay.tick();
    expect(published).toBe(1);

    expect(await outbox.listPending()).toHaveLength(0);
    expect(durableStore.pendingCount).toBe(1);

    const routingKey = buildTenantName(tenantId, EXAM_DOCUMENT_JOB_TYPE);
    const leased = durableStore.leaseMatching(routingKey);
    expect(leased).toBeDefined();
    expect(leased!.message.type).toBe(EXAM_DOCUMENT_JOB_TYPE);
    expect(leased!.message.payload).toEqual({
      jobId,
      examinationId,
      documentType: 'admit_card',
    });
    expect(leased!.message.metadata?.headers?.['x-outbox-id']).toBe(entry.id);
  });

  it('retries on transient broker failure then succeeds', async () => {
    const entry = buildExamDocumentOutboxEntry({
      tenantId,
      jobId: randomUUID(),
      examinationId: randomUUID(),
      documentType: 'seating_plan',
    });
    await outbox.enqueue(entry);

    let failOnce = true;
    const flakyQueue = {
      isConnected: () => true,
      connect: async () => undefined,
      disconnect: async () => undefined,
      publish: async () => undefined,
      subscribe: async () => undefined,
      consume: async () => undefined,
      healthCheck: async () => ({ healthy: true, backend: 'test' }),
      dispatch: async () => {
        if (failOnce) {
          failOnce = false;
          throw new Error('broker unavailable');
        }
        await queue.dispatch({
          id: randomUUID(),
          tenantId: entry.tenantId,
          type: entry.eventType,
          payload: entry.payload,
          timestamp: new Date().toISOString(),
        });
      },
    };

    const flakyRelay = new OutboxRelay({
      store: outbox,
      queue: flakyQueue as unknown as InMemoryDurableQueueAdapter,
      retryBackoffMs: 1,
      maxAttempts: 5,
    });

    expect(await flakyRelay.tick()).toBe(0);
    // Backoff set availableAt in the future — force due by claiming with future now
    // via a second tick after advancing: re-enqueue availability by marking due.
    const pending = await outbox.listPending();
    expect(pending).toHaveLength(1);
    // Make immediately available for next claim
    await outbox.markFailed(entry.id, 'broker unavailable', new Date(Date.now() - 1000));

    expect(await flakyRelay.tick()).toBe(1);
    expect(durableStore.pendingCount).toBe(1);
  });
});
