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

type TrackRedirectEnv = {
  PUBLIC_BASE_URL?: string;
  PUBLIC_URL?: string;
  NODE_ENV?: string;
};

function defaultEnv(): TrackRedirectEnv {
  return (
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
  );
}

/**
 * A deployed environment is anything other than development/test. In those
 * environments the redirect `Location` must come from a trusted configured base
 * and never from a client-supplied Host header.
 */
function isDeployedEnv(nodeEnv: string | undefined): boolean {
  const normalized = nodeEnv?.trim().toLowerCase();
  return normalized !== 'development' && normalized !== 'test';
}

function parseTrustedBase(env: TrackRedirectEnv): URL | null {
  const configured = env.PUBLIC_BASE_URL?.trim() || env.PUBLIC_URL?.trim();
  if (!configured) return null;
  try {
    return new URL(configured);
  } catch {
    return null;
  }
}

/**
 * PRC-L225: build the redirect base from a trusted configured public URL, never
 * from a forgeable request Host. `PUBLIC_BASE_URL` (or its `PUBLIC_URL` alias)
 * always wins. In a deployed environment a trusted base is REQUIRED: if it is
 * missing or malformed the call throws rather than fall back to the
 * `X-Forwarded-Host`/request origin (an open-redirect / host-injection vector).
 * Only local/dev falls back to the forwarded host and then the request URL.
 */
export function resolveRedirectBase(
  requestUrl: string,
  headers: { get(name: string): string | null },
  env: TrackRedirectEnv = defaultEnv(),
): URL {
  const trusted = parseTrustedBase(env);
  if (trusted) {
    return trusted;
  }
  if (isDeployedEnv(env.NODE_ENV)) {
    throw new Error(
      'PRC-L225: refusing to build a redirect without a trusted public base (set PUBLIC_BASE_URL/PUBLIC_URL)',
    );
  }
  // Local/dev only: the forwarded host and request origin are acceptable here.
  const forwardedHost = headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  if (forwardedHost) {
    const proto = headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https';
    try {
      return new URL(`${proto}://${forwardedHost}`);
    } catch {
      /* fall through */
    }
  }
  return new URL(requestUrl);
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
