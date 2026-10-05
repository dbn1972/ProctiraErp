/**
 * PRC-M333: semantic input checks that JSON-schema patterns cannot express.
 */
import type { FieldError } from '@proctira/common';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Oldest plausible applicant age in years (K-12 plus late entrants). */
export const MAX_APPLICANT_AGE_YEARS = 30;
/** Longest custom-field string a configured `pattern` is evaluated against. */
const MAX_PATTERN_INPUT = 1000;

/** True when `value` is a real calendar date in YYYY-MM-DD form (e.g. not 2020-02-31). */
export function isRealIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** Date of birth must be a real date, not in the future, and within a plausible age. */
export function dateOfBirthErrors(
  value: string,
  field = 'dateOfBirth',
  now: Date = new Date(),
): FieldError[] {
  if (!isRealIsoDate(value)) {
    return [{ field, rule: 'format', message: 'Date of birth must be a real date (YYYY-MM-DD)' }];
  }
  const today = now.toISOString().slice(0, 10);
  if (value > today) {
    return [{ field, rule: 'notFuture', message: 'Date of birth cannot be in the future' }];
  }
  const oldest = `${now.getUTCFullYear() - MAX_APPLICANT_AGE_YEARS}${today.slice(4)}`;
  if (value < oldest) {
    return [
      {
        field,
        rule: 'range',
        message: `Applicant must be younger than ${MAX_APPLICANT_AGE_YEARS} years`,
      },
    ];
  }
  return [];
}

/** Parse an ISO timestamp; returns null for garbage / Invalid Date. */
export function parseTimestamp(value: string | null | undefined): Date | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Anchored match of an admin-configured pattern; invalid patterns fail closed. */
export function matchesConfiguredPattern(value: string, pattern: string): boolean {
  if (value.length > MAX_PATTERN_INPUT) return false;
  try {
    return new RegExp(`^(?:${pattern})$`, 'u').test(value);
  } catch {
    return false;
  }
}
