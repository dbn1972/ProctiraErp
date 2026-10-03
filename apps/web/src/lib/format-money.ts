/**
 * Shared money formatter for amounts stored as integer minor units (`*Cents`).
 *
 * Defaults to the `en-IN` locale used across the dashboard; callers that know
 * the viewer locale should pass it explicitly. The currency code always comes
 * from the record so a non-INR amount is never shown with a rupee sign.
 */
export function formatMoney(amountCents: number, currency: string, locale = 'en-IN'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency || 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountCents / 100);
}

/**
 * PRC-M095: parse a major-unit amount typed by a user ("5000", "5000.5",
 * "5,000.00") into integer minor units without floating-point maths.
 * Returns null for blank, negative, malformed or >2-decimal input.
 */
export function parseMajorUnits(raw: string): number | null {
  const text = raw.trim().replace(/,/g, '');
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(text);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}
