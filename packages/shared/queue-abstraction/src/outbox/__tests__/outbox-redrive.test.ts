/**
 * V10 defect 1 — failed outbox rows must be recoverable.
 *
 * The defect was that `transactional_outbox` is a one-way sink: `OutboxRelay.tick`
 * calls `markFailed(id, err)` with no `availableAt` once attempts are exhausted,
 * which sets `status='failed'`, and `claimPending` reads only `status='pending'`.
 * The domain write has committed but its queue message can never publish.
 *
 * These tests assert the defect is gone and, more importantly, that the *mechanism*
 * works end to end through the real relay rather than only at the store level.
 */
import { describe, expect, it, vi } from 'vitest';

import type { QueueAdapter, QueueMessage } from '../../types.js';
import { InMemoryOutboxStore } from '../in-memory-outbox-store.js';
import { OutboxRelay } from '../relay.js';
import { InvalidOutboxIdError, PLATFORM_WIDE_REDRIVE } from '../store.js';
import type { NewOutboxEntry } from '../types.js';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
/** Well-formed uuid for tests that must fail validation on actor/reason, not on the id. */
const VALID_ID = '00000000-0000-4000-8000-0000000000e1';

function entry(overrides: Partial<NewOutboxEntry> = {}): NewOutboxEntry {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    tenantId: overrides.tenantId ?? TENANT_A,
    aggregateType: 'invoice',
    aggregateId: 'inv-1',
    eventType: 'invoice.issued',
    payload: { amount: 100 },
    ...overrides,
  };
}

/** Queue that fails a configurable number of times, then succeeds. */
function flakyQueue(failures: number): QueueAdapter & { published: QueueMessage[] } {
  let remaining = failures;
  const published: QueueMessage[] = [];
  return {
    published,
    isConnected: () => true,
    connect: async () => {},
    disconnect: async () => {},
    healthCheck: async () => ({ healthy: true, backend: 'test' as const }),
    dispatch: async (message: QueueMessage) => {
      if (remaining > 0) {
        remaining -= 1;
        throw new Error('broker unavailable');
      }
      published.push(message);
    },
    publish: async (message: QueueMessage) => {
      if (remaining > 0) {
        remaining -= 1;
        throw new Error('broker unavailable');
      }
      published.push(message);
    },
    subscribe: async () => {},
    process: async () => {},
  } as unknown as QueueAdapter & { published: QueueMessage[] };
}

describe('outbox redrive (V10 defect 1)', () => {
  it('reproduces the one-way sink: an exhausted row is invisible to claimPending', async () => {
    const store = new InMemoryOutboxStore();
    const queue = flakyQueue(Number.POSITIVE_INFINITY);
    const relay = new OutboxRelay({ store, queue, maxAttempts: 2, retryBackoffMs: 0 });

    await store.enqueue(entry({ id: '00000000-0000-4000-8000-000000000001' }));

    // Drive it past maxAttempts so the relay gives up permanently.
    for (let i = 0; i < 5; i += 1) await relay.tick();

    // This is the defect: the row exists, is unpublished, and claimPending
    // will never return it again.
    expect(await store.listPending()).toHaveLength(0);
    expect(await store.claimPending(10)).toHaveLength(0);
    expect(queue.published).toHaveLength(0);

    // And now it is at least visible, which it previously was not.
    const failed = await store.listFailed();
    expect(failed).toHaveLength(1);
    expect(failed[0]?.status).toBe('failed');
  });

  it('redrives a failed row and the relay then publishes it', async () => {
    const store = new InMemoryOutboxStore();
    // Fail exactly twice, so the row exhausts maxAttempts=2 and then a redrive
    // against a recovered broker succeeds.
    const queue = flakyQueue(2);
    const relay = new OutboxRelay({ store, queue, maxAttempts: 2, retryBackoffMs: 0 });

    const id = '00000000-0000-4000-8000-000000000002';
    await store.enqueue(entry({ id }));
    for (let i = 0; i < 5; i += 1) await relay.tick();
    expect(await store.listFailed()).toHaveLength(1);
    expect(queue.published).toHaveLength(0);

    const requeued = await store.requeueFailed({
      ids: [id],
      actor: 'ops@example.test',
      reason: 'broker outage resolved, incident INC-42',
      tenantId: TENANT_A,
    });
    expect(requeued).toEqual([id]);

    // The whole point: the relay picks it up again and it actually publishes.
    const published = await relay.tick();
    expect(published).toBe(1);
    expect(queue.published).toHaveLength(1);
    expect(queue.published[0]?.type).toBe('invoice.issued');
    expect(await store.listFailed()).toHaveLength(0);
  });

  it('resets attempts, without which the redrive would be a no-op', async () => {
    // Regression guard for the subtle failure: OutboxRelay.tick sends a row to
    // terminal `failed` when row.attempts >= maxAttempts. A requeue preserving
    // the exhausted counter would re-fail on the very first error, so the redrive
    // would appear to work and change nothing.
    const store = new InMemoryOutboxStore();
    const queue = flakyQueue(3);
    const relay = new OutboxRelay({ store, queue, maxAttempts: 2, retryBackoffMs: 0 });

    const id = '00000000-0000-4000-8000-000000000003';
    await store.enqueue(entry({ id }));
    for (let i = 0; i < 5; i += 1) await relay.tick();

    const exhausted = (await store.listFailed())[0];
    expect(exhausted?.attempts).toBeGreaterThanOrEqual(2);

    await store.requeueFailed({ ids: [id], actor: 'ops', reason: 'retry', tenantId: TENANT_A });

    const pending = (await store.listPending())[0];
    expect(pending?.attempts).toBe(0);

    // One more broker failure remains. Because attempts reset, the row goes back
    // to pending for another retry instead of straight to terminal failed.
    await relay.tick();
    expect(await store.listFailed()).toHaveLength(0);
    await relay.tick();
    expect(queue.published).toHaveLength(1);
  });

  it('records an append-only audit entry per redrive (Volume 5 §6)', async () => {
    const store = new InMemoryOutboxStore();
    const queue = flakyQueue(Number.POSITIVE_INFINITY);
    const relay = new OutboxRelay({ store, queue, maxAttempts: 1, retryBackoffMs: 0 });

    const id = '00000000-0000-4000-8000-000000000004';
    await store.enqueue(entry({ id }));
    for (let i = 0; i < 3; i += 1) await relay.tick();

    await store.requeueFailed({ ids: [id], actor: 'alice', reason: 'first attempt', tenantId: TENANT_A });
    for (let i = 0; i < 3; i += 1) await relay.tick();
    await store.requeueFailed({ ids: [id], actor: 'bob', reason: 'second attempt', tenantId: TENANT_A });

    const history = (await store.listPending())[0]?.redriveHistory ?? [];
    expect(history).toHaveLength(2);
    expect(history[0]?.actor).toBe('alice');
    expect(history[0]?.reason).toBe('first attempt');
    expect(history[1]?.actor).toBe('bob');
    // fromAttempts captures the counter before the reset, so the trail shows how
    // exhausted the row was at each redrive.
    expect(history[1]?.fromAttempts).toBeGreaterThanOrEqual(1);
  });

  it('refuses an anonymous or unexplained redrive', async () => {
    const store = new InMemoryOutboxStore();
    await expect(
      store.requeueFailed({ ids: [VALID_ID], actor: '  ', reason: 'why', tenantId: TENANT_A }),
    ).rejects.toThrow(/actor is required/);
    await expect(
      store.requeueFailed({ ids: [VALID_ID], actor: 'ops', reason: '', tenantId: TENANT_A }),
    ).rejects.toThrow(/reason is required/);
  });

  it('will not redrive another tenant\u2019s rows when scoped to one tenant', async () => {
    const store = new InMemoryOutboxStore();
    const queue = flakyQueue(Number.POSITIVE_INFINITY);
    const relay = new OutboxRelay({ store, queue, maxAttempts: 1, retryBackoffMs: 0 });

    const idA = '00000000-0000-4000-8000-00000000000a';
    const idB = '00000000-0000-4000-8000-00000000000b';
    await store.enqueue(entry({ id: idA, tenantId: TENANT_A }));
    await store.enqueue(entry({ id: idB, tenantId: TENANT_B }));
    for (let i = 0; i < 3; i += 1) await relay.tick();
    expect(await store.listFailed()).toHaveLength(2);

    // An operator scoped to tenant A passes both ids. Only A's row moves.
    const requeued = await store.requeueFailed({
      ids: [idA, idB],
      actor: 'ops-a',
      reason: 'scoped redrive',
      tenantId: TENANT_A,
    });
    expect(requeued).toEqual([idA]);

    const stillFailed = await store.listFailed();
    expect(stillFailed.map((r) => r.id)).toEqual([idB]);
  });

  it('is idempotent: redriving twice does not double-publish', async () => {
    const store = new InMemoryOutboxStore();
    const queue = flakyQueue(1);
    const relay = new OutboxRelay({ store, queue, maxAttempts: 1, retryBackoffMs: 0 });

    const id = '00000000-0000-4000-8000-000000000005';
    await store.enqueue(entry({ id }));
    for (let i = 0; i < 3; i += 1) await relay.tick();

    const first = await store.requeueFailed({
      ids: [id], actor: 'ops', reason: 'r', tenantId: TENANT_A,
    });
    // Second call hits a row that is no longer `failed`, so it reports nothing moved.
    const second = await store.requeueFailed({
      ids: [id], actor: 'ops', reason: 'r', tenantId: TENANT_A,
    });
    expect(first).toEqual([id]);
    expect(second).toEqual([]);

    await relay.tick();
    expect(queue.published).toHaveLength(1);
  });

  it('reports a partial redrive for unknown but well-formed ids', async () => {
    const store = new InMemoryOutboxStore();
    const queue = flakyQueue(Number.POSITIVE_INFINITY);
    const relay = new OutboxRelay({ store, queue, maxAttempts: 1, retryBackoffMs: 0 });

    const real = '00000000-0000-4000-8000-000000000006';
    const absent = '00000000-0000-4000-8000-0000000000ff';
    await store.enqueue(entry({ id: real }));
    for (let i = 0; i < 3; i += 1) await relay.tick();

    const requeued = await store.requeueFailed({
      ids: [real, absent],
      actor: 'ops',
      reason: 'mixed batch',
      tenantId: TENANT_A,
    });
    expect(requeued).toEqual([real]);
  });

  it('rejects a batch containing a non-UUID id, and redrives nothing', async () => {
    // Regression guard for a real divergence. `PgOutboxStore` uses
    // `id = ANY($1::uuid[])`, so one malformed element raises 22P02, rolls the
    // transaction back and redrives NOTHING — while this store used to skip the bad
    // id and report partial success. An earlier version of this suite asserted the
    // lenient behaviour and so certified a contract Postgres does not honour.
    // Both stores now reject the batch up front, naming the offending ids.
    const store = new InMemoryOutboxStore();
    const queue = flakyQueue(Number.POSITIVE_INFINITY);
    const relay = new OutboxRelay({ store, queue, maxAttempts: 1, retryBackoffMs: 0 });

    const real = '00000000-0000-4000-8000-00000000006a';
    await store.enqueue(entry({ id: real }));
    for (let i = 0; i < 3; i += 1) await relay.tick();

    await expect(
      store.requeueFailed({
        ids: [real, 'does-not-exist'],
        actor: 'ops',
        reason: 'typo in batch',
        tenantId: TENANT_A,
      }),
    ).rejects.toThrow(InvalidOutboxIdError);

    // Crucially: the valid row was NOT redriven, matching Postgres's all-or-nothing
    // behaviour rather than silently half-applying.
    expect((await store.listFailed()).map((r) => r.id)).toContain(real);
  });

  it('requires an explicit opt-in for a cross-tenant redrive', async () => {
    const store = new InMemoryOutboxStore();
    const queue = flakyQueue(Number.POSITIVE_INFINITY);
    const relay = new OutboxRelay({ store, queue, maxAttempts: 1, retryBackoffMs: 0 });

    const idA = '00000000-0000-4000-8000-00000000007a';
    const idB = '00000000-0000-4000-8000-00000000007b';
    await store.enqueue(entry({ id: idA, tenantId: TENANT_A }));
    await store.enqueue(entry({ id: idB, tenantId: TENANT_B }));
    for (let i = 0; i < 3; i += 1) await relay.tick();

    // PLATFORM_WIDE_REDRIVE is a symbol, so a caller cannot reach cross-tenant
    // behaviour by omitting a field or threading through an `undefined`.
    const requeued = await store.requeueFailed({
      ids: [idA, idB],
      actor: 'platform-ops',
      reason: 'global broker outage',
      tenantId: PLATFORM_WIDE_REDRIVE,
    });
    expect(requeued.sort()).toEqual([idA, idB].sort());
  });

  it('clears last_error so a requeued row does not show a stale failure', async () => {
    const store = new InMemoryOutboxStore();
    const queue = flakyQueue(Number.POSITIVE_INFINITY);
    const relay = new OutboxRelay({ store, queue, maxAttempts: 1, retryBackoffMs: 0 });

    const id = '00000000-0000-4000-8000-00000000008a';
    await store.enqueue(entry({ id }));
    for (let i = 0; i < 3; i += 1) await relay.tick();
    expect((await store.listFailed())[0]?.lastError).toBeDefined();

    await store.requeueFailed({ ids: [id], actor: 'ops', reason: 'r', tenantId: TENANT_A });
    expect((await store.listPending())[0]?.lastError).toBeUndefined();
  });

  it('does not let a caller mutate stored state through a returned record', async () => {
    // PgOutboxStore materialises redriveHistory fresh from jsonb on every read, so
    // the in-memory store must not hand back the live array or the two would diverge
    // in a way these tests could not see.
    const store = new InMemoryOutboxStore();
    const queue = flakyQueue(Number.POSITIVE_INFINITY);
    const relay = new OutboxRelay({ store, queue, maxAttempts: 1, retryBackoffMs: 0 });

    const id = '00000000-0000-4000-8000-00000000009a';
    await store.enqueue(entry({ id }));
    for (let i = 0; i < 3; i += 1) await relay.tick();
    await store.requeueFailed({ ids: [id], actor: 'ops', reason: 'r', tenantId: TENANT_A });

    const record = (await store.listPending())[0];
    record?.redriveHistory.push({ at: 'x', actor: 'forged', reason: 'x', fromAttempts: 0 });

    const reread = (await store.listPending())[0];
    expect(reread?.redriveHistory).toHaveLength(1);
    expect(reread?.redriveHistory[0]?.actor).toBe('ops');
  });

  it('filters listFailed by tenant and creation time', async () => {
    const store = new InMemoryOutboxStore();
    const queue = flakyQueue(Number.POSITIVE_INFINITY);
    const relay = new OutboxRelay({ store, queue, maxAttempts: 1, retryBackoffMs: 0 });

    await store.enqueue(entry({ id: crypto.randomUUID(), tenantId: TENANT_A }));
    await store.enqueue(entry({ id: crypto.randomUUID(), tenantId: TENANT_B }));
    for (let i = 0; i < 3; i += 1) await relay.tick();

    expect(await store.listFailed({ tenantId: TENANT_A })).toHaveLength(1);
    expect(await store.listFailed({ tenantId: TENANT_B })).toHaveLength(1);
    expect(await store.listFailed({ createdSince: new Date(Date.now() + 60_000) })).toHaveLength(0);
    expect(await store.listFailed({ limit: 1 })).toHaveLength(1);
  });

  it('leaves a retry-scheduled row alone — only terminal rows are redriven', async () => {
    // markFailed WITH availableAt is the normal backoff path and keeps the row
    // `pending`. listFailed must not surface those, or an operator would redrive
    // rows the relay is already going to retry.
    const store = new InMemoryOutboxStore();
    const id = '00000000-0000-4000-8000-000000000007';
    await store.enqueue(entry({ id }));
    await store.markFailed(id, 'transient', new Date(Date.now() + 10_000));

    expect(await store.listFailed()).toHaveLength(0);
    expect(
      await store.requeueFailed({ ids: [id], actor: 'ops', reason: 'r', tenantId: TENANT_A }),
    ).toEqual([]);
  });

  it('a redriven row is still delivered with its original payload and event type', async () => {
    const store = new InMemoryOutboxStore();
    const queue = flakyQueue(1);
    const relay = new OutboxRelay({ store, queue, maxAttempts: 1, retryBackoffMs: 0 });

    const id = '00000000-0000-4000-8000-000000000008';
    await store.enqueue(
      entry({
        id,
        eventType: 'fees.invoice.issued',
        payload: { invoiceId: 'INV-9', amountMinor: 250_00 },
        aggregateType: 'fee_invoice',
        aggregateId: 'INV-9',
      }),
    );
    for (let i = 0; i < 3; i += 1) await relay.tick();
    await store.requeueFailed({ ids: [id], actor: 'ops', reason: 'r', tenantId: TENANT_A });
    await relay.tick();

    const msg = queue.published[0];
    expect(msg?.type).toBe('fees.invoice.issued');
    expect(msg?.payload).toEqual({ invoiceId: 'INV-9', amountMinor: 250_00 });
    expect(msg?.tenantId).toBe(TENANT_A);
    // Outbox identity is preserved for downstream dedupe.
    expect(msg?.metadata?.headers?.['x-outbox-id']).toBe(id);
    // The audit trail must not leak into the broker payload.
    expect(JSON.stringify(msg)).not.toContain('redriveHistory');
    expect(JSON.stringify(msg)).not.toContain('ops');
  });

  it('does nothing for an empty id list', async () => {
    const store = new InMemoryOutboxStore();
    expect(
      await store.requeueFailed({ ids: [], actor: 'ops', reason: 'r', tenantId: TENANT_A }),
    ).toEqual([]);
  });

  it('surfaces the redrive to a logger-style hook via the returned ids', async () => {
    // The store deliberately does not import the audit package (a shared package
    // must not depend on a backend one). The contract is that the caller gets the
    // transitioned ids back and is responsible for the hash-chained audit write.
    const store = new InMemoryOutboxStore();
    const queue = flakyQueue(Number.POSITIVE_INFINITY);
    const relay = new OutboxRelay({ store, queue, maxAttempts: 1, retryBackoffMs: 0 });
    const auditSink = vi.fn();

    const id = '00000000-0000-4000-8000-000000000009';
    await store.enqueue(entry({ id }));
    for (let i = 0; i < 3; i += 1) await relay.tick();

    const ids = await store.requeueFailed({
      ids: [id], actor: 'ops', reason: 'INC-7', tenantId: TENANT_A,
    });
    if (ids.length > 0) auditSink({ action: 'outbox.redrive', ids, actor: 'ops' });

    expect(auditSink).toHaveBeenCalledWith({
      action: 'outbox.redrive',
      ids: [id],
      actor: 'ops',
    });
  });
});
