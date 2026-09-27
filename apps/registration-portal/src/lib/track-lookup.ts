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
