import { isValidDateOfBirth, isValidTrackingNumber } from './validation';

export const TRACK_DOB_COOKIE = 'registration_track_dob';

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
