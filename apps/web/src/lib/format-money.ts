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
