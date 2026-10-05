/**
 * PRC-M057: the public sign-up role catalog must not fall back to a
 * hard-coded list (which offered admin/principal) when the tenant service
 * is unavailable.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { GET } from './route';

function makeRequest(): Request {
  return new Request('http://acme.proctira.io/api/tenant/signup-roles', { method: 'GET' });
}

describe('GET /api/tenant/signup-roles (PRC-M057)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns 503 with no roles when the tenant service is down', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const response = await GET(makeRequest());
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.roles).toEqual([]);
    expect(body.code).toBe('SIGNUP_ROLES_UNAVAILABLE');
  });

  it('returns 503 when the upstream errors or returns an empty catalog', async () => {
    fetchMock.mockResolvedValueOnce(new Response('oops', { status: 500 }));
    expect((await GET(makeRequest())).status).toBe(503);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ roles: [] }), { status: 200 }));
    expect((await GET(makeRequest())).status).toBe(503);
  });

  it('passes through the upstream catalog', async () => {
    const roles = [{ id: 'parent', label: 'Parent' }];
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ roles }), { status: 200 }));
    const response = await GET(makeRequest());
    expect(response.status).toBe(200);
    expect((await response.json()).roles).toEqual(roles);
  });
});
