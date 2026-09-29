/**
 * @vitest-environment node
 *
 * Task 9.1 — POST/DELETE /api/dashboard/preview-state.
 * Task 9.2 (Req 6.13) — best-effort audit call via `gatewayFetch`.
 *
 * Mocking pattern follows `apps/web/src/app/api/auth/session/route.test.ts`
 * and `apps/web/src/lib/dashboard/resolvePreviewOverride.test.ts`:
 * `@/lib/auth/server`'s `getSession()` is mocked directly; the real
 * `dashboard-preview:manage` permission decision (`@proctira/auth`,
 * `@/lib/auth/web-rbac-registry`) is left unmocked so the test exercises the
 * actual authorization boundary this route exists to enforce, not a stub.
 *
 * `@/lib/api/gateway`'s `gatewayFetch` is mocked (same pattern as
 * `notifications-inbox.test.ts` and `list-result.test.ts`) so Task 9.2's
 * audit call is asserted without a real network dependency.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ServerSession } from '@/lib/auth/server';
import {
  PREVIEW_STATE_COOKIE_NAME,
  decodePreviewStateCookieValue,
} from '@/lib/dashboard/previewStateCookie';

const getSessionMock = vi.fn<[], Promise<ServerSession | null>>();
const gatewayFetchMock = vi.fn();

vi.mock('@/lib/auth/server', () => ({
  getSession: () => getSessionMock(),
}));

vi.mock('@/lib/api/gateway', () => ({
  gatewayFetch: (...args: unknown[]) => gatewayFetchMock(...args),
}));

import { DELETE, POST } from './route';

function sessionWithRoles(
  roleIds: string[],
  overrides: { isExpired?: boolean } = {},
): ServerSession {
  return {
    accessToken: 'test-token',
    refreshToken: null,
    isExpired: overrides.isExpired ?? false,
    user: {
      sub: 'user-1',
      tenantId: 'tenant-a',
      email: 'test@tenant-a.test',
      roles: roleIds.map((roleId) => ({
        roleId,
        roleName: roleId,
        areaId: 'area-1',
      })),
      iat: 0,
      exp: 9_999_999_999,
    },
  };
}

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/dashboard/preview-state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function deleteRequest(): Request {
  return new Request('http://localhost/api/dashboard/preview-state', { method: 'DELETE' });
}

/** Extracts the `Dashboard-Preview-State` Set-Cookie header, if present. */
function previewCookieHeader(response: Response): string | undefined {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const all = headers.getSetCookie ? headers.getSetCookie() : [];
  return all.find((line) => line.startsWith(`${PREVIEW_STATE_COOKIE_NAME}=`));
}

describe('POST /api/dashboard/preview-state', () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    gatewayFetchMock.mockReset();
    gatewayFetchMock.mockResolvedValue({ status: 200, ok: true, data: { ok: true } });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 when there is no session', async () => {
    getSessionMock.mockResolvedValue(null);

    const response = await POST(postRequest({ state: 'filled' }));

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe('FORBIDDEN');
    expect(previewCookieHeader(response)).toBeUndefined();
  });

  it('returns 403 when the session access token is expired', async () => {
    getSessionMock.mockResolvedValue(sessionWithRoles(['admin'], { isExpired: true }));

    const response = await POST(postRequest({ state: 'filled' }));

    expect(response.status).toBe(403);
  });

  it('returns 403 for an authenticated caller without dashboard-preview:manage (teacher)', async () => {
    getSessionMock.mockResolvedValue(sessionWithRoles(['teacher']));

    const response = await POST(postRequest({ state: 'filled' }));

    expect(response.status).toBe(403);
    expect(previewCookieHeader(response)).toBeUndefined();
  });

  it('returns 400 for an invalid state value, even for a permitted caller', async () => {
    getSessionMock.mockResolvedValue(sessionWithRoles(['admin']));

    const response = await POST(postRequest({ state: 'bogus-state' }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(previewCookieHeader(response)).toBeUndefined();
  });

  it('returns 400 for a missing state field', async () => {
    getSessionMock.mockResolvedValue(sessionWithRoles(['admin']));

    const response = await POST(postRequest({}));

    expect(response.status).toBe(400);
  });

  it('returns 400 for an unparseable body', async () => {
    getSessionMock.mockResolvedValue(sessionWithRoles(['admin']));

    const response = await POST(
      new Request('http://localhost/api/dashboard/preview-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not-json',
      }),
    );

    expect(response.status).toBe(400);
  });

  it('sets the cookie and returns 200 for an admin session with a valid state', async () => {
    getSessionMock.mockResolvedValue(sessionWithRoles(['admin']));

    const response = await POST(postRequest({ state: 'degraded' }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ state: 'degraded' });

    const setCookie = previewCookieHeader(response);
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toContain('Max-Age=1800');

    const rawValue = decodeURIComponent(setCookie!.split(';')[0]!.split('=')[1]!);
    expect(decodePreviewStateCookieValue(rawValue)).toMatchObject({ state: 'degraded' });
  });

  it('sets the cookie and returns 200 for a principal session with a valid state', async () => {
    getSessionMock.mockResolvedValue(sessionWithRoles(['principal']));

    const response = await POST(postRequest({ state: 'no-approvals' }));

    expect(response.status).toBe(200);
    expect(previewCookieHeader(response)).toBeDefined();
  });

  it('does not mark the cookie Secure outside production (plain http request)', async () => {
    getSessionMock.mockResolvedValue(sessionWithRoles(['admin']));

    const response = await POST(postRequest({ state: 'filled' }));

    const setCookie = previewCookieHeader(response);
    expect(setCookie).toBeDefined();
    expect(setCookie).not.toMatch(/Secure/i);
  });

  it('Task 9.2: calls gatewayFetch to audit a successful set', async () => {
    getSessionMock.mockResolvedValue(sessionWithRoles(['admin']));

    const response = await POST(postRequest({ state: 'filled' }));

    expect(response.status).toBe(200);
    expect(gatewayFetchMock).toHaveBeenCalledWith(
      '/dashboard-preview',
      expect.objectContaining({ method: 'POST', throwOnError: false }),
    );
  });

  it('Task 9.2: still sets the cookie when the audit call fails (best-effort)', async () => {
    getSessionMock.mockResolvedValue(sessionWithRoles(['admin']));
    gatewayFetchMock.mockResolvedValue({
      status: 500,
      ok: false,
      data: null,
      error: { code: 'GATEWAY_ERROR', message: 'boom' },
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await POST(postRequest({ state: 'filled' }));

    expect(response.status).toBe(200);
    expect(previewCookieHeader(response)).toBeDefined();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it('Task 9.2: does not call gatewayFetch when the caller is unauthorized', async () => {
    getSessionMock.mockResolvedValue(sessionWithRoles(['teacher']));

    await POST(postRequest({ state: 'filled' }));

    expect(gatewayFetchMock).not.toHaveBeenCalled();
  });

  it('Task 9.2: does not call gatewayFetch when the body fails validation', async () => {
    getSessionMock.mockResolvedValue(sessionWithRoles(['admin']));

    await POST(postRequest({ state: 'bogus-state' }));

    expect(gatewayFetchMock).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/dashboard/preview-state', () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    gatewayFetchMock.mockReset();
    gatewayFetchMock.mockResolvedValue({ status: 204, ok: true, data: null });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 when there is no session', async () => {
    getSessionMock.mockResolvedValue(null);

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(403);
  });

  it('returns 403 for an authenticated caller without dashboard-preview:manage (staff)', async () => {
    getSessionMock.mockResolvedValue(sessionWithRoles(['staff']));

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(403);
    expect(previewCookieHeader(response)).toBeUndefined();
  });

  it('expires the cookie and returns 204 for a permitted caller', async () => {
    getSessionMock.mockResolvedValue(sessionWithRoles(['admin']));

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(204);
    const setCookie = previewCookieHeader(response);
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain('Max-Age=0');
    expect(setCookie).toContain('Path=/');
  });

  it('Task 9.2: calls gatewayFetch to audit a successful clear', async () => {
    getSessionMock.mockResolvedValue(sessionWithRoles(['principal']));

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(204);
    expect(gatewayFetchMock).toHaveBeenCalledWith(
      '/dashboard-preview',
      expect.objectContaining({ method: 'DELETE', throwOnError: false }),
    );
  });

  it('Task 9.2: still clears the cookie when the audit call fails (best-effort)', async () => {
    getSessionMock.mockResolvedValue(sessionWithRoles(['admin']));
    gatewayFetchMock.mockRejectedValue(new Error('network down'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(204);
    const setCookie = previewCookieHeader(response);
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain('Max-Age=0');
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it('Task 9.2: does not call gatewayFetch when the caller is unauthorized', async () => {
    getSessionMock.mockResolvedValue(sessionWithRoles(['staff']));

    await DELETE(deleteRequest());

    expect(gatewayFetchMock).not.toHaveBeenCalled();
  });
});
