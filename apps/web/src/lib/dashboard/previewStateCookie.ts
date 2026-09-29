/**
 * Dashboard preview-state cookie codec (Task 7.1, `principal-dashboard-parity`).
 *
 * Settings-gated administrators/principals can force the dashboard home
 * page into one of five fabricated data states (Filled, No approvals,
 * Degraded, Loading, Error) for demoing and QA (Requirement 6). The
 * signal for "which state, and since when" travels in a single cookie:
 *
 *   `Dashboard-Preview-State` = `"<state>|<epochSecondsWhenSet>"`
 *   e.g. `filled|1719400000`
 *
 * This module only encodes/decodes that value and exposes the shared
 * constants. It is intentionally isomorphic (no `next/headers`, no
 * Node-only APIs) so it can be imported from both the server-side
 * resolver (Task 7.2 — permission check + expiry enforcement, NOT
 * implemented here) and, optionally, client components.
 *
 * This is a distinct mechanism from the tenant-branding preview cookie
 * (`apps/web/src/lib/branding/previewCookie.ts`, `Tenant-Theme-Preview`):
 * that cookie carries an opaque flag for a different feature. This file
 * follows the same shape/style (name constant, max-age constant,
 * `isBrowser()` guard) but does not modify or depend on that file.
 *
 * Server-side authority lives elsewhere:
 *   - Task 7.2 (`resolvePreviewOverride`) re-checks the
 *     `dashboard-preview:manage` permission fresh against the caller's
 *     actual roles and re-validates expiry — cookie presence alone is
 *     never sufficient authorization (Req 6.12, 7.4).
 *   - Task 9.1 (set/clear routes) is what actually writes the
 *     `Set-Cookie` header (`Path=/`, `SameSite=Lax`,
 *     `Max-Age=PREVIEW_STATE_MAX_AGE_SECONDS`, `Secure` in production),
 *     using the constants and `encodePreviewStateCookieValue` exported
 *     here.
 *
 * Everything in this file is pure and never throws — malformed input
 * decodes to `null` (fail closed), it does not raise.
 */

/** Cookie name carrying the encoded preview-state signal. */
export const PREVIEW_STATE_COOKIE_NAME = 'Dashboard-Preview-State';

/**
 * Maximum lifetime of a preview-state signal, in seconds (30 minutes).
 *
 * This bounds both the cookie's `Max-Age` attribute (Task 9.1) and the
 * server-side re-check (`isPreviewStateExpired`, Task 7.2) that treats
 * the signal as inactive once this many seconds have elapsed since
 * `setAtEpochSeconds` — independent of whether the browser has already
 * expired the cookie itself (Req 6.9).
 */
export const PREVIEW_STATE_MAX_AGE_SECONDS = 1800;

/**
 * The five states the preview-state switcher can force the dashboard
 * into (Req 6 AC2): Filled, No approvals, Degraded (services down),
 * Loading, and Error, respectively.
 */
export type PreviewState = 'filled' | 'no-approvals' | 'degraded' | 'loading' | 'error';

/** Canonical, ordered list of the five valid preview states. */
export const PREVIEW_STATES: readonly PreviewState[] = [
  'filled',
  'no-approvals',
  'degraded',
  'loading',
  'error',
];

function isPreviewState(value: string): value is PreviewState {
  return (PREVIEW_STATES as readonly string[]).includes(value);
}

function isBrowser(): boolean {
  return typeof document !== 'undefined';
}

/** Result of successfully decoding a `Dashboard-Preview-State` cookie value. */
export interface DecodedPreviewStateCookie {
  state: PreviewState;
  setAtEpochSeconds: number;
}

/**
 * Encodes a preview state (and when it was set) into the cookie's value
 * format: `"<state>|<epochSecondsWhenSet>"`.
 *
 * Defaults `setAtEpochSeconds` to the current time so callers writing
 * the cookie don't need to compute it, while still letting tests pass a
 * fixed timestamp explicitly.
 */
export function encodePreviewStateCookieValue(
  state: PreviewState,
  setAtEpochSeconds?: number,
): string {
  const epoch = setAtEpochSeconds ?? Math.floor(Date.now() / 1000);
  return `${state}|${epoch}`;
}

/**
 * Decodes a raw `Dashboard-Preview-State` cookie value.
 *
 * Fails closed: returns `null` for absent/empty input, the wrong number
 * of `|`-separated parts, an unrecognized state string, or a
 * non-numeric/non-positive/non-finite epoch — it never throws.
 */
export function decodePreviewStateCookieValue(
  raw: string | undefined | null,
): DecodedPreviewStateCookie | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;

  const parts = raw.split('|');
  if (parts.length !== 2) return null;

  const [statePart, epochPart] = parts;
  if (!statePart || !isPreviewState(statePart)) return null;
  if (!epochPart || !/^\d+$/.test(epochPart)) return null;

  const setAtEpochSeconds = Number(epochPart);
  if (!Number.isFinite(setAtEpochSeconds) || setAtEpochSeconds <= 0) return null;

  return { state: statePart, setAtEpochSeconds };
}

/**
 * Returns `true` once more than `PREVIEW_STATE_MAX_AGE_SECONDS` have
 * elapsed since `setAtEpochSeconds` (Req 6.9). Callers on the server
 * must re-run this check on every read regardless of the browser's own
 * `Max-Age` enforcement, since a replayed/clock-skewed cookie could
 * still present a stale value.
 */
export function isPreviewStateExpired(
  setAtEpochSeconds: number,
  nowEpochSeconds?: number,
): boolean {
  const now = nowEpochSeconds ?? Math.floor(Date.now() / 1000);
  return now - setAtEpochSeconds > PREVIEW_STATE_MAX_AGE_SECONDS;
}

/**
 * Thin browser convenience reader for the switcher UI, so it can
 * highlight whichever state is currently active without a round trip.
 *
 * This is NOT an authorization check — it only reflects what the
 * client's own cookie says, filtered for basic validity/expiry. The
 * authoritative permission + expiry check happens server-side
 * (`resolvePreviewOverride`, Task 7.2) on every actual data request.
 * No-ops (returns `null`) outside a browser context.
 */
export function readActivePreviewStateFromBrowser(): DecodedPreviewStateCookie | null {
  if (!isBrowser()) return null;

  const target = `${PREVIEW_STATE_COOKIE_NAME}=`;
  let rawValue: string | null = null;
  for (const segment of (document.cookie || '').split(';')) {
    const trimmed = segment.trimStart();
    if (trimmed.startsWith(target)) {
      rawValue = trimmed.slice(target.length);
      break;
    }
  }
  if (rawValue === null) return null;

  let decodedValue = rawValue;
  try {
    decodedValue = decodeURIComponent(rawValue);
  } catch {
    // Malformed percent-encoding: fall through with the raw value, which
    // will simply fail the decode below rather than throw.
  }

  const decoded = decodePreviewStateCookieValue(decodedValue);
  if (!decoded) return null;
  if (isPreviewStateExpired(decoded.setAtEpochSeconds)) return null;
  return decoded;
}
