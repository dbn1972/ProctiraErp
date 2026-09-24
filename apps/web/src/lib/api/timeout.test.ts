/**
 * V15 — a hung gateway must produce a failure, not an indefinite spinner.
 *
 * Before this, neither gateway client had any deadline: no `AbortController`, no
 * `AbortSignal.timeout`, no race. The gateway sets no `requestTimeout` either, so nothing
 * on either side would abandon a hung request.
 *
 * These tests drive `createTimeout` directly and through `browserGatewayFetch` with a
 * `fetch` that never settles, because that is the condition that had no test and no
 * handling.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NETWORK_ERROR_CODE, TIMEOUT_ERROR_CODE, createTimeout } from './timeout';

describe('createTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('aborts once the budget elapses', async () => {
    vi.useFakeTimers();
    const timeout = createTimeout(1_000);
    expect(timeout.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1_000);
    expect(timeout.signal.aborted).toBe(true);
    timeout.clear();
  });

  it('reports an elapsed budget as TIMEOUT, naming the budget', async () => {
    vi.useFakeTimers();
    const timeout = createTimeout(5_000);
    vi.advanceTimersByTime(5_000);
    const failure = timeout.classify(
      Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
    );
    expect(failure.code).toBe(TIMEOUT_ERROR_CODE);
    expect(failure.message).toContain('5s');
    timeout.clear();
  });

  it('separates a caller cancellation from a deadline', () => {
    // `fetch` reports both as AbortError, so the deadline flag is the only discriminator.
    // A user navigating away is not a failure to show anyone.
    const caller = new AbortController();
    const timeout = createTimeout(60_000, caller.signal);
    caller.abort();
    expect(timeout.signal.aborted).toBe(true);
    const failure = timeout.classify(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    expect(failure.code).toBe(NETWORK_ERROR_CODE);
    expect(failure.message).toBe('Request was cancelled.');
    timeout.clear();
  });

  it('honours a signal that was already aborted before the call', () => {
    const caller = new AbortController();
    caller.abort();
    const timeout = createTimeout(60_000, caller.signal);
    expect(timeout.signal.aborted).toBe(true);
    timeout.clear();
  });

  it('keeps a genuine transport error as NETWORK_ERROR', () => {
    const timeout = createTimeout(60_000);
    const failure = timeout.classify(new TypeError('fetch failed'));
    expect(failure.code).toBe(NETWORK_ERROR_CODE);
    expect(failure.message).toBe('fetch failed');
    timeout.clear();
  });

  it('treats a non-positive budget as no deadline', () => {
    // So a caller can opt out for a genuinely long-running export without reaching for
    // Infinity or a sentinel.
    vi.useFakeTimers();
    const timeout = createTimeout(0);
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(timeout.signal.aborted).toBe(false);
    timeout.clear();
  });

  it('releases the timer so a pending deadline cannot delay process exit', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const timeout = createTimeout(30_000);
    timeout.clear();
    expect(clearSpy).toHaveBeenCalled();
  });
});

describe('browserGatewayFetch deadline', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('rejects with TIMEOUT when the gateway never answers', async () => {
    // The exact condition with no previous handling: a fetch that hangs. Resolved only by
    // the abort signal, so if the deadline were missing this test would hang rather than
    // fail — which is precisely what a user experienced.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
            );
          }),
      ),
    );

    const { browserGatewayFetch, BrowserGatewayError } = await import('./browser-gateway');

    await expect(browserGatewayFetch('/slow', { timeoutMs: 10 })).rejects.toMatchObject({
      code: TIMEOUT_ERROR_CODE,
      status: 0,
    });
    await expect(browserGatewayFetch('/slow', { timeoutMs: 10 })).rejects.toBeInstanceOf(
      BrowserGatewayError,
    );
  });

  it('passes an abort signal to fetch on every call', async () => {
    // Parameters are declared so `mock.calls[0][1]` is typed as the init object rather
    // than as an element of an empty tuple.
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { browserGatewayFetch } = await import('./browser-gateway');
    await browserGatewayFetch('/fast');

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});
