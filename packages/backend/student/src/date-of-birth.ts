/**
 * Strict date-of-birth validation shared by the student API and bulk import (PRC-L159).
 *
 * The YYYY-MM-DD pattern alone accepts impossible calendar dates (2026-02-31
 * silently becomes March 3 in `new Date`), invalid months (2010-13-45 reaches
 * Prisma as Invalid Date -> 500), future dates and implausible ancient dates.
 */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Earliest accepted date of birth. */
export const MIN_DATE_OF_BIRTH = '1900-01-01';

/**
 * Returns `true` only for a real calendar date in strict YYYY-MM-DD form
 * (UTC round-trip; rejects day/month overflow).
 */
export function isStrictIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(0);
  // setUTCFullYear avoids Date.UTC mapping years 0-99 onto 1900-1999.
  d.setUTCFullYear(year, month - 1, day);
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/**
 * Validates a date of birth. Returns an error message, or `null` when valid.
 * Valid = strict calendar date, on/after 1900-01-01 and not after today (UTC).
 */
export function dateOfBirthError(value: string, now: Date = new Date()): string | null {
  if (!isStrictIsoDate(value)) {
    return 'Date of birth must be a real calendar date in YYYY-MM-DD format';
  }
  if (value < MIN_DATE_OF_BIRTH) {
    return `Date of birth must be on or after ${MIN_DATE_OF_BIRTH}`;
  }
  const today = now.toISOString().slice(0, 10);
  if (value > today) {
    return 'Date of birth cannot be in the future';
  }
  return null;
}
