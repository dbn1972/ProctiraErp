/**
 * PRC-M134: the shared gateway proxy helper must bound the upstream call with a
 * timeout (504), cap the buffered body (413), map transport failures to 502,
 * reject unsafe paths (400) and unauthenticated callers (401).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getSessionContext = vi.fn();
vi.mock('@/lib/api/gateway', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/gateway')>('@/lib/api/gateway');
  return { ...actual, getSessionContext: (...a: unknown[]) => getSessionContext(...a) };
});

import { proxyToGateway } from './gateway-proxy';

const ORIGINAL_FETCH = global.fetch;

function req(method: string, body?: BodyInit): Request {
  return new Request('https://app.example.com/api/scholarships/programs', {
    method,
    ...(body ? { body } : {}),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  getSessionContext.mockReset();
  getSessionContext.mockResolvedValue({ tenantId: 't-1', accessToken: 'tok' });
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe('proxyToGateway (PRC-M134)', () => {
  it('rejects path traversal with 400 and never calls upstream', async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    const res = await proxyToGateway(req('GET'), ['..', 'secrets'], { prefix: 'scholarships' });
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 401 when there is no session token', async () => {
    getSessionContext.mockResolvedValue({ tenantId: 't-1', accessToken: null });
    const res = await proxyToGateway(req('GET'), ['programs'], { prefix: 'scholarships' });
    expect(res.status).toBe(401);
  });

  it('maps an upstream timeout to 504', async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValue(new DOMException('timeout', 'TimeoutError')) as unknown as typeof fetch;
    const res = await proxyToGateway(req('GET'), ['programs'], { prefix: 'scholarships' });
    expect(res.status).toBe(504);
    expect((await res.json()).code).toBe('GATEWAY_TIMEOUT');
  });

  it('maps a transport failure to 502', async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValue(new TypeError('connect ECONNREFUSED')) as unknown as typeof fetch;
    const res = await proxyToGateway(req('GET'), ['programs'], { prefix: 'scholarships' });
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe('BAD_GATEWAY');
  });

  it('rejects an oversized body with 413 before calling upstream', async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    const big = 'x'.repeat(1024);
    const res = await proxyToGateway(req('POST', big), ['programs'], {
      prefix: 'scholarships',
      maxBodyBytes: 10,
    });
    expect(res.status).toBe(413);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('forwards a successful upstream response with a bounded signal', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    global.fetch = fetchSpy as unknown as typeof fetch;
    const res = await proxyToGateway(req('GET'), ['programs'], { prefix: 'scholarships' });
    expect(res.status).toBe(200);
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect((fetchSpy.mock.calls[0]![0] as URL).toString()).toContain('/scholarships/programs');
  });
});
