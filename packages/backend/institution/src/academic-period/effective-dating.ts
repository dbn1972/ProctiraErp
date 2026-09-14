/**
 * W1-DATA-07 — as-of helpers for academic period effective windows.
 * SQL mirrors start_date/end_date onto valid_from/valid_to; Prisma continues
 * to read startDate/endDate as the operational span.
 */
export function toUtcDateOnly(value: Date | string): string {
  if (typeof value === 'string') {
    return value.slice(0, 10);
  }
  return value.toISOString().slice(0, 10);
}

/** Inclusive [validFrom, validTo] check (date-only, UTC). */
export function isEffectiveOn(
  validFrom: Date | string,
  validTo: Date | string,
  asOf: Date | string,
): boolean {
  const from = toUtcDateOnly(validFrom);
  const to = toUtcDateOnly(validTo);
  const at = toUtcDateOnly(asOf);
  return from <= at && at <= to;
}
