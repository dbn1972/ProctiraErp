/**
 * apps/web/src/lib/sync/__tests__/replay.test.ts
 * (Task 54.2, Requirements 38.5, 38.6, 38.7, Design §I)
 * =====================================================================
 *
 * Drives the `replayAll` loop end-to-end using the real persistence
 * layer (`syncQueue.ts`) backed by `fake-indexeddb`. Tests cover:
 *
 *   1. Submission-order replay — `replayAll` drains in `createdAt`
 *      ascending order and dequeues 2xx replies.
 *
 *   2. Idempotency-Key header — every replayed request carries the
 *      operation's stored `Idempotency-Key` so the API_Gateway can
 *      deduplicate retries (task 54.6 / Requirement 38.7).
 *
 *   3. Backoff schedule — 5xx / 408 / 429 / network errors trigger
 *      `BACKOFF_SCHEDULE_MS` waits up to `MAX_ATTEMPTS` and leave the
 *      operation parked with `lastError` populated when the budget is
 *      exhausted (Requirement 38.6).
 *
 *   4. Permanent failures — 4xx (other than 408 / 429) stop retrying
 *      immediately so the conflict dialog (task 54.5) can surface
 *      them.
 *
 *   5. Cooperative abort — an `AbortSignal` cuts the drain at the next
 *      between-operations checkpoint.
 *
 *   6. Property tests (fast-check) — random submission orders are
 *      drained in `createdAt` order and every replayed request
 *      carries its operation's `Idempotency-Key`.
 */

// `fake-indexeddb/auto` registers the global `indexedDB` shim before
// any other import sees it. Imported via side-effect for that reason.
import 'fake-indexeddb/auto';

import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BACKOFF_SCHEDULE_MS, MAX_ATTEMPTS, replayAll } from '../replay';
import {
  _resetForTests,
  enqueue,
  getOperation,
  peekAll,
} from '../syncQueue';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * A `wait` substitute that records the requested delays without
 * actually sleeping. Lets tests assert on the backoff schedule
 * deterministically.
 */
function fakeWait(): { wait: (ms: number) => Promise<void>; calls: number[] } {
  const calls: number[] = [];
  const wait = (ms: number): Promise<void> => {
    calls.push(ms);
    return Promise.resolve();
  };
  return { wait, calls };
}

/** Fixed-clock substitute so `lastAttemptAt` is deterministic. */
function fakeNow(start = 1_700_000_000_000): { now: () => number } {
  let t = start;
  return {
    now: () => {
      const v = t;
      t += 1; // monotone so successive calls differ
      return v;
    },
  };
}

/** Mock fetch that returns a canned `Response` (or throws an `Error`)
 * per call. Records the `Request` arguments for assertions. */
interface MockCall {
  url: string;
  init: RequestInit | undefined;
}
function mockFetcher(responses: ReadonlyArray<Response | Error>): {
  fetch: typeof fetch;
  calls: MockCall[];
} {
  const calls: MockCall[] = [];
  let i = 0;
  const fn: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    calls.push({ url, init: init ?? undefined });
    const next = responses[i] ?? new Response('OK', { status: 200 });
    i += 1;
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetch: fn, calls };
}

const baseInput = (overrides: Partial<Parameters<typeof enqueue>[0]> = {}) => ({
  tenantId: 't-1',
  userId: 'u-1',
  operationType: 'POST' as const,
  targetEntity: 'attendance',
  payload: { url: '/api/v1/attendance', body: '{"x":1}' },
  ...overrides,
});

/**
 * Read a header off whichever `HeadersInit` shape the fetch
 * implementation received. The `Headers` constructor normalises
 * objects, arrays, and `Headers` instances.
 */
function extractHeader(
  init: HeadersInit | undefined,
  name: string,
): string | null {
  if (!init) return null;
  return new Headers(init).get(name);
}

beforeEach(async () => {
  await _resetForTests();
});

afterEach(async () => {
  await _resetForTests();
});

// ─── 1. Submission-order replay ──────────────────────────────────────────────

describe('replayAll — success path', () => {
  it('drains in submission order and dequeues 2xx replies', async () => {
    await enqueue(
      baseInput({
        createdAt: '2024-01-03T00:00:00Z',
        idempotencyKey: 'idem-c',
        targetId: 'c',
      }),
    );
    await enqueue(
      baseInput({
        createdAt: '2024-01-01T00:00:00Z',
        idempotencyKey: 'idem-a',
        targetId: 'a',
      }),
    );
    await enqueue(
      baseInput({
        createdAt: '2024-01-02T00:00:00Z',
        idempotencyKey: 'idem-b',
        targetId: 'b',
      }),
    );

    const { fetch, calls } = mockFetcher([
      new Response('', { status: 200 }),
      new Response('', { status: 201 }),
      new Response(null, { status: 204 }),
    ]);

    const results = await replayAll(fetch, fakeWait());
    expect(results.map((r) => r.outcome)).toEqual([
      'succeeded',
      'succeeded',
      'succeeded',
    ]);

    // The Idempotency-Key header lets us confirm the calls executed
    // in createdAt order (a, b, c).
    expect(
      calls.map((c) => extractHeader(c.init?.headers, 'Idempotency-Key')),
    ).toEqual(['idem-a', 'idem-b', 'idem-c']);

    expect(await peekAll()).toEqual([]);
  });

  it('every replayed request carries an Idempotency-Key header', async () => {
    const id = await enqueue(
      baseInput({
        idempotencyKey: 'idem-abc',
        targetId: 's-1',
      }),
    );
    const { fetch, calls } = mockFetcher([new Response('', { status: 200 })]);

    await replayAll(fetch, fakeWait());

    expect(calls).toHaveLength(1);
    expect(extractHeader(calls[0]!.init?.headers, 'Idempotency-Key')).toBe(
      'idem-abc',
    );
    expect(await getOperation(id)).toBeNull();
  });

  it('uses the operation type as the request method', async () => {
    await enqueue(baseInput({ operationType: 'PATCH' }));
    const { fetch, calls } = mockFetcher([new Response('', { status: 200 })]);
    await replayAll(fetch, fakeWait());
    expect(calls[0]!.init?.method).toBe('PATCH');
  });

  it('attaches the default tenant + user headers to every replay', async () => {
    await enqueue(
      baseInput({
        tenantId: 'tenant-42',
        userId: 'user-7',
      }),
    );
    const { fetch, calls } = mockFetcher([new Response('', { status: 200 })]);
    await replayAll(fetch, fakeWait());
    const headers = calls[0]!.init?.headers;
    expect(extractHeader(headers, 'X-Tenant-ID')).toBe('tenant-42');
    expect(extractHeader(headers, 'X-User-ID')).toBe('user-7');
    expect(extractHeader(headers, 'X-Sync-Replay')).toBe('1');
  });
});

// ─── 2. Backoff on transient failures ────────────────────────────────────────

describe('replayAll — transient failures and backoff', () => {
  it('retries up to MAX_ATTEMPTS on 503, waiting per BACKOFF_SCHEDULE_MS', async () => {
    const id = await enqueue(baseInput());
    const responses: Response[] = [];
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      responses.push(new Response('boom', { status: 503 }));
    }
    const { fetch, calls } = mockFetcher(responses);
    const w = fakeWait();
    const c = fakeNow();

    const [result] = await replayAll(fetch, { wait: w.wait, now: c.now });

    expect(calls).toHaveLength(MAX_ATTEMPTS);
    expect(result!.outcome).toBe('failed_transient');
    expect(result!.status).toBe(503);
    expect(result!.attemptCount).toBe(MAX_ATTEMPTS);

    // `wait` is called between attempts (not after the final attempt
    // when the budget is exhausted). Schedule corresponds to attempts
    // 1..MAX_ATTEMPTS-1.
    expect(w.calls).toEqual(BACKOFF_SCHEDULE_MS.slice(0, MAX_ATTEMPTS - 1));

    const op = await getOperation(id);
    expect(op).not.toBeNull();
    expect(op!.attemptCount).toBe(MAX_ATTEMPTS);
    expect(op!.lastError).toMatch(/status 503/);
    expect(op!.lastAttemptAt).toBeTruthy();
  });

  it('retries on network errors and dequeues on eventual success', async () => {
    await enqueue(baseInput());
    const { fetch, calls } = mockFetcher([
      new Error('offline'),
      new Error('offline'),
      new Response('', { status: 200 }),
    ]);
    const w = fakeWait();

    const [result] = await replayAll(fetch, { wait: w.wait });

    expect(calls).toHaveLength(3);
    expect(result!.outcome).toBe('succeeded');
    expect(result!.status).toBe(200);
    expect(w.calls).toEqual([BACKOFF_SCHEDULE_MS[0], BACKOFF_SCHEDULE_MS[1]]);
    expect(await peekAll()).toEqual([]);
  });

  it('treats 408 (Request Timeout) and 429 (Too Many Requests) as transient', async () => {
    await enqueue(baseInput());
    const { fetch } = mockFetcher([
      new Response('', { status: 408 }),
      new Response('', { status: 429 }),
      new Response('', { status: 200 }),
    ]);
    const [result] = await replayAll(fetch, fakeWait());
    expect(result!.outcome).toBe('succeeded');
  });

  it('skips operations already at MAX_ATTEMPTS instead of retrying', async () => {
    // Seed an op pre-flushed to its retry budget.
    const id = await enqueue(baseInput());
    // Force attemptCount to MAX by replaying against permanent 503s.
    const { fetch: failFetch } = mockFetcher(
      Array.from({ length: MAX_ATTEMPTS }, () => new Response('', { status: 503 })),
    );
    await replayAll(failFetch, fakeWait());
    const exhausted = (await getOperation(id))!;
    expect(exhausted.attemptCount).toBe(MAX_ATTEMPTS);

    // Now a second drain should NOT call the fetcher for this op.
    const { fetch, calls } = mockFetcher([new Response('', { status: 200 })]);
    const results = await replayAll(fetch, fakeWait());
    expect(calls).toHaveLength(0);
    expect(results).toHaveLength(0);
    // Operation remains in the queue for the conflict UI.
    expect(await getOperation(id)).not.toBeNull();
  });

  it('matches the design backoff schedule of 1 s, 2 s, 4 s, 8 s, 16 s, 32 s, ..., capped at 5 minutes', () => {
    expect(BACKOFF_SCHEDULE_MS).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 128_000, 256_000,
      300_000,
    ]);
    // Spec says "max 5 min, up to 10 attempts".
    expect(MAX_ATTEMPTS).toBe(10);
    expect(BACKOFF_SCHEDULE_MS[BACKOFF_SCHEDULE_MS.length - 1]).toBe(5 * 60 * 1_000);
  });
});

// ─── 3. Permanent failures ───────────────────────────────────────────────────

describe('replayAll — permanent failures', () => {
  it('stops retrying on 400 and surfaces the error', async () => {
    const id = await enqueue(baseInput());
    const { fetch, calls } = mockFetcher([
      new Response('{"code":"BAD_REQUEST"}', {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    ]);
    const w = fakeWait();

    const [result] = await replayAll(fetch, { wait: w.wait });

    expect(calls).toHaveLength(1);
    expect(w.calls).toEqual([]); // no backoff on a permanent failure
    expect(result!.outcome).toBe('failed_permanent');
    expect(result!.status).toBe(400);
    expect(result!.error).toMatch(/status 400/);

    const op = await getOperation(id);
    expect(op).not.toBeNull();
    expect(op!.attemptCount).toBe(1);
    expect(op!.lastError).toMatch(/BAD_REQUEST/);
  });

  it('stops retrying on 409 (conflict) so the conflict dialog can take over', async () => {
    const id = await enqueue(baseInput());
    const { fetch } = mockFetcher([new Response('', { status: 409 })]);
    const [result] = await replayAll(fetch, fakeWait());
    expect(result!.outcome).toBe('failed_permanent');
    expect((await getOperation(id))!.lastError).toMatch(/status 409/);
  });
});

// ─── 4. Cooperative abort ────────────────────────────────────────────────────

describe('replayAll — abort signal', () => {
  it('stops at the next checkpoint when signal is aborted between ops', async () => {
    await enqueue(baseInput({ createdAt: '2024-01-01T00:00:00Z' }));
    await enqueue(baseInput({ createdAt: '2024-01-02T00:00:00Z' }));

    const controller = new AbortController();
    let i = 0;
    const fetch: typeof globalThis.fetch = async () => {
      i += 1;
      if (i === 1) controller.abort();
      return new Response('', { status: 200 });
    };

    const results = await replayAll(fetch, {
      wait: () => Promise.resolve(),
      signal: controller.signal,
    });

    // First op succeeds (and dequeues); we abort before the second.
    expect(results).toHaveLength(1);
    expect(results[0]!.outcome).toBe('succeeded');
    expect((await peekAll()).length).toBe(1);
  });
});

// ─── 5. Property tests (fast-check) ─────────────────────────────────────────

describe('replayAll — property tests', () => {
  /** Generator: a queue of 1..5 unique operations with strictly
   * increasing `createdAt` strings (ms-resolution UTC). Submission
   * order is the array order, which we deliberately shuffle on
   * insertion to ensure the queue sorts on `createdAt` and not on
   * insertion. */
  const opsArbitrary = fc
    .array(
      fc.record({
        targetId: fc.uuid(),
        bodyValue: fc.integer({ min: 0, max: 1000 }),
        idempotencyKey: fc.uuid(),
      }),
      { minLength: 1, maxLength: 5 },
    )
    .map((arr) => {
      const seen = new Set<string>();
      // De-duplicate idempotency keys (rare collision but the queue
      // contract is one key per op).
      return arr
        .filter((o) => {
          if (seen.has(o.idempotencyKey)) return false;
          seen.add(o.idempotencyKey);
          return true;
        })
        .map((o, i) => ({
          ...o,
          // Stagger by index so `createdAt` is strictly increasing.
          createdAt: new Date(1_700_000_000_000 + i * 1_000).toISOString(),
        }));
    });

  /**
   * Validates: Requirements 38.6 — operations replay in submission
   * (createdAt) order regardless of insertion order.
   */
  it('Property: submission order is preserved on full successful drain', async () => {
    await fc.assert(
      fc.asyncProperty(opsArbitrary, async (gen) => {
        await _resetForTests();
        // Insert in shuffled order to confirm the sort happens on
        // `createdAt` and not on insertion.
        const shuffled = [...gen].reverse();
        for (const op of shuffled) {
          await enqueue(
            baseInput({
              targetId: op.targetId,
              idempotencyKey: op.idempotencyKey,
              createdAt: op.createdAt,
              payload: {
                url: `/api/v1/x/${op.targetId}`,
                body: String(op.bodyValue),
              },
            }),
          );
        }

        const { fetch, calls } = mockFetcher(
          gen.map(() => new Response('', { status: 200 })),
        );
        await replayAll(fetch, fakeWait());

        const replayedKeys = calls.map((c) =>
          extractHeader(c.init?.headers, 'Idempotency-Key'),
        );
        const expectedKeys = [...gen]
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .map((o) => o.idempotencyKey);
        expect(replayedKeys).toEqual(expectedKeys);
        expect(await peekAll()).toEqual([]);
      }),
      { numRuns: 30 },
    );
  });

  /**
   * Validates: Requirements 38.7 — every replayed request carries its
   * own Idempotency-Key so the API_Gateway can deduplicate retries.
   */
  it('Property: every replayed request carries the operation Idempotency-Key', async () => {
    await fc.assert(
      fc.asyncProperty(opsArbitrary, async (gen) => {
        await _resetForTests();
        const idemByUrl = new Map<string, string>();
        for (const op of gen) {
          await enqueue(
            baseInput({
              targetId: op.targetId,
              idempotencyKey: op.idempotencyKey,
              createdAt: op.createdAt,
              payload: {
                url: `/api/v1/x/${op.targetId}`,
                body: String(op.bodyValue),
              },
            }),
          );
          idemByUrl.set(`/api/v1/x/${op.targetId}`, op.idempotencyKey);
        }

        const { fetch, calls } = mockFetcher(
          gen.map(() => new Response('', { status: 200 })),
        );
        await replayAll(fetch, fakeWait());

        for (const call of calls) {
          const expected = idemByUrl.get(call.url);
          expect(extractHeader(call.init?.headers, 'Idempotency-Key')).toBe(
            expected,
          );
        }
      }),
      { numRuns: 30 },
    );
  });
});
