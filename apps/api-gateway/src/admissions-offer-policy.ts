/**
 * PRC-L002: money and calendar rules for the admissions offer → enrolment path.
 *
 * - Offer fee amounts go through the shared `majorUnitsToCents` (no bare float `* 100`), so
 *   sub-cent or non-finite amounts are rejected instead of silently rounded.
 * - The enrolment date and admission-number year follow the tenant's local calendar
 *   (IANA timezone from tenant config, default Asia/Kolkata), not the UTC calendar —
 *   an offer accepted at 00:30 IST on 1 January belongs to the new year.
 */
import { majorUnitsToCents } from '@proctira/backend-fees';

export const DEFAULT_TENANT_TIMEZONE = 'Asia/Kolkata';

/** Convert an offer fee (major units) to non-negative integer cents, rejecting invalid input. */
export function offerFeeAmountCents(feeAmount: number | string): number {
  return majorUnitsToCents(feeAmount);
}

/** Return `timeZone` if it is a valid IANA zone, otherwise the platform default. */
export function resolveTenantTimeZone(timeZone: unknown): string {
  if (typeof timeZone !== 'string' || timeZone.trim() === '') return DEFAULT_TENANT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone });
    return timeZone;
  } catch {
    return DEFAULT_TENANT_TIMEZONE;
  }
}

/** Calendar date (YYYY-MM-DD) of `now` in the tenant timezone. */
export function tenantLocalDate(now: Date, timeZone: unknown): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: resolveTenantTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Admission number `ADM-<tenant-local year>-<seq padded to 4>`. */
export function formatAdmissionNumber(now: Date, timeZone: unknown, seq: number): string {
  const year = tenantLocalDate(now, timeZone).slice(0, 4);
  return `ADM-${year}-${String(seq).padStart(4, '0')}`;
}
