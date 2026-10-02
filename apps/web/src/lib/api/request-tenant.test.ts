/**
 * PRC-H027: BFF auth routes must derive the tenant from the Host, ignore a
 * client-supplied X-Tenant-ID, and fail closed (400) instead of falling back
 * to a shared 'default' tenant.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));

import { resolveTenantForRequest } from './request-tenant';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import { POST as signupPOST } from '@/app/api/auth/signup/route';
import { POST as forgotPOST } from '@/app/api/auth/forgot-password/route';
import { GET as signupRolesGET } from '@/app/api/tenant/signup-roles/route';
import { handleApiRequest } from '@/middleware';

function post(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function upstreamTenant(fetchMock: ReturnType<typeof vi.fn>): string | undefined {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
  return (init?.headers as Record<string, string> | undefined)?.['X-Tenant-ID'];
}

const SIGNUP_BODY = {
  fullName: 'Test User',
  email: 'user@example.org',
  password: 'Tr0ub4dor&3xQrSt',
  institutionName: 'Example School',
  roleId: 'principal',
  termsAcceptance: {
    acceptedAt: '2025-01-01T00:00:00.000Z',
    termsVersion: 'tos-2025-01-15',
    privacyVersion: 'privacy-2025-01-15',
  },
};

describe('PRC-H027 — Host-derived tenant for auth BFF routes', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    delete process.env.TENANT_FALLBACK_SLUG;
    process.env.TENANT_BASE_DOMAIN = 'proctira.io';
    fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'nope' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.TENANT_FALLBACK_SLUG;
    delete process.env.TENANT_BASE_DOMAIN;
  });

  it('resolveTenantForRequest ignores a client X-Tenant-ID header', () => {
    const req = new Request('http://acme.proctira.io/api/auth/login', {
      headers: { 'X-Tenant-ID': 'other' },
    });
    expect(resolveTenantForRequest(req)).toBe('acme');
    const unknown = new Request('http://localhost/api/auth/login', {
      headers: { 'X-Tenant-ID': 'other' },
    });
    expect(resolveTenantForRequest(unknown)).toBeNull();
  });

  it('login on acme.proctira.io with spoofed X-Tenant-ID sends X-Tenant-ID=acme upstream', async () => {
    await loginPOST(
      post(
        'http://acme.proctira.io/api/auth/login',
        { email: 'a@b.c', password: 'x' },
        { 'X-Tenant-ID': 'other' },
      ),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(upstreamTenant(fetchMock)).toBe('acme');
  });

  it('login from an unknown host returns 400 and never calls upstream with default', async () => {
    const res = await loginPOST(
      post('http://localhost/api/auth/login', { email: 'a@b.c', password: 'x' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('TENANT_REQUIRED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('signup with a spoofed header cannot target another tenant', async () => {
    await signupPOST(
      post('http://acme.proctira.io/api/auth/signup', SIGNUP_BODY, { 'X-Tenant-ID': 'victim' }),
    );
    expect(upstreamTenant(fetchMock)).toBe('acme');

    fetchMock.mockClear();
    const res = await signupPOST(
      post('http://localhost/api/auth/signup', SIGNUP_BODY, { 'X-Tenant-ID': 'victim' }),
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forgot-password and signup-roles fail closed on an unknown host', async () => {
    const fp = await forgotPOST(
      post('http://localhost/api/auth/forgot-password', { email: 'a@b.c' }, { 'X-Tenant-ID': 'x' }),
    );
    expect(fp.status).toBe(400);
    const roles = await signupRolesGET(
      new Request('http://localhost/api/tenant/signup-roles', { headers: { 'X-Tenant-ID': 'x' } }),
    );
    expect(roles.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the operator-configured TENANT_FALLBACK_SLUG for single-tenant hosts', async () => {
    process.env.TENANT_FALLBACK_SLUG = 'school-one';
    await loginPOST(
      post(
        'http://localhost/api/auth/login',
        { email: 'a@b.c', password: 'x' },
        { 'X-Tenant-ID': 'other' },
      ),
    );
    expect(upstreamTenant(fetchMock)).toBe('school-one');
  });

  it('middleware overwrites a spoofed X-Tenant-ID on forwarded /api requests', () => {
    const req = new NextRequest('http://acme.proctira.io/api/tenant/signup-roles', {
      headers: { 'X-Tenant-ID': 'other' },
    });
    const res = handleApiRequest(req);
    expect(res.headers.get('x-middleware-request-x-tenant-id')).toBe('acme');
  });
});
