/**
 * Calendar-date helpers that honour the tenant's IANA timezone (PRC-L248).
 *
 * `new Date().toISOString().slice(0, 10)` is the UTC date, which is the
 * previous calendar day for IST users between 00:00 and 05:30.
 */

/** YYYY-MM-DD for `now` as seen in `timeZone`; falls back to UTC for an invalid zone. */
export function isoDateInTimeZone(timeZone: string | null | undefined, now: Date = new Date()) {
  try {
    if (timeZone) {
      // en-CA formats as YYYY-MM-DD.
      return new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(now);
    }
  } catch {
    // Unknown zone: fall through to UTC.
  }
  return now.toISOString().slice(0, 10);
}
