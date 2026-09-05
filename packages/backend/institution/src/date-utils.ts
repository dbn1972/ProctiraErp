/**
 * Coerce Redis/JSON-cached Date values to ISO strings.
 *
 * Cache layers serialize `Date` to string. Calling `.toISOString()` on a
 * revived string throws and turns list/detail handlers into 500s (surfaced
 * as blank/error pages in the web app).
 */
export function toIsoString(value: Date | string): string {
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  return new Date(value as Date).toISOString();
}

/** Calendar date (YYYY-MM-DD) from a Date or ISO string. */
export function toIsoDate(value: Date | string): string {
  const iso = toIsoString(value);
  return iso.slice(0, 10);
}
