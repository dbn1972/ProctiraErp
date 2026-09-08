/**
 * Server-side authentication utilities for the Platform Admin Console.
 *
 * `requireSession()` enforces a logged-in operator on every protected page.
 * `requireRole()` further restricts access to operators whose `platformRole`
 * claim is allowed in the requested functional area (Section 41 — role
 * separation between ops support, billing, security, and engineering).
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { ADMIN_AUTH_COOKIES } from './cookies';
import { hasRole, type AdminArea, type PlatformRole } from './roles';
import { decodeAdminToken, isAdminTokenExpired, type AdminTokenPayload } from './session';

export interface AdminServerSession {
  accessToken: string;
  refreshToken: string | null;
  user: AdminTokenPayload;
  isExpired: boolean;
}

/** Reads the current admin session from cookies. */
export async function getSession(): Promise<AdminServerSession | null> {
  const jar = await cookies();
  const accessToken = jar.get(ADMIN_AUTH_COOKIES.ACCESS_TOKEN)?.value;
  const refreshToken = jar.get(ADMIN_AUTH_COOKIES.REFRESH_TOKEN)?.value ?? null;

  if (!accessToken) return null;

  const payload = decodeAdminToken(accessToken);
  if (!payload) return null;

  return {
    accessToken,
    refreshToken,
    user: payload,
    isExpired: isAdminTokenExpired(accessToken),
  };
}

/**
 * Server-component helper that enforces authentication. Redirects to /login
 * (preserving the requested path as `returnTo`) when no valid session exists.
 */
export async function requireSession(returnTo?: string): Promise<AdminServerSession> {
  const session = await getSession();
  if (!session || session.isExpired) {
    const params = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : '';
    redirect(`/login${params}`);
  }
  return session;
}

/**
 * Enforces both authentication and role membership for the given area.
 * Operators without the required role are redirected to /forbidden so the
 * audit log can record the attempted access.
 */
export async function requireRole(area: AdminArea, returnTo?: string): Promise<AdminServerSession> {
  const session = await requireSession(returnTo);
  if (!hasRole(session.user.platformRole, area)) {
    redirect(`/forbidden?area=${encodeURIComponent(area)}`);
  }
  return session;
}

/** Convenience: explicit role check that returns boolean rather than redirecting. */
export function userHasRole(session: AdminServerSession | null, area: AdminArea): boolean {
  return hasRole(session?.user.platformRole, area);
}

/** Re-export the public role types for downstream consumers. */
export type { PlatformRole };
