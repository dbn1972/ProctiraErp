/**
 * PRC-L544: Sync_Queue replay is single-flight, pauses on 401/403 without
 * spending attempts, parks permanent 4xx so they are not resent forever, and
 * sends the CSRF double-submit header with same-origin credentials.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MAX_ATTEMPTS, replayAll } from '../replay';
import { _resetForTests, enqueue, getOperation } from '../syncQueue';

const noWait = { wait: () => Promise.resolve() };

const input = (createdAt: string, key: string) => ({
  tenantId: 't-1',
  userId: 'u-1',
  operationType: 'POST' as const,
  targetEntity: 'attendance',
  createdAt,
  idempotencyKey: key,
  payload: { url: '/api/attendance/mark', body: '{"x":1}' },
});

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function fetcher(statuses: number[]): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  let i = 0;
  const fn: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const status = statuses[i] ?? 200;
    i += 1;
    return new Response('{}', { status });
  };
  return { fetch: fn, calls };
}

beforeEach(async () => {
  await _resetForTests();
  document.cookie = 'csrf_token=csrf-abc; path=/';
});

afterEach(async () => {
  await _resetForTests();
  document.cookie = 'csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
});

describe('replayAll auth, CSRF and single-flight (PRC-L544)', () => {
  it('pauses the drain on 401 without spending an attempt; the next drain resumes', async () => {
    const first = await enqueue(input('2024-01-01T00:00:00Z', 'k-1'));
    const second = await enqueue(input('2024-01-02T00:00:00Z', 'k-2'));
    const run1 = fetcher([401]);
    const results = await replayAll(run1.fetch, noWait);

    expect(run1.calls).toHaveLength(1);
    expect(results).toEqual([expect.objectContaining({ id: first, outcome: 'paused_auth' })]);
    expect((await getOperation(first))!.attemptCount).toBe(0);
    expect((await getOperation(second))!.attemptCount).toBe(0);

    const run2 = fetcher([200, 200]);
    await replayAll(run2.fetch, noWait);
    expect(run2.calls).toHaveLength(2);
    expect(await getOperation(first)).toBeNull();
    expect(await getOperation(second)).toBeNull();
  });

  it('treats 403 the same way', async () => {
    const id = await enqueue(input('2024-01-01T00:00:00Z', 'k-1'));
    const [result] = await replayAll(fetcher([403]).fetch, noWait);
    expect(result!.outcome).toBe('paused_auth');
    expect((await getOperation(id))!.attemptCount).toBe(0);
  });

  it('parks a permanent 422 so a later drain does not resend it', async () => {
    const id = await enqueue(input('2024-01-01T00:00:00Z', 'k-1'));
    await replayAll(fetcher([422]).fetch, noWait);
    expect((await getOperation(id))!.attemptCount).toBe(MAX_ATTEMPTS);

    const again = fetcher([200]);
    await replayAll(again.fetch, noWait);
    expect(again.calls).toHaveLength(0);
  });

  it('sends the CSRF header and same-origin credentials', async () => {
    await enqueue(input('2024-01-01T00:00:00Z', 'k-1'));
    const run = fetcher([200]);
    await replayAll(run.fetch, noWait);
    const init = run.calls[0]!.init!;
    expect(new Headers(init.headers).get('x-csrf-token')).toBe('csrf-abc');
    expect(init.credentials).toBe('same-origin');
  });

  it('never sends the CSRF token to an absolute (other-origin) URL', async () => {
    await enqueue({
      ...input('2024-01-01T00:00:00Z', 'k-1'),
      payload: { url: 'https://other.example/api', body: '{}' },
    });
    const run = fetcher([200]);
    await replayAll(run.fetch, noWait);
    expect(new Headers(run.calls[0]!.init!.headers).get('x-csrf-token')).toBeNull();
  });

  it('concurrent drains share one run (no double send)', async () => {
    await enqueue(input('2024-01-01T00:00:00Z', 'k-1'));
    const run = fetcher([200]);
    const [a, b] = await Promise.all([replayAll(run.fetch, noWait), replayAll(run.fetch, noWait)]);
    expect(run.calls).toHaveLength(1);
    expect(a).toBe(b);
  });
});
