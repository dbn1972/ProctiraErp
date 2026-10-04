/**
 * Display helpers for the parent portal fee and library pages (PRC-L064).
 *
 * Both pages are force-dynamic Server Components, so `toLocaleDateString()`
 * with no arguments rendered in the server's ambient locale and timezone
 * (e.g. MM/DD/YYYY in UTC), which shifts a due date stored as 18:30Z back a
 * day for an IST school. Callers pass the next-intl locale and an explicit
 * school timezone.
 */

/** Used until a parent-readable tenant timezone is exposed by the gateway. */
export const DEFAULT_SCHOOL_TIME_ZONE = 'Asia/Kolkata';

export function formatSchoolDate(
  value: string | Date,
  locale: string,
  timeZone: string = DEFAULT_SCHOOL_TIME_ZONE,
): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone }).format(date);
}

export function formatSchoolDateTime(
  value: string | Date,
  locale: string,
  timeZone: string = DEFAULT_SCHOOL_TIME_ZONE,
): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(date);
}

export function formatMoney(cents: number, currency: string, locale: string): string {
  const code = currency.trim().toUpperCase();
  // No currency on the record: show the number without inventing a symbol.
  if (!code) {
    return new Intl.NumberFormat(locale, { minimumFractionDigits: 2 }).format(cents / 100);
  }
  return new Intl.NumberFormat(locale, { style: 'currency', currency: code }).format(cents / 100);
}

/**
 * Sum minor-unit amounts per currency. Amounts in different currencies must
 * never be added together; zero totals are dropped so a fully paid currency
 * does not render a "0.00" line. Sorted by currency code for stable output.
 */
export function totalsByCurrency(
  entries: ReadonlyArray<{ currency: string; cents: number }>,
): Array<{ currency: string; cents: number }> {
  const totals = new Map<string, number>();
  for (const { currency, cents } of entries) {
    const code = currency.trim().toUpperCase();
    if (!code) continue;
    totals.set(code, (totals.get(code) ?? 0) + cents);
  }
  return [...totals.entries()]
    .filter(([, cents]) => cents > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, cents]) => ({ currency, cents }));
}
