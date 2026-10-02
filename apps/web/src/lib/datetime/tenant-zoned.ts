/**
 * Convert wall-clock values from `<input type="date">` / `<input type="datetime-local">`
 * into UTC instants using the tenant's IANA timezone instead of the browser's.
 *
 * `new Date('2026-01-10T17:00').toISOString()` in the browser uses whatever
 * timezone the device is set to, so the same deadline is stored differently per
 * user. Server actions call {@link wallClockToUtcIso} with the tenant timezone so
 * "17:00" at an Asia/Kolkata school always stores `11:30Z`.
 */

export const DEFAULT_TENANT_TIMEZONE = 'Asia/Kolkata';

const WALL_CLOCK_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/;
const HAS_ZONE_RE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Offset (ms) of `timeZone` from UTC at the given UTC instant. */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * Interpret `value` as wall-clock time in `timeZone` and return the UTC ISO
 * string. Date-only values resolve to the end of that local day (23:59:59) so a
 * "due on 10 Jan" deadline does not expire at the start of the day.
 *
 * Values that already carry `Z` or an explicit offset are returned normalised
 * without re-interpretation. Returns `null` for unparseable input.
 */
export function wallClockToUtcIso(value: string, timeZone: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (HAS_ZONE_RE.test(trimmed)) {
    const ms = Date.parse(trimmed);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  }
  const match = WALL_CLOCK_RE.exec(trimmed);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const dateOnly = h === undefined;
  const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TENANT_TIMEZONE;
  const guess = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    dateOnly ? 23 : Number(h),
    dateOnly ? 59 : Number(mi),
    dateOnly ? 59 : Number(s ?? 0),
  );
  if (Number.isNaN(guess)) return null;
  const firstOffset = zoneOffsetMs(guess, zone);
  let utc = guess - firstOffset;
  const secondOffset = zoneOffsetMs(utc, zone);
  if (secondOffset !== firstOffset) utc = guess - secondOffset;
  return new Date(utc).toISOString();
}
