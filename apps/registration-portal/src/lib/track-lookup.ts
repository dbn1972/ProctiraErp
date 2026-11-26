import { isValidDateOfBirth, isValidTrackingNumber } from './validation';

export const TRACK_DOB_COOKIE = 'registration_track_dob';

/**
 * PRC-L225: the DOB cookie uses the `__Host-` prefix, which the browser only
 * accepts when the cookie is sent over HTTPS with `Secure`, `Path=/` and no
 * `Domain`. That binds it to the exact origin and blocks domain/subdomain
 * injection. Local http dev cannot set `Secure`, so the unprefixed name is used
 * only when the context is insecure.
 */
export const TRACK_DOB_COOKIE_HOST = `__Host-${TRACK_DOB_COOKIE}` as const;

type TrackCookieEnv = {
  NODE_ENV?: string;
};

function defaultEnv(): TrackCookieEnv {
  return (
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
  );
}

/**
 * PRC-L225 / UATENV-D31: the redirect `Location` after a lookup is a
 * host-relative path. It never contains a scheme or host, so neither the
 * request Host, a forged `X-Forwarded-Host`, nor the proxy-internal origin can
 * end up in it. The browser resolves it against the host it used, which keeps
 * each tenant's applicants on their own portal host, where the host-only DOB
 * cookie lives and the gateway resolves the right tenant. A single fixed public
 * base cannot do that for a portal that serves several tenant hosts.
 *
 * The path is built only from a validated tracking number (`REG-` plus 8
 * alphanumerics) and is URI-encoded, so it always starts with `/track` and can
 * never become a protocol-relative `//host` redirect.
 */
export function trackLookupLocation(decision: TrackLookupDecision): string {
  if (!decision.ok) return '/track?error=invalid';
  return `/track/${encodeURIComponent(decision.trackingNumber)}`;
}

/**
 * PRC-L225: whether the DOB cookie must be `Secure` (and so `__Host-`
 * prefixed). Production is always secure. Elsewhere an https request URL or an
 * https `X-Forwarded-Proto` makes it secure; a header can only upgrade the
 * cookie, never downgrade it, so a forged value cannot weaken it.
 */
export function isSecureTrackContext(
  requestUrl: string,
  headers: { get(name: string): string | null },
  env: TrackCookieEnv = defaultEnv(),
): boolean {
  if (env.NODE_ENV?.trim().toLowerCase() === 'production') return true;
  const forwardedProto = headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  if (forwardedProto === 'https') return true;
  try {
    return new URL(requestUrl).protocol === 'https:';
  } catch {
    return false;
  }
}

export interface TrackDobCookie {
  name: string;
  value: string;
  options: {
    httpOnly: true;
    sameSite: 'lax';
    secure: boolean;
    path: string;
    maxAge: number;
  };
}

/**
 * PRC-L225: build the DOB cookie. In a secure (HTTPS) context it carries the
 * `__Host-` prefix with `Secure`, `Path=/` and no `Domain`; an insecure local
 * dev context, where `Secure` cannot be set, uses the unprefixed name.
 */
export function buildTrackDobCookie(dob: string, opts: { secure: boolean }): TrackDobCookie {
  return {
    name: opts.secure ? TRACK_DOB_COOKIE_HOST : TRACK_DOB_COOKIE,
    value: dob,
    options: {
      httpOnly: true,
      sameSite: 'lax',
      secure: opts.secure,
      path: '/',
      maxAge: 60 * 30,
    },
  };
}

/**
 * PRC-L225: the detail page must read whichever cookie the lookup route set —
 * the `__Host-` prefixed one in a secure context, else the unprefixed name.
 */
export function readTrackDobCookie(cookies: {
  get(name: string): { value: string } | undefined;
}): string {
  return cookies.get(TRACK_DOB_COOKIE_HOST)?.value ?? cookies.get(TRACK_DOB_COOKIE)?.value ?? '';
}

export type TrackLookupDecision = { ok: true; trackingNumber: string; dob: string } | { ok: false };

/** Accept a tracking lookup only when both values are well formed. DOB stays off the URL. */
export function decideTrackLookup(trackingNumber: string, dob: string): TrackLookupDecision {
  const normalized = trackingNumber.trim().toUpperCase();
  const date = dob.trim();
  if (!isValidTrackingNumber(normalized) || !isValidDateOfBirth(date)) {
    return { ok: false };
  }
  return { ok: true, trackingNumber: normalized, dob: date };
}

export type TrackingPageState<T> =
  | { kind: 'match'; trackingNumber: string; status: T }
  | { kind: 'not_found'; trackingNumber: string }
  | { kind: 'invalid'; trackingNumber: string | null }
  | { kind: 'rate_limited'; trackingNumber: string }
  | { kind: 'unavailable'; trackingNumber: string };

/** `decodeURIComponent` that reports malformed escapes instead of throwing (PRC-M055). */
export function safeDecodeTrackingNumber(raw: string): string | null {
  try {
    return decodeURIComponent(raw).trim().toUpperCase();
  } catch {
    return null;
  }
}

/**
 * PRC-M055: resolve the tracking page into distinct states. A backend outage
 * (5xx / network) or throttle (429) is never shown as "application not found",
 * and a malformed URL is an invalid request, not a 500.
 */
export async function resolveTrackingPage<T>(
  rawTrackingNumber: string,
  dob: string,
  lookup: (trackingNumber: string, dob: string) => Promise<T | null>,
): Promise<TrackingPageState<T>> {
  const trackingNumber = safeDecodeTrackingNumber(rawTrackingNumber);
  if (!trackingNumber || !isValidTrackingNumber(trackingNumber)) {
    return { kind: 'invalid', trackingNumber };
  }
  // Missing/invalid DOB cookie: ask again via the form (treated as no match).
  if (!isValidDateOfBirth(dob)) return { kind: 'not_found', trackingNumber };
  try {
    const status = await lookup(trackingNumber, dob);
    return status === null
      ? { kind: 'not_found', trackingNumber }
      : { kind: 'match', trackingNumber, status };
  } catch (error) {
    const statusCode =
      typeof (error as { statusCode?: unknown })?.statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 0;
    if (statusCode === 429) return { kind: 'rate_limited', trackingNumber };
    if (statusCode === 400) return { kind: 'invalid', trackingNumber };
    return { kind: 'unavailable', trackingNumber };
  }
}
