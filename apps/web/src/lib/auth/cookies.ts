/**
 * Cookie configuration for authentication tokens.
 *
 * All tokens are stored as httpOnly cookies to prevent client-side JavaScript
 * access (mitigates XSS token theft). Cookies are scoped to "/" so they are
 * available for the entire application surface, including API route handlers
 * and middleware.
 */

/** Cookie option shape compatible with both Edge runtime and Node runtime cookies. */
export interface AuthCookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  path: string;
  maxAge: number;
}

/** Default access token TTL: 15 minutes (matches auth-service default). */
export const ACCESS_TOKEN_MAX_AGE = 60 * 15;

/** Default refresh token TTL: 30 days. */
export const REFRESH_TOKEN_MAX_AGE = 60 * 60 * 24 * 30;

/** Whether we are running in production (controls the Secure flag). */
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Cookie options for the access token. httpOnly + lax is the safest default
 * for flows that still need to send the cookie on top-level navigations
 * triggered by OAuth callbacks.
 */
export function accessTokenCookieOptions(
  maxAge: number = ACCESS_TOKEN_MAX_AGE,
): AuthCookieOptions {
  return {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: 'lax',
    path: '/',
    maxAge,
  };
}

/** Cookie options for the refresh token (longer-lived, same security flags). */
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

/** Cookie options used to delete a cookie (set maxAge to 0). */
export function clearCookieOptions(): AuthCookieOptions {
  return {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  };
}

/**
 * Resolves the upstream auth-service URL.
 * Falls back to localhost during development.
 */
export function getAuthServiceUrl(): string {
  return (
    process.env.AUTH_SERVICE_URL ||
    process.env.NEXT_PUBLIC_AUTH_SERVICE_URL ||
    'http://localhost:3010'
  );
}
