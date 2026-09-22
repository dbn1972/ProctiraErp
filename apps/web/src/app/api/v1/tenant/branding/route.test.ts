/**
 * @vitest-environment node
 *
 * GET /api/v1/tenant/branding — the same-origin route `BrandConfigProvider` fetches.
 *
 * The regression this guards is invisible at runtime: the provider swallows any
 * non-ok response and falls back to DEFAULT_BRAND, so when this route did not exist
 * the only symptom was a 404 in the network log and every tenant silently getting
 * the default theme. Nothing threw, so no test failed.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BRAND_ENDPOINT } from '@/providers/BrandConfigProvider';

const getSessionContextMock = vi.fn();

vi.mock('@/lib/api/gateway', () => ({
  GATEWAY_BASE_URL: 'http://gateway.test',
  GATEWAY_API_PREFIX: '/api/v1',
  getSessionContext: () => getSessionContextMock(),
}));

import { GET } from './route';

describe('GET /api/v1/tenant/branding', () => {
  beforeEach(() => {
    getSessionContextMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('is served at the path BrandConfigProvider fetches', () => {
    // The provider fetches a bare path, so a rename on either side reintroduces the
    // 404 with no compile error. Assert the constant and the file agree.
    expect(BRAND_ENDPOINT).toBe('/api/v1/tenant/branding');
    const routeFile = path.join(process.cwd(), 'src/app', BRAND_ENDPOINT, 'route.ts');
    expect(existsSync(routeFile)).toBe(true);
  });

  it('returns 204 for an anonymous visitor instead of 401', async () => {
    // The provider runs on public marketing pages too. A 401 on every one of them
    // would be misleading noise; 204 says "no tenant branding applies here".
    getSessionContextMock.mockResolvedValue({ tenantId: 'default', accessToken: null });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const res = await GET();

    expect(res.status).toBe(204);
    // No pointless upstream call for a request that cannot resolve a tenant.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('forwards the session token and its own tenant claim to the gateway', async () => {
    getSessionContextMock.mockResolvedValue({
      tenantId: '00000000-0000-4000-8000-00000000ce27',
      accessToken: 'tok-123',
    });
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ tokens: { colorPrimary: '#123456' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ tokens: { colorPrimary: '#123456' } });
    // Branding changes on publish and the provider keeps its own TTL.
    expect(res.headers.get('cache-control')).toBe('no-store');

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://gateway.test/api/v1/tenant/branding');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tok-123');
    // The tenant is the session's own claim — a caller cannot ask for another one,
    // because GET takes no arguments and never reads the incoming request.
    expect(headers['X-Tenant-ID']).toBe('00000000-0000-4000-8000-00000000ce27');
  });

  it('passes an upstream failure status through rather than masking it as success', async () => {
    getSessionContextMock.mockResolvedValue({ tenantId: 't1', accessToken: 'tok' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'NOT_FOUND' } }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const res = await GET();

    // The provider decides what to do with a non-ok status; inventing a 200 with
    // default tokens here would hide a real gateway problem.
    expect(res.status).toBe(404);
  });

  it('returns 503 when the gateway is unreachable instead of throwing a 500', async () => {
    getSessionContextMock.mockResolvedValue({ tenantId: 't1', accessToken: 'tok' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const res = await GET();

    expect(res.status).toBe(503);
  });
});
