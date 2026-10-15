import { Type, type TString } from '@sinclair/typebox';
import { FormatRegistry } from '@sinclair/typebox';

/**
 * ISO 8601 date pattern (YYYY-MM-DD). Syntactic gate only; the registered
 * `iso-calendar-date` format below adds the semantic calendar-validity check
 * so that impossible dates such as 2026-02-31 are rejected (PRC-L588).
 */
const ISO_DATE_PATTERN = '^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])$';
const ISO_DATE_REGEX = new RegExp(ISO_DATE_PATTERN);

/**
 * Returns true only when the string is a syntactically valid ISO date AND a
 * real calendar date (correct day-of-month for the given month/year, including
 * leap years). Fail-closed: anything that does not round-trip is rejected.
 */
export function isCalendarValidIsoDate(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (!ISO_DATE_REGEX.test(value)) return false;
  const parts = value.split('-');
  const year = Number.parseInt(parts[0] ?? '', 10);
  const month = Number.parseInt(parts[1] ?? '', 10);
  const day = Number.parseInt(parts[2] ?? '', 10);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  // Construct in UTC and verify each component round-trips (rejects rollover
  // such as 2026-02-31 -> 2026-03-03).
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

// Register once (idempotent — Set overwrites any prior registration).
FormatRegistry.Set('iso-calendar-date', isCalendarValidIsoDate);

/**
 * ISO 8601 date format schema (YYYY-MM-DD) with calendar-validity enforcement.
 * Validates both the ISO pattern and that the date actually exists.
 */
export const DateSchema: TString = Type.String({
  pattern: ISO_DATE_PATTERN,
  format: 'iso-calendar-date',
  description: 'ISO 8601 date (YYYY-MM-DD)',
});
