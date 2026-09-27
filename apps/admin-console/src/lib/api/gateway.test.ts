import { beforeEach, describe, expect, it, vi } from 'vitest';

const cookieState = vi.hoisted(() => ({ token: null as string | null }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'admin_access_token' && cookieState.token ? { value: cookieState.token } : undefined,
  }),
}));

import { GatewayError, gatewayFetch, getAdminContext } from './gateway';

function jwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

describe('gatewayFetch', () => {
  beforeEach(() => {
    cookieState.token = jwt({ tenantId: 'platform', exp: 9_999_999_999 });
    vi.stubGlobal('fetch', vi.fn());
  });

  it('reads the session tenant from the access token', async () => {
    cookieState.token = jwt({ tenantId: 'tnt_001' });
    await expect(getAdminContext()).resolves.toMatchObject({ tenantId: 'tnt_001' });
    cookieState.token = null;
    await expect(getAdminContext()).resolves.toMatchObject({
      accessToken: null,
      tenantId: 'platform',
    });
  });

  it('returns JSON from a successful gateway response', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ id: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const result = await gatewayFetch<{ id: string }>('/tenants', {
      method: 'POST',
      json: { name: 'North' },
      tenantId: 'tnt_009',
    });

    expect(result).toMatchObject({ ok: true, status: 200, data: { id: 'ok' } });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain('/api/v1/tenants');
    expect((init?.headers as Headers).get('X-Tenant-ID')).toBe('tnt_009');
    expect((init?.headers as Headers).get('Authorization')).toMatch(/^Bearer /);
    expect(init?.body).toBe(JSON.stringify({ name: 'North' }));
  });

  it('returns a network error envelope and can throw', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('offline'));
    const quiet = await gatewayFetch('/health');
    expect(quiet).toMatchObject({ status: 0, ok: false, error: { code: 'NETWORK_ERROR' } });

    vi.mocked(fetch).mockRejectedValue('boom');
    await expect(gatewayFetch('/health', { throwOnError: true })).rejects.toBeInstanceOf(
      GatewayError,
    );
  });

  it('maps HTTP errors and empty JSON bodies', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'NOPE', message: 'denied' }), {
        status: 403,
        statusText: 'Forbidden',
        headers: { 'content-type': 'application/json' },
      }),
    );
    const denied = await gatewayFetch('/plugins');
    expect(denied.error).toMatchObject({ code: 'NOPE', message: 'denied' });

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('not-json', {
        status: 500,
        statusText: '',
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect(gatewayFetch('/plugins', { throwOnError: true })).rejects.toMatchObject({
      status: 500,
      message: 'Gateway request failed',
    });

    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 502, statusText: 'Bad' }));
    const plain = await gatewayFetch('/plugins');
    expect(plain.error?.message).toBe('Bad');
  });

  it('passes absolute URLs and non-JSON success through', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));
    const result = await gatewayFetch('https://gateway.example/api/v1/audit', {
      headers: { 'X-Trace': '1' },
      next: { revalidate: 0 },
    });
    expect(result).toMatchObject({ ok: true, status: 204, data: null });
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('https://gateway.example/api/v1/audit');
  });
});
