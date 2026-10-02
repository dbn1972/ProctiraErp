/**
 * @vitest-environment node
 *
 * PRC-H027 follow-up — logout must still revoke the session upstream when the
 * request Host does not resolve a tenant, using the access token's own tenant
 * claim, and must never take the tenant from a client X-Tenant-ID header.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const cookieValues = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieValues.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
}));

import * as routeModule from './route';

const { POST } = routeModule;

function token(payload: Record<string, unknown>): string {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`;
}

function logoutRequest(host: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://${host}/api/auth/logout`, {
    method: 'POST',
    headers: { host, ...headers },
  });
}

let fetchMock: Mock<(...args: unknown[]) => Promise<Response>>;

beforeEach(() => {
  cookieValues.clear();
  fetchMock = vi.fn<(...args: unknown[]) => Promise<Response>>(
    async () => new Response('{}', { status: 200 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('TENANT_BASE_DOMAIN', 'proctira.io');
  vi.stubEnv('TENANT_FALLBACK_SLUG', '');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function upstreamTenant(): string | undefined {
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  return (init.headers as Record<string, string>)['X-Tenant-ID'];
}

describe('POST /api/auth/logout tenant for upstream revocation', () => {
  it('uses the Host tenant when it resolves', async () => {
    cookieValues.set('access_token', token({ sub: 'u', tenantId: 'other' }));
    const res = await POST(logoutRequest('acme.proctira.io'));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(upstreamTenant()).toBe('acme');
  });

  it('falls back to the access-token tenant claim when the Host does not resolve', async () => {
    cookieValues.set('access_token', token({ sub: 'u', tenantId: 'greenfield' }));
    const res = await POST(logoutRequest('localhost:3201', { 'x-tenant-id': 'attacker' }));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toMatch(/\/auth\/logout$/);
    expect(upstreamTenant()).toBe('greenfield');
  });

  it('skips upstream (but clears cookies) when neither Host nor token yields a tenant', async () => {
    cookieValues.set('access_token', 'not-a-jwt');
    const res = await POST(logoutRequest('localhost:3201', { 'x-tenant-id': 'attacker' }));
    expect(fetchMock).not.toHaveBeenCalled();
    const cleared = res.headers.getSetCookie().join(';');
    expect(cleared).toMatch(/access_token=;/);
    expect(cleared).toMatch(/refresh_token=;/);
  });
});

describe('GET /api/auth/logout (PRC-L259)', () => {
  it('is not exported, so a cross-site GET cannot sign the user out', () => {
    expect('GET' in routeModule).toBe(false);
  });
});
