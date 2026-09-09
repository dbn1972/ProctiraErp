/** Revive ISO-8601 strings produced by JSON.stringify(Date) back into Dates. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Recursively revive ISO date strings to `Date` instances after a JSON cache round-trip.
 * Idempotent: existing `Date` instances and non-date strings are left unchanged.
 */
export function reviveDates<T>(value: T): T {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'string') {
    return (ISO_DATE.test(value) ? new Date(value) : value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return (value as unknown[]).map((v) => reviveDates(v)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = reviveDates(v);
    }
    return out as T;
  }
  return value;
}
