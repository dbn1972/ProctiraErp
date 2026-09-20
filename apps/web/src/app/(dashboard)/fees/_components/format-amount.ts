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
export function formatAmount(cents: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}
