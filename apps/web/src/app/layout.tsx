/**
 * apps/web/src/app/layout.tsx — Root SSR layout (Task 58.1, Design §N)
 * =====================================================================
 *
 * The Next.js App Router root layout owns the tenant-themed first paint.
 * Three concerns flow through this file:
 *
 *   1. **Tenant theme bootstrap (Task 58.1, Requirement 28.1, 28.10).**
 *      `getPublishedTenantTheme()` resolves the tenant from the request
 *      headers (subdomain via middleware `X-Tenant-Slug`, falling back
 *      to `X-Tenant-ID`) and fetches the *published* theme tokens from
 *      the Theme Service. The result is cached server-side in-memory so
 *      a request burst does not stampede the upstream service. The
 *      resolved tokens are emitted into `<head>` as
 *      `<style data-tenant-theme>:root { --tenant-* }</style>` — that
 *      style block is parsed by Tailwind v4 utilities (e.g.
 *      `bg-[--tenant-primary]`) to brand the very first paint. On
 *      hydration, `<BrandConfigProvider>` reads the same `--tenant-*`
 *      properties via `extractTenantTokensFromHead()` and uses them as
 *      its initial state, then fetches `/api/v1/tenant/branding` to
 *      reconcile against any CDN cache drift. Mismatch → quiet repaint.
 *      Match → zero-paint hydration.
 *
 *   2. **Theme boot script (Task 47.1, Requirement 36 AC 4).** A small
 *      synchronous `<script>` runs before React hydrates and stamps
 *      `data-theme="light|dark"` (and the `dark` class) on `<html>`,
 *      eliminating the flash of wrong theme on hard reload.
 *
 *   3. **Locale + direction (Requirement 39).** `getLocale()` and
 *      `getDirection()` from next-intl populate `<html lang dir>` at
 *      SSR so RTL/LTR is correct from the first paint.
 *
 * The only mutable state introduced by this layout is the SSR theme
 * cache; everything else is derived from request-scoped headers, so the
 * file remains idempotent across renders.
 */
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { headers } from 'next/headers';
import { getLocale, getMessages } from 'next-intl/server';
import { getDirection } from '@/i18n/config';
import {
  getPublishedTenantTheme,
  renderTenantThemeCSS,
  resolveRequestTenantSlug,
} from '@/lib/tenant-theme/server';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import { BrandConfigProvider } from '@/providers/BrandConfigProvider';
import { LanguageProvider } from '@/providers/LanguageProvider';
import type { TranslationMap } from '@/providers/LanguageProvider';
import { getThemeBootScript } from '@/lib/theme/boot-script';
import { AppProviders } from '@/components/AppProviders';
import '@/styles/globals.css';

/**
 * Inter web font (Design §J / Requirement 39.4).
 *
 * `next/font/google` does three things automatically:
 *   1. Self-hosts the font files at build time so we are not blocked on
 *      a third-party CDN at first paint.
 *   2. Emits a `<link rel="preload" as="font" ... crossorigin>` plus the
 *      generated `@font-face` rule with `font-display: swap`, so text
 *      remains readable in the system-font fallback while Inter is in
 *      flight (no FOIT).
 *   3. Exposes the loaded family as a CSS variable that we surface as
 *      `--font-inter`. The existing `--font-sans` chain in
 *      `src/styles/globals.css` already lists Inter AFTER the system
 *      fonts, so first paint uses the OS native font and only swaps to
 *      Inter once the woff2 finishes downloading (Requirement 39.3).
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: 'ProctiraERP',
  description: 'ProctiraERP Unified Education Management Platform',
};

/**
 * Tenant theme boot sequence (Task 58.1, Design §N, Requirement 28.1, 28.10).
 *
 *   ┌──────────────────────────────────────────────────────────────────────┐
 *   │ 1. Server-rendered baseline                                          │
 *   │    `getPublishedTenantTheme()` resolves the tenant from the request  │
 *   │    headers (subdomain or `X-Tenant-ID`) and fetches the *published*  │
 *   │    theme tokens from `/api/v1/tenant/theme/published`. The result is │
 *   │    cached for 60 s in-memory so a request burst from many parallel  │
 *   │    server components does not stampede the Theme Service.            │
 *   │                                                                      │
 *   │ 2. CSS variables                                                     │
 *   │    `renderTenantThemeCSS()` emits a `<style data-tenant-theme>`      │
 *   │    block inside `<head>` that defines the seven `--tenant-*` custom  │
 *   │    properties on `:root`. Tailwind v4 classes consume those tokens   │
 *   │    (e.g. `bg-[--tenant-primary]`) so the FIRST paint is fully        │
 *   │    branded — no flash of default styling while React hydrates.       │
 *   │                                                                      │
 *   │ 3. Hydration reconciliation                                          │
 *   │    Once the bundle hydrates, `<BrandConfigProvider>` reads the same  │
 *   │    CSS properties off `:root`. It only overwrites those that differ  │
 *   │    from the SSR-injected values, so clients whose CDN-cached payload │
 *   │    matches the server response see ZERO repaints.                    │
 *   │                                                                      │
 *   │ 4. 5-minute refresh                                                  │
 *   │    `<BrandConfigProvider>` keeps a 5-minute module-level cache and   │
 *   │    refetches `/api/v1/tenant/branding` on tab focus / TTL expiry, so │
 *   │    a mid-session theme publish propagates without a hard reload.     │
 *   └──────────────────────────────────────────────────────────────────────┘
 *
 * The end-to-end contract is: the seven `--tenant-*` properties are
 * **always** defined on `:root`, regardless of whether the Theme Service
 * is reachable. On any failure path the helper falls back to the canonical
 * ProctiraERP defaults (Requirement 43.4).
 */

/**
 * Root layout with:
 * - SSR-injected tenant theme tokens for branded first paint (Task 58.1)
 * - Tenant-aware theming via CSS custom properties (BrandConfigProvider)
 * - i18n locale persistence, document.lang/dir updates, and t() fallback
 *   chain via LanguageProvider (which wraps next-intl client provider)
 * - RTL/LTR direction stamped on <html> at SSR for first paint
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const direction = getDirection(locale);

  // ─── Tenant theme baseline (Task 58.1) ──────────────────────────────────
  //
  // Resolve the tenant slug from the middleware-set headers, fetch the
  // published theme tokens, and serialize them into a string of CSS that
  // we inline into the `<head>` block below. All read paths are SSR-safe:
  // `next/headers` is only called from Server Components, the Theme
  // Service fetch falls back to ProctiraERP defaults on any failure.
  const headerStore = await headers();
  const tenantSlug = await resolveRequestTenantSlug(headerStore);
  const { tokens } = await getPublishedTenantTheme(tenantSlug);
  const tenantThemeCSS = renderTenantThemeCSS(tokens);

  return (
    <html lang={locale} dir={direction} suppressHydrationWarning className={inter.variable}>
      <head>
        {/*
          PWA manifest link (Task 54.1). The manifest itself lives in
          `apps/web/public/manifest.json` and is served at site root.
          Browsers use it for install prompts and tab metadata.
        */}
        <link rel="manifest" href="/manifest.json" />
        {/*
          Tenant theme baseline (Task 58.1, Requirement 28.1, 28.10).

          Rendered server-side so the FIRST paint already carries the
          tenant's brand. `<BrandConfigProvider>` reconciles to the
          latest tokens on hydration if the CDN-cached payload differs.
          The `data-tenant-theme` attribute lets the provider locate this
          element to remove/replace it when the tenant identity changes
          mid-session.
        */}
        <style
          data-tenant-theme="ssr"
          data-tenant-slug={tenantSlug}
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: tenantThemeCSS }}
        />
        {/*
          Theme boot script (Task 47.1, Requirement 36 AC 4).

          Runs synchronously BEFORE React hydrates so the `<html>`
          element is stamped with `data-theme="light|dark"` and the
          `dark` class on first paint. Eliminates the flash of wrong
          theme on hard reload while still being SSR-safe — the script
          itself is plain string content rendered by Next during SSR
          and only executes client-side.

          The script reads any `*-theme` localStorage key (the brand
          short name prefix), so it works for ProctiraERP, EduZo, or any
          other tenant without baking in the brand at build time.
        */}
        <script
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: getThemeBootScript() }}
        />
      </head>
      <body className="min-h-screen bg-gray-50 font-sans text-gray-900 antialiased">
        <ServiceWorkerRegister />
        <BrandConfigProvider>
          <LanguageProvider
            initialLocale={locale}
            messagesByLocale={{ [locale]: messages as TranslationMap }}
          >
            <AppProviders>{children}</AppProviders>
          </LanguageProvider>
        </BrandConfigProvider>
      </body>
    </html>
  );
}
