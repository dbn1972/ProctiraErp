/**
 * M1-I1: the student edit save sends the loaded `updatedAt` as `If-Match`, so
 * the API (PRC-L365) refuses a save from a stale form with 409.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('next/headers', () => ({
  cookies: () => ({ get: () => ({ value: 'tok' }) }),
  headers: () => ({ get: () => null }),
}));
vi.mock('@/lib/auth', () => ({
  AUTH_COOKIES: { ACCESS_TOKEN: 'access_token' },
  decodeTokenPayload: () => ({ tenantId: 'tenant-1' }),
}));
vi.mock('@/lib/auth/verified-token', () => ({
  readSessionToken: async () => ({ tenantId: 'tenant-1' }),
  tenantIdFromClaims: (claims: { tenantId?: string } | null) => claims?.tenantId ?? null,
}));
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);
import type { GatewayError } from './gateway';
import { updateStudent } from './students';

const UPDATED_AT = '2026-11-24T10:00:00.123Z';

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('updateStudent If-Match (M1-I1)', () => {
  it('sends the loaded updatedAt as a quoted If-Match header', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'stu-1' }));
    await updateStudent('stu-1', { lastName: 'First' }, UPDATED_AT);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/students/stu-1');
    expect(init.method).toBe('PUT');
    expect(new Headers(init.headers).get('If-Match')).toBe(`"${UPDATED_AT}"`);
  });

  it('sends no If-Match when no updatedAt is known', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'stu-1' }));
    await updateStudent('stu-1', { lastName: 'First' });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).has('If-Match')).toBe(false);
  });

  it('surfaces the 409 of a stale save as a GatewayError', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, { code: 'CONFLICT', message: 'modified by another request' }),
    );
    await expect(updateStudent('stu-1', { lastName: 'Stale' }, UPDATED_AT)).rejects.toMatchObject({
      status: 409,
    } satisfies Partial<GatewayError>);
  });
});
