/**
 * Cookie configuration for authentication tokens.
 *
 * All tokens are stored as httpOnly cookies to prevent client-side JavaScript
 * access (mitigates XSS token theft). Cookies are scoped to "/" so they are
 * available for the entire application surface, including API route handlers
 * and middleware.
 *
 * W1-SEC-09: refresh cookies use SameSite=Strict. Access cookies stay Lax so
 * top-level OAuth return navigations can still present the session; CSRF
 * double-submit + Origin checks (see csrf.ts) cover the Lax residual.
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

/** Whether we are running in production (forces the Secure flag). */
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Resolves whether auth cookies must carry the `Secure` attribute.
 *
 * The flag is set when ANY of the following hold (G-719):
 *  - `NODE_ENV=production`
 *  - `COOKIE_SECURE=1` (explicit operator override for staging behind TLS)
 *  - the public app URL is `https://`
 *  - the current request arrived over HTTPS (directly or via a TLS-terminating
 *    proxy that sets `x-forwarded-proto: https`)
 *
 * Only plain-HTTP development traffic yields `false`; a `Secure` cookie set on
 * an `http://localhost` origin would be silently dropped by browsers.
 */
export function isSecureCookieContext(request?: Request | null): boolean {
  if (IS_PRODUCTION) return true;
  if (process.env.COOKIE_SECURE === '1' || process.env.COOKIE_SECURE === 'true') return true;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? '';
  if (appUrl.toLowerCase().startsWith('https://')) return true;
  if (!request) return false;
  const forwardedProto = request.headers.get('x-forwarded-proto');
  if (forwardedProto) {
    return forwardedProto.split(',')[0]!.trim().toLowerCase() === 'https';
  }
  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Cookie options for the access token. httpOnly + Lax so top-level OAuth
 * callback navigations can still send the cookie; CSRF mitigations cover POSTs.
 */
export function accessTokenCookieOptions(
  maxAge: number = ACCESS_TOKEN_MAX_AGE,
  request?: Request | null,
): AuthCookieOptions {
  return {
    httpOnly: true,
    secure: isSecureCookieContext(request),
    sameSite: 'lax',
    path: '/',
    maxAge,
  };
}

/**
 * Cookie options for the refresh token (W1-SEC-09).
 * SameSite=Strict — never sent on cross-site navigations; refresh is always
 * same-origin API (`/api/auth/refresh`). Pair with Secure when TLS is active.
 */
export function refreshTokenCookieOptions(
  maxAge: number = REFRESH_TOKEN_MAX_AGE,
  request?: Request | null,
): AuthCookieOptions {
  return {
    httpOnly: true,
    secure: isSecureCookieContext(request),
    sameSite: 'strict',
    path: '/',
    maxAge,
  };
}

/** Cookie options used to delete the access (or session) cookie. */
export function clearCookieOptions(request?: Request | null): AuthCookieOptions {
  return {
    httpOnly: true,
    secure: isSecureCookieContext(request),
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  };
}

/**
 * Clear options for the refresh cookie — SameSite must match the set attributes
 * or browsers may ignore the delete (W1-SEC-09).
 */
export function clearRefreshTokenCookieOptions(request?: Request | null): AuthCookieOptions {
  return {
    httpOnly: true,
    secure: isSecureCookieContext(request),
    sameSite: 'strict',
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

/**
 * Resolves the API gateway base URL (Keycloak BFF / ticket redemption).
 * Falls back to NEXT_PUBLIC_API_URL, then localhost gateway.
 */
export function getGatewayUrl(): string {
  return (
    process.env.GATEWAY_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.API_GATEWAY_URL ||
    'http://localhost:3000'
  );
}
