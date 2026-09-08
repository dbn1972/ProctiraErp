/**
 * CSRF protection for the Next.js web API routes (G-719).
 *
 * Strategy — defence in depth, all three must hold for state-changing
 * (`POST`/`PUT`/`PATCH`/`DELETE`) requests under `/api/*`:
 *
 * 1. **Fetch-metadata / Origin check.** If the browser sends `Sec-Fetch-Site`
 *    it must be `same-origin`, `same-site` or `none`. If it sends `Origin`
 *    (or, failing that, `Referer`) the host must match the request host
 *    (honouring `x-forwarded-host` behind a proxy).
 * 2. **Double-submit token.** A random, non-httpOnly `csrf_token` cookie is
 *    issued by the middleware on every page navigation. Clients echo it in the
 *    `x-csrf-token` header; the two must match exactly.
 * 3. Auth cookies stay `SameSite=Lax`, so cross-site POSTs never carry the
 *    session in the first place — the checks above cover the remaining
 *    same-site-but-different-origin and legacy-browser cases.
 *
 * Everything here runs on the Edge runtime (Web Crypto only, no Node APIs).
 */

/** Name of the readable double-submit cookie. */
export const CSRF_COOKIE = 'csrf_token';
/** Header the client echoes the cookie value in. */
export const CSRF_HEADER = 'x-csrf-token';
/** Token lifetime: 12 hours (rotated transparently by the middleware). */
export const CSRF_TOKEN_MAX_AGE = 60 * 60 * 12;

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const TOKEN_BYTES = 32;

export type CsrfFailureReason =
  | 'cross-site'
  | 'origin-mismatch'
  | 'missing-cookie'
  | 'missing-header'
  | 'token-mismatch';

export interface CsrfVerification {
  ok: boolean;
  reason?: CsrfFailureReason;
}

/** True for HTTP methods that must be protected. */
export function isUnsafeMethod(method: string | undefined): boolean {
  return UNSAFE_METHODS.has((method ?? 'GET').toUpperCase());
}

/** Generates a URL-safe random token using Web Crypto. */
export function generateCsrfToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** Cookie attributes for the double-submit token. Readable by JS by design. */
export function csrfCookieOptions(secure: boolean): {
  httpOnly: false;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
} {
  return { httpOnly: false, secure, sameSite: 'lax', path: '/', maxAge: CSRF_TOKEN_MAX_AGE };
}

/** Parses a raw `Cookie` header into a map (first value wins). */
export function parseCookieHeader(header: string | null): Map<string, string> {
  const jar = new Map<string, string>();
  if (!header) return jar;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    if (!name || jar.has(name)) continue;
    jar.set(name, decodeURIComponent(part.slice(idx + 1).trim()));
  }
  return jar;
}

/** Constant-time string equality to avoid timing side channels. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Effective public host of the request (proxy-aware). */
export function requestHost(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-host');
  if (forwarded) return forwarded.split(',')[0]!.trim().toLowerCase();
  const host = request.headers.get('host');
  if (host) return host.trim().toLowerCase();
  try {
    return new URL(request.url).host.toLowerCase();
  } catch {
    return '';
  }
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Verifies the origin of a request using Fetch Metadata and Origin/Referer.
 * Requests with neither header (e.g. server-to-server) pass this layer and
 * are gated solely by the double-submit token.
 */
export function verifyRequestOrigin(request: Request): CsrfVerification {
  const fetchSite = request.headers.get('sec-fetch-site')?.toLowerCase();
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'same-site' && fetchSite !== 'none') {
    return { ok: false, reason: 'cross-site' };
  }

  const expectedHost = requestHost(request);
  const originHost = hostOf(request.headers.get('origin'));
  if (originHost !== null) {
    return originHost === expectedHost ? { ok: true } : { ok: false, reason: 'origin-mismatch' };
  }
  const refererHost = hostOf(request.headers.get('referer'));
  if (refererHost !== null && refererHost !== expectedHost) {
    return { ok: false, reason: 'origin-mismatch' };
  }
  return { ok: true };
}

/** Verifies the double-submit cookie/header pair. */
export function verifyDoubleSubmit(request: Request): CsrfVerification {
  const cookieToken = parseCookieHeader(request.headers.get('cookie')).get(CSRF_COOKIE);
  if (!cookieToken) return { ok: false, reason: 'missing-cookie' };
  const headerToken = request.headers.get(CSRF_HEADER);
  if (!headerToken) return { ok: false, reason: 'missing-header' };
  return timingSafeEqual(cookieToken, headerToken)
    ? { ok: true }
    : { ok: false, reason: 'token-mismatch' };
}

/**
 * Full CSRF verification for a request. Safe methods always pass; unsafe
 * methods must satisfy both the origin check and the double-submit check.
 */
export function verifyCsrf(request: Request): CsrfVerification {
  if (!isUnsafeMethod(request.method)) return { ok: true };
  const origin = verifyRequestOrigin(request);
  if (!origin.ok) return origin;
  return verifyDoubleSubmit(request);
}

/** JSON body returned to callers that fail CSRF verification. */
export function csrfRejectionBody(reason: CsrfFailureReason | undefined): {
  code: 'CSRF_REJECTED';
  message: string;
  reason: CsrfFailureReason | 'unknown';
} {
  return {
    code: 'CSRF_REJECTED',
    message: 'Request rejected by cross-site request forgery protection.',
    reason: reason ?? 'unknown',
  };
}

/**
 * Browser helper: reads the double-submit cookie so callers can attach it as
 * the `x-csrf-token` header. Returns `null` on the server or when absent.
 */
export function readCsrfTokenFromDocument(): string | null {
  if (typeof document === 'undefined') return null;
  return parseCookieHeader(document.cookie).get(CSRF_COOKIE) ?? null;
}

/**
 * Browser helper: returns headers augmented with the CSRF token (when the
 * cookie is present). Accepts any `HeadersInit` and returns a plain record so
 * it composes with existing `fetch` call sites.
 */
export function withCsrfHeader(headers: HeadersInit = {}): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    out[key] = value;
  });
  const token = readCsrfTokenFromDocument();
  if (token) out[CSRF_HEADER] = token;
  return out;
}
