/**
 * apps/web/src/lib/sync/__tests__/syncQueue.test.ts
 * (Task 54.2, Requirements 38.5, 38.6, 38.7, Design §I)
 * =====================================================================
 *
 * Drives the IndexedDB persistence layer (`syncQueue.ts`) against the
 * in-memory `fake-indexeddb` shim so the read/write/delete paths run
 * exactly as they would in a browser.
 *
 * Test groups:
 *
 *   1. enqueue / peekAll / getOperation / dequeue — schema fidelity
 *      and CRUD semantics. Each persisted record must include all 12
 *      fields named in task 54.2.
 *
 *   2. Submission ordering — `peekAll` returns operations sorted by
 *      `createdAt` regardless of insertion order, with `id` as the
 *      tiebreaker so the order is total.
 *
 *   3. persistAttempt — bumps `attemptCount`, stamps `lastAttemptAt`,
 *      writes `lastError`, and tolerates a deleted operation by
 *      synthesising a tombstone the replay loop can use to exit.
 */

// `fake-indexeddb/auto` registers the global `indexedDB` shim before
// any other import sees it. Imported via side-effect for that reason.
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  _resetForTests,
  dequeue,
  enqueue,
  getOperation,
  peekAll,
  persistAttempt,
  type SyncQueueOperation,
} from '../syncQueue';

const baseInput = (overrides: Partial<Parameters<typeof enqueue>[0]> = {}) => ({
  tenantId: 't-1',
  userId: 'u-1',
  operationType: 'POST' as const,
  targetEntity: 'attendance',
  payload: { url: '/api/v1/attendance', body: '{"x":1}' },
  ...overrides,
});

beforeEach(async () => {
  await _resetForTests();
});

afterEach(async () => {
  await _resetForTests();
});

// ─── 1. CRUD + schema fidelity ───────────────────────────────────────────────

describe('Sync_Queue (persistence) — enqueue + read', () => {
  it('persists every named schema field from task 54.2', async () => {
    const id = await enqueue(
      baseInput({
        targetId: 's-99',
        idempotencyKey: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        createdAt: '2024-01-01T00:00:00.000Z',
      }),
    );

    const op = await getOperation(id);
    expect(op).not.toBeNull();
    const stored = op as SyncQueueOperation;

    // All 12 schema fields must be present and correct.
    expect(stored.id).toBe(id);
    expect(stored.tenantId).toBe('t-1');
    expect(stored.userId).toBe('u-1');
    expect(stored.operationType).toBe('POST');
    expect(stored.targetEntity).toBe('attendance');
    expect(stored.targetId).toBe('s-99');
    expect(stored.payload).toEqual({
      url: '/api/v1/attendance',
      body: '{"x":1}',
    });
    expect(stored.idempotencyKey).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    expect(stored.createdAt).toBe('2024-01-01T00:00:00.000Z');
    expect(stored.attemptCount).toBe(0);
    expect(stored.lastAttemptAt).toBeNull();
    expect(stored.lastError).toBeNull();
  });

  it('generates a UUID id and idempotency key when omitted', async () => {
    const id = await enqueue(baseInput());
    const op = (await getOperation(id))!;
    // RFC 4122 v4 layout — 36 chars, version nibble = 4.
    expect(op.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(op.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(op.id).not.toBe(op.idempotencyKey);
  });

  it('defaults targetId to empty string when not provided', async () => {
    const id = await enqueue(baseInput());
    const op = (await getOperation(id))!;
    expect(op.targetId).toBe('');
  });

  it('dequeue removes the operation and is idempotent on a missing id', async () => {
    const id = await enqueue(baseInput());
    await dequeue(id);
    expect(await getOperation(id)).toBeNull();
    // No-op on second call.
    await expect(dequeue(id)).resolves.toBeUndefined();
    await expect(dequeue('does-not-exist')).resolves.toBeUndefined();
  });

  it('getOperation returns null for unknown ids', async () => {
    expect(await getOperation('missing')).toBeNull();
  });
});

// ─── 2. Submission ordering ──────────────────────────────────────────────────

describe('Sync_Queue (persistence) — peekAll ordering', () => {
  it('returns operations in createdAt ascending order regardless of insertion order', async () => {
    await enqueue(baseInput({ createdAt: '2024-01-03T00:00:00Z', targetId: 'c' }));
    await enqueue(baseInput({ createdAt: '2024-01-01T00:00:00Z', targetId: 'a' }));
    await enqueue(baseInput({ createdAt: '2024-01-02T00:00:00Z', targetId: 'b' }));

    const ops = await peekAll();
    expect(ops.map((o) => o.targetId)).toEqual(['a', 'b', 'c']);
  });

  it('breaks ties on id so the order is total and deterministic', async () => {
    const sameTimestamp = '2024-01-01T00:00:00Z';
    await enqueue(baseInput({ id: 'op-z', createdAt: sameTimestamp, targetId: 'z' }));
    await enqueue(baseInput({ id: 'op-a', createdAt: sameTimestamp, targetId: 'a' }));
    await enqueue(baseInput({ id: 'op-m', createdAt: sameTimestamp, targetId: 'm' }));

    const ops = await peekAll();
    expect(ops.map((o) => o.id)).toEqual(['op-a', 'op-m', 'op-z']);
  });

  it('returns an empty array when nothing is queued', async () => {
    expect(await peekAll()).toEqual([]);
  });
});

// ─── 3. persistAttempt ───────────────────────────────────────────────────────

describe('Sync_Queue (persistence) — persistAttempt', () => {
  it('bumps attemptCount and stamps lastAttemptAt + lastError', async () => {
    const id = await enqueue(baseInput());

    const updated = await persistAttempt(
      id,
      1,
      '2024-06-01T12:00:00.000Z',
      'status 503: Service Unavailable',
    );

    expect(updated).not.toBeNull();
    expect(updated!.attemptCount).toBe(1);
    expect(updated!.lastAttemptAt).toBe('2024-06-01T12:00:00.000Z');
    expect(updated!.lastError).toBe('status 503: Service Unavailable');

    // The same record must be observable via getOperation (no
    // in-memory only mutation).
    const fetched = (await getOperation(id))!;
    expect(fetched.attemptCount).toBe(1);
    expect(fetched.lastError).toBe('status 503: Service Unavailable');
  });

  it('preserves the original payload and identity fields when bumping attemptCount', async () => {
    const id = await enqueue(
      baseInput({
        operationType: 'PATCH',
        targetEntity: 'student',
        targetId: 's-1',
        idempotencyKey: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      }),
    );

    await persistAttempt(id, 1, '2024-06-01T12:00:00Z', 'transient');

    const op = (await getOperation(id))!;
    expect(op.operationType).toBe('PATCH');
    expect(op.targetEntity).toBe('student');
    expect(op.targetId).toBe('s-1');
    expect(op.idempotencyKey).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  });

  it('returns null when the operation has been dequeued mid-replay', async () => {
    const result = await persistAttempt(
      'never-existed',
      3,
      '2024-06-01T12:00:00Z',
      'gone',
    );

    // Returning `null` is the signal to the replay loop that the
    // record is gone (the user discarded it) so it should exit
    // cleanly without spinning on a missing op.
    expect(result).toBeNull();
    // Importantly, no record was created in the store.
    expect(await getOperation('never-existed')).toBeNull();
  });
});
