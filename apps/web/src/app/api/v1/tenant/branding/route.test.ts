/**
 * @vitest-environment node
 *
 * GET /api/v1/tenant/branding — the same-origin route `BrandConfigProvider` fetches.
 *
 * The regression this guards is invisible at runtime: the provider swallows any
 * non-ok response and falls back to DEFAULT_BRAND, so when this route did not exist
 * the only symptom was a 404 in the network log and every tenant silently getting
 * the default theme. Nothing threw, so no test failed.
 *
 * Only `next/headers` is mocked. The tenant-resolution code under test is the real
 * thing, because "the caller cannot choose the tenant" is the security property of
 * this route and stubbing the resolver would leave it unasserted.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTH_COOKIES } from '@/lib/auth';
import { BRAND_ENDPOINT } from '@/providers/BrandConfigProvider';

const cookieValues = new Map<string, string>();
const headerValues = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const value = cookieValues.get(name);
        return value === undefined ? undefined : { name, value };
      },
    }),
  headers: () =>
    Promise.resolve({
      get: (name: string) => headerValues.get(name.toLowerCase()) ?? null,
    }),
}));

vi.mock('@/lib/api/gateway', () => ({
  GATEWAY_BASE_URL: 'http://gateway.test',
  GATEWAY_API_PREFIX: '/api/v1',
}));

import { GET } from './route';

/** A syntactically real HS256 token, so `decodeTokenPayload` does actual work. */
function signlessToken(payload: Record<string, unknown>): string {
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.signature`;
}

describe('GET /api/v1/tenant/branding', () => {
  beforeEach(() => {
    cookieValues.clear();
    headerValues.clear();
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
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const res = await GET();

    expect(res.status).toBe(204);
    // No pointless upstream call for a request that cannot resolve a tenant.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('forwards the session token and the tenant claim from its cookie', async () => {
    cookieValues.set(
      AUTH_COOKIES.ACCESS_TOKEN,
      signlessToken({ sub: 'u1', tenantId: '00000000-0000-4000-8000-00000000ce27' }),
    );
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ tokens: { '--tenant-primary': '#123456' }, revision: 2 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      tokens: { '--tenant-primary': '#123456' },
      revision: 2,
    });
    // Branding changes on publish and the provider keeps its own TTL.
    expect(res.headers.get('cache-control')).toBe('no-store');

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://gateway.test/api/v1/tenant/branding');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toMatch(/^Bearer /);
    expect(headers['X-Tenant-ID']).toBe('00000000-0000-4000-8000-00000000ce27');
  });

  it('ignores a client-supplied X-Tenant-ID header', async () => {
    // The middleware returns early for /api paths, so an inbound X-Tenant-ID is
    // whatever the caller sent. `getSessionContext` would fall back to it (and then
    // to the literal 'default'); this route must not.
    headerValues.set('x-tenant-id', 'aaaaaaaa-0000-4000-8000-0000000000aa');
    cookieValues.set(AUTH_COOKIES.ACCESS_TOKEN, signlessToken({ sub: 'u1' }));
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      );
    vi.stubGlobal('fetch', fetchSpy);

    await GET();

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    // Omitted entirely rather than forwarded or replaced with a placeholder.
    expect(headers['X-Tenant-ID']).toBeUndefined();
  });

  it('passes an upstream failure status through rather than masking it as success', async () => {
    cookieValues.set(AUTH_COOKIES.ACCESS_TOKEN, signlessToken({ sub: 'u1', tenantId: 't1' }));
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

  it('returns 503 when the gateway is unreachable, and says where it tried', async () => {
    cookieValues.set(AUTH_COOKIES.ACCESS_TOKEN, signlessToken({ sub: 'u1', tenantId: 't1' }));
    const failure = new Error('fetch failed', { cause: new Error('connect ECONNREFUSED') });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await GET();

    expect(res.status).toBe(503);
    // The provider swallows this response by design, so this log line is the only
    // thing that distinguishes "the gateway is down" from "branding is misconfigured".
    // A bare `fetch failed` is unactionable, which is why the cause is included —
    // it is what identified a wrong baked-in NEXT_PUBLIC_GATEWAY_URL in practice.
    const [message, detail, cause] = logged.mock.calls[0] as string[];
    expect(message).toContain('http://gateway.test');
    expect(detail).toBe('fetch failed');
    expect(cause).toContain('ECONNREFUSED');
    logged.mockRestore();
  });
});
