/**
 * Tests for the gateway client.
 *
 * Validates the contract that every outbound request carries the tenant
 * identifier resolved from the session, satisfying the multi-tenant
 * isolation requirement (Task 27.5 implementation guidance).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockTenantId = '11111111-1111-1111-1111-111111111111';
const mockAccessToken = 'eyJ.access.token';
const mockGet = vi.fn<[string], { value: string } | undefined>();
const mockHeaderGet = vi.fn<[string], string | null>();

vi.mock('server-only', () => ({}));

vi.mock('next/headers', () => ({
  cookies: () => ({ get: mockGet }),
  headers: () => ({ get: mockHeaderGet }),
}));

vi.mock('@/lib/auth', () => ({
  AUTH_COOKIES: {
    ACCESS_TOKEN: 'access_token',
    REFRESH_TOKEN: 'refresh_token',
    SESSION_ID: 'session_id',
  },
  decodeTokenPayload: () => ({
    sub: 'user-1',
    tenantId: mockTenantId,
    email: 'admin@example.org',
    roles: [],
    iat: 1,
    exp: 9999999999,
  }),
}));

const fetchMock = vi.fn<[string, RequestInit?], Promise<Response>>();
vi.stubGlobal('fetch', fetchMock);

beforeEach(() => {
  mockGet.mockReturnValue({ value: mockAccessToken });
  mockHeaderGet.mockReturnValue(null);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('gatewayFetch', () => {
  it('forwards X-Tenant-ID and Authorization headers', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const { gatewayFetch } = await import('./gateway');
    const result = await gatewayFetch<{ ok: boolean }>('/students');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0]!;
    const headers = (call[1]?.headers as Headers) ?? new Headers();
    expect(headers.get('X-Tenant-ID')).toBe(mockTenantId);
    expect(headers.get('Authorization')).toBe(`Bearer ${mockAccessToken}`);
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ ok: true });
  });

  it('throws GatewayError on a non-2xx response when throwOnError is default', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'Missing' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const { gatewayFetch, GatewayError } = await import('./gateway');
    await expect(gatewayFetch('/students/missing-id')).rejects.toBeInstanceOf(GatewayError);
  });

  it('returns structured error payload when throwOnError is false', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: 'VALIDATION_ERROR', message: 'Bad input' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const { gatewayFetch } = await import('./gateway');
    const result = await gatewayFetch('/students', { throwOnError: false });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('VALIDATION_ERROR');
  });

  it('encodes JSON body and content type when given json option', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: 'abc' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const { gatewayFetch } = await import('./gateway');
    await gatewayFetch('/students', {
      method: 'POST',
      json: { firstName: 'Aisha' },
    });

    const call = fetchMock.mock.calls[0]!;
    const headers = (call[1]?.headers as Headers) ?? new Headers();
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(call[1]?.body).toBe(JSON.stringify({ firstName: 'Aisha' }));
  });
});
