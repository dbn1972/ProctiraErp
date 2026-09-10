/**
 * Redis round-trips cached values through JSON, so `Date` fields come back as
 * ISO-8601 strings. Repository decorators call this on cache hits to restore
 * the shape their delegate returns.
 *
 * Only the named top-level keys are revived: entities carry opaque JSON
 * (`metadata`, `customData`, workflow definitions) whose string values must
 * stay strings even when they happen to look like timestamps. Idempotent —
 * existing `Date` instances, `null` and `undefined` pass through untouched.
 */
export const ENTITY_TIMESTAMP_KEYS = ['createdAt', 'updatedAt'] as const;

export function reviveDates<T>(value: T, keys: readonly string[] = ENTITY_TIMESTAMP_KEYS): T {
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return (value as unknown[]).map((item) => reviveDates(item, keys)) as unknown as T;
  }
  const record = value as Record<string, unknown>;
  let changed = false;
  const out: Record<string, unknown> = { ...record };
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === 'string' || typeof raw === 'number') {
      const revived = new Date(raw);
      if (!Number.isNaN(revived.getTime())) {
        out[key] = revived;
        changed = true;
      }
    }
  }
  return changed ? (out as T) : value;
}
