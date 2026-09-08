/**
 * Cookie configuration for Platform Admin Console authentication.
 *
 * Tokens are stored as httpOnly cookies (XSS resistant). The console runs on
 * its own host so cookie names are namespaced with `admin_` to avoid collision
 * with tenant-facing apps when a developer is testing on localhost.
 */

export interface AuthCookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  path: string;
  maxAge: number;
}

/** Cookie names used by the admin console. */
export const ADMIN_AUTH_COOKIES = {
  ACCESS_TOKEN: 'admin_access_token',
  REFRESH_TOKEN: 'admin_refresh_token',
  SESSION_ID: 'admin_session_id',
} as const;

/** Default access token TTL: 15 minutes. */
export const ACCESS_TOKEN_MAX_AGE = 60 * 15;

/** Default refresh token TTL: 8 hours (shorter than tenant for break-glass safety). */
export const REFRESH_TOKEN_MAX_AGE = 60 * 60 * 8;

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

export function accessTokenCookieOptions(maxAge: number = ACCESS_TOKEN_MAX_AGE): AuthCookieOptions {
  return {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: 'lax',
    path: '/',
    maxAge,
  };
}

export function refreshTokenCookieOptions(
  maxAge: number = REFRESH_TOKEN_MAX_AGE,
): AuthCookieOptions {
  return {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: 'lax',
    path: '/',
    maxAge,
  };
}

export function clearCookieOptions(): AuthCookieOptions {
  return {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  };
}

/** Resolves the upstream auth-service URL. */
export function getAuthServiceUrl(): string {
  return (
    process.env.AUTH_SERVICE_URL ??
    process.env.NEXT_PUBLIC_AUTH_SERVICE_URL ??
    'http://localhost:3010'
  );
}
