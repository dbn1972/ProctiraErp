/**
 * Task 7.2 — `resolvePreviewOverride()` unit tests.
 *
 * Mocking pattern follows the established precedent for next/headers-bound
 * modules under `apps/web/src/**\/*.test.ts`:
 *   - `next/headers` `cookies()` mocked to a `Map`-backed getter, same shape
 *     as `apps/web/src/app/api/v1/tenant/branding/route.test.ts`.
 *   - `@/lib/auth/server` `getSession()` mocked directly, same shape as
 *     `apps/web/src/app/api/auth/session/route.test.ts`.
 *
 * `@proctira/auth` (`hasPermission`, `DEFAULT_ROLES`) and
 * `@/lib/auth/web-rbac-registry` are left unmocked so the real permission
 * decision — the thing this helper exists to re-check server-side — is
 * actually exercised, not stubbed out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ServerSession } from '@/lib/auth/server';

import { encodePreviewStateCookieValue, PREVIEW_STATE_COOKIE_NAME } from './previewStateCookie';

const cookieValues = new Map<string, string>();
const getSessionMock = vi.fn<[], Promise<ServerSession | null>>();

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const value = cookieValues.get(name);
        return value === undefined ? undefined : { name, value };
      },
    }),
}));

vi.mock('@/lib/auth/server', () => ({
  getSession: () => getSessionMock(),
}));

import { resolvePreviewOverride } from './resolvePreviewOverride';

/** A recent, well-within-the-30-minute-window timestamp for "valid" cases. */
const RECENT_SET_AT = Math.floor(Date.now() / 1000) - 60;
/** A timestamp well past the 1800s max age, for "expired" cases. */
const EXPIRED_SET_AT = Math.floor(Date.now() / 1000) - 2000;

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

describe('resolvePreviewOverride', () => {
  beforeEach(() => {
    cookieValues.clear();
    getSessionMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when no cookie is present, without consulting the session', async () => {
    expect(await resolvePreviewOverride()).toBeNull();
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it('returns null for a malformed cookie value, without consulting the session', async () => {
    cookieValues.set(PREVIEW_STATE_COOKIE_NAME, 'bogus-state|not-a-number');
    expect(await resolvePreviewOverride()).toBeNull();
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it('returns null for an expired cookie (age > 1800s), without consulting the session', async () => {
    cookieValues.set(
      PREVIEW_STATE_COOKIE_NAME,
      encodePreviewStateCookieValue('filled', EXPIRED_SET_AT),
    );
    expect(await resolvePreviewOverride()).toBeNull();
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it('returns null when the cookie is valid but there is no session', async () => {
    cookieValues.set(
      PREVIEW_STATE_COOKIE_NAME,
      encodePreviewStateCookieValue('filled', RECENT_SET_AT),
    );
    getSessionMock.mockResolvedValue(null);
    expect(await resolvePreviewOverride()).toBeNull();
  });

  it('returns null when the session exists but its access token is expired', async () => {
    cookieValues.set(
      PREVIEW_STATE_COOKIE_NAME,
      encodePreviewStateCookieValue('filled', RECENT_SET_AT),
    );
    getSessionMock.mockResolvedValue(sessionWithRoles(['admin'], { isExpired: true }));
    expect(await resolvePreviewOverride()).toBeNull();
  });

  it('returns null when the caller holds a valid session but lacks dashboard-preview:manage (teacher)', async () => {
    cookieValues.set(
      PREVIEW_STATE_COOKIE_NAME,
      encodePreviewStateCookieValue('filled', RECENT_SET_AT),
    );
    getSessionMock.mockResolvedValue(sessionWithRoles(['teacher']));
    expect(await resolvePreviewOverride()).toBeNull();
  });

  it('returns null for other unprivileged roles too (staff, guardian)', async () => {
    cookieValues.set(
      PREVIEW_STATE_COOKIE_NAME,
      encodePreviewStateCookieValue('filled', RECENT_SET_AT),
    );
    for (const roleId of ['staff', 'guardian']) {
      getSessionMock.mockResolvedValue(sessionWithRoles([roleId]));
      expect(await resolvePreviewOverride(), roleId).toBeNull();
    }
  });

  it('returns the decoded override for an admin session holding dashboard-preview:manage', async () => {
    cookieValues.set(
      PREVIEW_STATE_COOKIE_NAME,
      encodePreviewStateCookieValue('no-approvals', RECENT_SET_AT),
    );
    getSessionMock.mockResolvedValue(sessionWithRoles(['admin']));
    expect(await resolvePreviewOverride()).toEqual({
      state: 'no-approvals',
      setAtEpochSeconds: RECENT_SET_AT,
    });
  });

  it('returns the decoded override for a principal session holding dashboard-preview:manage', async () => {
    cookieValues.set(
      PREVIEW_STATE_COOKIE_NAME,
      encodePreviewStateCookieValue('degraded', RECENT_SET_AT),
    );
    getSessionMock.mockResolvedValue(sessionWithRoles(['principal']));
    expect(await resolvePreviewOverride()).toEqual({
      state: 'degraded',
      setAtEpochSeconds: RECENT_SET_AT,
    });
  });

  it('never throws when getSession() itself throws — fails closed instead', async () => {
    cookieValues.set(
      PREVIEW_STATE_COOKIE_NAME,
      encodePreviewStateCookieValue('filled', RECENT_SET_AT),
    );
    getSessionMock.mockRejectedValue(new Error('upstream boom'));
    await expect(resolvePreviewOverride()).resolves.toBeNull();
  });
});
