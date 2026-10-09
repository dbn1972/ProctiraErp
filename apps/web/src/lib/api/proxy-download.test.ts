/**
 * apps/web/src/lib/api/proxy-download.test.ts
 *
 * NEW-g1a_web-002: proxy download helper applies a timeout, enforces a size
 * cap, streams the body, and maps upstream failures to a fixed error shape.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./gateway', () => ({
  GATEWAY_BASE_URL: 'http://gw',
  GATEWAY_API_PREFIX: '/api/v1',
  getSessionContext: vi.fn(async () => ({ tenantId: 'tenant-a', accessToken: 'tok-a' })),
}));

import { getSessionContext } from './gateway';
import { fetchFromGateway, proxyToGateway, ProxyError, PROXY_MAX_BYTES } from './proxy-download';

const sessionMock = vi.mocked(getSessionContext);

describe('proxyToGateway (NEW-g1a_web-002)', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    sessionMock.mockResolvedValue({ tenantId: 'tenant-a', accessToken: 'tok-a' });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('passes an AbortSignal (timeout) to the upstream fetch', async () => {
    fetchMock.mockResolvedValueOnce(new Response('ok', { status: 200 }));
    await proxyToGateway({ path: '/fees/reports/dues' });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.cache).toBe('no-store');
  });

  it('maps a timeout to 504 UPSTREAM_TIMEOUT', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'TimeoutError' }));
    const res = await proxyToGateway({ path: '/x' });
    expect(res.status).toBe(504);
    expect(await res.json()).toMatchObject({ code: 'UPSTREAM_TIMEOUT' });
  });

  it('maps a connection failure to 502 UPSTREAM_UNREACHABLE', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const res = await proxyToGateway({ path: '/x' });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: 'UPSTREAM_UNREACHABLE' });
  });

  it('rejects an oversized upstream with 413 before streaming', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('x', {
        status: 200,
        headers: { 'content-length': String(PROXY_MAX_BYTES + 1) },
      }),
    );
    const res = await proxyToGateway({ path: '/big' });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });

  it('fails closed with 401 when there is no session token', async () => {
    sessionMock.mockResolvedValueOnce({ tenantId: 'tenant-a', accessToken: null });
    const res = await proxyToGateway({ path: '/x' });
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('normalises upstream errors to a fixed shape, preserving status', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'nope' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const res = await proxyToGateway({ path: '/x' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: 'UPSTREAM_ERROR', message: 'nope' });
  });

  it('streams a successful body and copies safe headers', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('a,b\n', {
        status: 200,
        headers: {
          'content-type': 'text/csv',
          'content-disposition': 'attachment; filename="x.csv"',
        },
      }),
    );
    const res = await proxyToGateway({ path: '/x' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('a,b\n');
    expect(res.headers.get('content-type')).toBe('text/csv');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });
});

describe('fetchFromGateway (NEW-g1a_web-002)', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    sessionMock.mockResolvedValue({ tenantId: 'tenant-a', accessToken: 'tok-a' });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('applies a timeout signal and returns the raw response', async () => {
    fetchMock.mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const res = await fetchFromGateway('/x');
    expect(res.status).toBe(200);
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('throws ProxyError(413) on oversize', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('x', {
        status: 200,
        headers: { 'content-length': String(PROXY_MAX_BYTES + 1) },
      }),
    );
    await expect(fetchFromGateway('/x')).rejects.toMatchObject({
      name: 'ProxyError',
      status: 413,
    });
  });

  it('throws ProxyError(504) on timeout', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'TimeoutError' }));
    await expect(fetchFromGateway('/x')).rejects.toBeInstanceOf(ProxyError);
  });
});
