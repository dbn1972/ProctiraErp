/**
 * Locale-aware money formatting for the fees module.
 *
 * Six call sites previously each declared their own `formatAmount` with
 * `Intl.NumberFormat('en-IN', …)` hardcoded. That is wrong for any tenant outside
 * India: it renders grouping and currency placement in Indian conventions
 * regardless of who is looking at the screen, on a module whose entire output is
 * money.
 *
 * `locale` is required rather than defaulted, so a caller cannot silently fall
 * back to a server-ambient locale. Resolve it from next-intl:
 *
 *   Server Component:  const locale = await getLocale();   // next-intl/server
 *   Client Component:  const locale = useLocale();          // next-intl
 *
 * Amounts are integer minor units (`*_cents`), matching the database columns —
 * see `packages/backend/fees/src/money-cents.ts`. Division by 100 happens here so
 * no call site re-implements it.
 */

/**
 * Currency for fee aggregates whose API rows carry no currency (dues report,
 * reconciliation rows). Mirrors the `?? 'INR'` default in
 * `packages/backend/fees/src/fees-service.ts`; create forms omit currency so the
 * server (or the selected plan / invoice) decides.
 */
export const DEFAULT_FEE_CURRENCY = 'INR';

export function formatAmount(cents: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}
