/**
 * PRC-M494: shared plausibility helpers for web zod schemas.
 *
 * - `isoDate` rejects impossible calendar dates (2025-02-31) via a UTC
 *   round-trip, not only the YYYY-MM-DD shape.
 * - `pastIsoDate` (date of birth etc.) rejects dates after "today".
 * - "Today" is the tenant wall-clock date (default Asia/Kolkata), not UTC, so
 *   01:00 IST counts as the local day.
 * - `base64MaxBytes` bounds decoded payload size client-side.
 */
import { z } from 'zod';
import { DEFAULT_TENANT_TIMEZONE } from '@/lib/datetime/tenant-zoned';

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True when `value` is YYYY-MM-DD and names a real calendar day. */
export function isRealIsoDate(value: string): boolean {
  const m = ISO_DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** YYYY-MM-DD of `now` on the wall clock of `timeZone`. */
export function todayInTimeZone(
  timeZone: string = DEFAULT_TENANT_TIMEZONE,
  now: Date = new Date(),
): string {
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export const isoDate = z
  .string()
  .min(1, 'Date is required')
  .regex(ISO_DATE_RE, 'Use the YYYY-MM-DD date format')
  .refine(isRealIsoDate, 'Enter a real calendar date');

export const isoDateOptional = z
  .string()
  .regex(ISO_DATE_RE, 'Use the YYYY-MM-DD date format')
  .refine(isRealIsoDate, 'Enter a real calendar date')
  .or(z.literal(''));

/** A real date that is not after the tenant's local today (e.g. date of birth). */
export const pastIsoDate = isoDate.refine(
  (value) => value <= todayInTimeZone(),
  'Date cannot be in the future',
);

/** Decoded byte size of a base64 string (ignores a data: URL prefix). */
export function base64DecodedBytes(value: string): number {
  const body = value.includes(',') ? value.slice(value.indexOf(',') + 1) : value;
  const clean = body.replace(/\s/g, '');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - padding;
}

/** Non-empty base64 payload of at most `maxBytes` decoded bytes. */
export function base64MaxBytes(maxBytes: number, label = 'File') {
  const mb = Math.round((maxBytes / (1024 * 1024)) * 10) / 10;
  return z
    .string()
    .min(1, `${label} is required`)
    .refine((v) => base64DecodedBytes(v) <= maxBytes, `${label} must be ${mb} MB or smaller`);
}

/** Open-ended record bounded by key count. */
export function boundedRecord(maxKeys: number) {
  return z
    .record(z.string().max(100), z.unknown())
    .refine((r) => Object.keys(r).length <= maxKeys, `At most ${maxKeys} custom fields`);
}
