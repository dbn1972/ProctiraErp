// @vitest-environment node
/**
 * PRC-L265: the server gateway client takes the tenant only from the
 * verified token claim (or, for anonymous calls, the middleware's Host-derived
 * header). Base fell back to the `x-tenant-id` request header and then to the
 * literal `'default'` and still sent the request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetShellTokenVerifierCache } from '@proctira/auth';
import {
  TEST_JWKS_ENV,
  TEST_JWKS_URI,
  forgedToken,
  signedToken,
  withTestJwks,
} from '@/lib/auth/jwks-test-fixture';

const cookieJar = new Map<string, string>();
const requestHeaders = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)! } : undefined),
  }),
  headers: async () => ({ get: (name: string) => requestHeaders.get(name) ?? null }),
}));

const gatewayCalls: Array<{ url: string; headers: Headers }> = [];
const fetchMock = vi.fn(
  withTestJwks(async (input, init) => {
    gatewayCalls.push({ url: String(input), headers: new Headers(init?.headers) });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }),
);

beforeEach(() => {
  cookieJar.clear();
  requestHeaders.clear();
  gatewayCalls.length = 0;
  __resetShellTokenVerifierCache();
  vi.stubGlobal('fetch', fetchMock);
  for (const [k, v] of Object.entries(TEST_JWKS_ENV)) vi.stubEnv(k, v);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function call() {
  const { gatewayFetch } = await import('./gateway');
  return gatewayFetch('/students', { throwOnError: false });
}

describe('gatewayFetch tenant source (PRC-L265)', () => {
  it('uses the verified claim and ignores a different x-tenant-id header', async () => {
    cookieJar.set('access_token', signedToken({ tenantId: 'tenant-a' }));
    requestHeaders.set('x-tenant-id', 'tenant-b');
    await call();
    expect(gatewayCalls).toHaveLength(1);
    expect(gatewayCalls[0]!.headers.get('X-Tenant-ID')).toBe('tenant-a');
  });

  it('reads the Keycloak tenant_id claim', async () => {
    cookieJar.set('access_token', signedToken({ tenantId: undefined, tenant_id: 'tenant-k' }));
    requestHeaders.set('x-tenant-id', 'tenant-b');
    await call();
    expect(gatewayCalls[0]!.headers.get('X-Tenant-ID')).toBe('tenant-k');
  });

  it('refuses a verified token without a tenant claim instead of using the header', async () => {
    cookieJar.set('access_token', signedToken({ tenantId: undefined }));
    requestHeaders.set('x-tenant-id', 'tenant-b');
    const res = await call();
    expect(gatewayCalls).toHaveLength(0);
    expect(res).toMatchObject({ ok: false, status: 401, error: { code: 'TENANT_UNRESOLVED' } });
  });

  it('refuses a multi-valued tenant claim', async () => {
    cookieJar.set('access_token', signedToken({ tenantId: undefined, tenant_id: ['a', 'b'] }));
    await call();
    expect(gatewayCalls).toHaveLength(0);
  });

  it('never forwards a forged token or its tenant', async () => {
    cookieJar.set('access_token', forgedToken({ tenantId: 'tenant-b' }));
    await call();
    expect(gatewayCalls).toHaveLength(0);
  });

  it('refuses an anonymous call with no host tenant (no "default")', async () => {
    const res = await call();
    expect(gatewayCalls).toHaveLength(0);
    expect(res.ok).toBe(false);
  });

  it('sends an anonymous call with the middleware Host-derived tenant, no bearer', async () => {
    requestHeaders.set('x-tenant-id', 'acme');
    await call();
    expect(gatewayCalls).toHaveLength(1);
    expect(gatewayCalls[0]!.headers.get('X-Tenant-ID')).toBe('acme');
    expect(gatewayCalls[0]!.headers.get('Authorization')).toBeNull();
    expect(gatewayCalls[0]!.url).not.toBe(TEST_JWKS_URI);
  });
});
