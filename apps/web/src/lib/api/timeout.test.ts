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

/**
 * V15-12 / V15-13 — both clients ran every non-2xx through one branch, so a rate limit, an
 * oversized upload and a server fault were indistinguishable to a call site. The gateway
 * already sends `Retry-After` on a 429 and nothing read it.
 */
describe('classifyStatusFailure', () => {
  const headers = (map: Record<string, string> = {}) => ({
    get: (name: string) => map[name.toLowerCase()] ?? null,
  });

  it('parses Retry-After as delta-seconds and puts it in the message', async () => {
    const { classifyStatusFailure } = await import('./timeout');
    const failure = classifyStatusFailure(
      { status: 429, headers: headers({ 'retry-after': '42' }) },
      null,
    );
    expect(failure.retryAfterSeconds).toBe(42);
    expect(failure.message).toContain('42s');
  });

  it('parses Retry-After as an HTTP-date', async () => {
    const { parseRetryAfter } = await import('./timeout');
    const now = Date.parse('2026-09-24T10:00:00Z');
    expect(parseRetryAfter('Thu, 24 Sep 2026 10:00:30 GMT', now)).toBe(30);
  });

  it('treats a past or unparseable Retry-After as no guidance, not as zero', async () => {
    // `0` would read as "retry immediately", which is the opposite of what a stale date
    // means.
    const { parseRetryAfter } = await import('./timeout');
    const now = Date.parse('2026-09-24T10:00:00Z');
    expect(parseRetryAfter('Thu, 24 Sep 2026 09:59:00 GMT', now)).toBeUndefined();
    expect(parseRetryAfter('soon', now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
  });

  it('still names the wait as unknown when a 429 carries no Retry-After', async () => {
    const { classifyStatusFailure, RATE_LIMITED_ERROR_CODE } = await import('./timeout');
    const failure = classifyStatusFailure({ status: 429, headers: headers() }, null);
    expect(failure.code).toBe(RATE_LIMITED_ERROR_CODE);
    expect(failure.retryAfterSeconds).toBeUndefined();
    expect(failure.message).toMatch(/wait a moment/i);
  });

  it('gives a 413 a cause a user can act on', async () => {
    // Usually produced by a proxy before the app is reached, so there is no envelope and
    // the old generic text said nothing about size.
    const { classifyStatusFailure, PAYLOAD_TOO_LARGE_ERROR_CODE } = await import('./timeout');
    const failure = classifyStatusFailure({ status: 413, headers: headers() }, null);
    expect(failure.code).toBe(PAYLOAD_TOO_LARGE_ERROR_CODE);
    expect(failure.message).toMatch(/too large/i);
  });

  it("prefers the gateway's own code and message when it sent an envelope", async () => {
    // The envelope is the contract; this helper only fills gaps.
    const { classifyStatusFailure } = await import('./timeout');
    const failure = classifyStatusFailure(
      { status: 403, headers: headers() },
      {
        code: 'INSTITUTION_OUT_OF_SCOPE',
        message: 'That institution is outside your scope.',
      },
    );
    expect(failure.code).toBe('INSTITUTION_OUT_OF_SCOPE');
    expect(failure.message).toBe('That institution is outside your scope.');
  });

  it('falls back to a plain message when there is no envelope at all', async () => {
    // e.g. an HTML 502 from a proxy: `payload` is null because it is not JSON.
    const { classifyStatusFailure } = await import('./timeout');
    const failure = classifyStatusFailure({ status: 502, headers: headers() }, null);
    expect(failure.code).toBe('GATEWAY_ERROR');
    expect(failure.message).not.toContain('undefined');
  });
});

/**
 * V15-11 — a 401 arriving mid-interaction had no handling. The error was thrown and, with
 * no toast system mounted, usually vanished; the user kept clicking a control that did
 * nothing until the next navigation bounced them to the login page with no explanation.
 */
describe('session expiry notification', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('raises a subscribable event when the gateway reports 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ code: 'UNAUTHORIZED', message: 'Authentication required' }),
            {
              status: 401,
              headers: { 'content-type': 'application/json' },
            },
          ),
      ),
    );

    const { browserGatewayFetch, SESSION_EXPIRED_EVENT } = await import('./browser-gateway');

    const seen: unknown[] = [];
    const listener = (event: Event) => seen.push((event as CustomEvent).detail);
    window.addEventListener(SESSION_EXPIRED_EVENT, listener);

    await expect(browserGatewayFetch('/students')).rejects.toMatchObject({ status: 401 });

    window.removeEventListener(SESSION_EXPIRED_EVENT, listener);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('does not raise it for a 403, which is a permission answer and not an expiry', async () => {
    // Conflating them would bounce a user to the login page for a record they are simply
    // not allowed to touch — and signing in again would not change the answer.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: 'FORBIDDEN', message: 'Access denied' }), {
            status: 403,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );

    const { browserGatewayFetch, SESSION_EXPIRED_EVENT } = await import('./browser-gateway');

    const seen: unknown[] = [];
    const listener = () => seen.push(1);
    window.addEventListener(SESSION_EXPIRED_EVENT, listener);

    await expect(browserGatewayFetch('/students')).rejects.toMatchObject({ status: 403 });

    window.removeEventListener(SESSION_EXPIRED_EVENT, listener);
    expect(seen).toHaveLength(0);
  });

  it('still throws the original error when the event cannot be dispatched', async () => {
    // The 401 must reach the caller even if the notification path fails.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: 'UNAUTHORIZED', message: 'nope' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    vi.stubGlobal('CustomEvent', function BrokenCustomEvent() {
      throw new Error('CustomEvent unavailable');
    });

    const { browserGatewayFetch } = await import('./browser-gateway');
    await expect(browserGatewayFetch('/students')).rejects.toMatchObject({ status: 401 });
  });
});
