/**
 * Wall-clock ↔ instant helpers for `<input type="datetime-local">` values.
 *
 * A datetime-local value has no offset. Interpreting it with `new Date()`
 * silently uses the browser timezone, so a UTC laptop booking an IST school
 * slot stored the wrong instant (PRC-L233). These helpers interpret the value
 * in an explicit IANA timezone (the tenant setting) and never throw.
 */

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Offset (ms) of `timeZone` from UTC at `instant`: local = utc + offset. */
function offsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * Convert a datetime-local value to an ISO instant, interpreting it in
 * `timeZone`. Returns `null` for blank/invalid input (never throws).
 * Without a valid `timeZone`, falls back to the runtime's local timezone.
 */
export function zonedLocalToUtcIso(local: string, timeZone?: string | null): string | null {
  const match = LOCAL_RE.exec(local.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const fields = [
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s ?? 0),
  ] as const;
  if (!timeZone || !isValidTimeZone(timeZone)) {
    const date = new Date(...fields);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const wall = Date.UTC(...fields);
  if (Number.isNaN(wall)) return null;
  let instant = wall - offsetMs(wall, timeZone);
  // Re-check once so DST transitions resolve to the offset in force at the result.
  const corrected = wall - offsetMs(instant, timeZone);
  if (corrected !== instant) instant = corrected;
  return new Date(instant).toISOString();
}

/** Format an ISO instant in `timeZone` (falls back to UTC when unset/invalid). */
export function formatInTimeZone(
  iso: string,
  timeZone: string | null | undefined,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' },
  locale = 'en-IN',
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const tz = timeZone && isValidTimeZone(timeZone) ? timeZone : 'UTC';
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: tz }).format(date);
}
/**
 * Date + time + short zone name (e.g. "1 Jun 2026, 10:00 am IST").
 * Uses component options: `timeZoneName` cannot be combined with
 * `dateStyle`/`timeStyle` (Intl throws a TypeError).
 */
export const DATE_TIME_WITH_ZONE_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
};
/** Format an ISO instant with date, time and zone label in `timeZone`. */
export function formatDateTimeWithZone(
  iso: string,
  timeZone: string | null | undefined,
  locale = 'en-IN',
): string {
  return formatInTimeZone(iso, timeZone, DATE_TIME_WITH_ZONE_OPTIONS, locale);
}
