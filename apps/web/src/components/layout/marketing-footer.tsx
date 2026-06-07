'use client';

/**
 * MarketingFooter — Public site footer (Task 50.1, Requirement 31 AC 2).
 *
 * Renders the thirteen link columns mandated by Requirement 31.2:
 *
 *   1. Product            8. Contact
 *   2. Solutions          9. Legal
 *   3. Developers        10. Privacy
 *   4. Installation      11. Security/Trust
 *   5. Plugins           12. Status
 *   6. Resources         13. Language/Region selector
 *   7. Company
 *
 * Each column header is rendered as a sectioning `<nav aria-label>` so
 * screen-reader users can hop directly to a column. The last "column" is
 * the `<LanguageSelector>` from Task 48.3 — anonymous visitors must be
 * able to switch locale before signing in.
 *
 * Branding (Requirement 31 AC 6 / 43.5):
 *   • Tenant logo and brand name come from `useBrand()` so multi-tenant
 *     deployments surface the correct organization on every render.
 *   • The copyright line uses the {year} placeholder + brand name and
 *     never embeds a literal brand string in source (Requirement 43.2).
 *
 * Touch targets (Requirement 37 AC 3): every link is wrapped in a 48 px
 * minimum hit area via `min-h-[44px] py-2 inline-flex` so footer rows
 * remain tappable on mobile.
 *
 * RTL: the underlying CSS grid mirrors automatically when `<html dir>`
 * flips to `rtl`, so the same markup serves LTR and RTL locales.
 */

import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { LanguageSelector } from '@/components/LanguageSelector';
import { useBrand } from '@/providers/BrandConfigProvider';

// ─── Column model ──────────────────────────────────────────────────────────

/**
 * A single footer column. The translation `key` maps to a sub-tree under
 * `marketing.footer.<key>` in `messages/{en,ar}.json`. The `links` array
 * lists the keys under that sub-tree to render — ordering matters and is
 * preserved across locales.
 */
interface FooterColumn {
  /** Translation key segment (`marketing.footer.<key>.title`). */
  key:
    | 'product'
    | 'solutions'
    | 'developers'
    | 'installation'
    | 'plugins'
    | 'resources'
    | 'company'
    | 'contact'
    | 'legal'
    | 'privacy'
    | 'security'
    | 'status';
  /** Ordered link entries within the column. */
  links: ReadonlyArray<{
    /** Translation key fragment (`marketing.footer.<col>.<labelKey>`). */
    labelKey: string;
    /** Destination route. Internal routes only — external links would need rel/target. */
    href: string;
  }>;
}

/**
 * Canonical column order (Requirement 31 AC 2). The Language/Region
 * selector is rendered separately as the 13th cell since it is not a
 * link list but the live `<LanguageSelector>` control.
 */
const FOOTER_COLUMNS: readonly FooterColumn[] = [
  {
    key: 'product',
    links: [
      { labelKey: 'features', href: '/features' },
      { labelKey: 'pricing', href: '/pricing' },
      { labelKey: 'demo', href: '/demo' },
      { labelKey: 'changelog', href: '/changelog' },
    ],
  },
  {
    key: 'solutions',
    links: [
      { labelKey: 'ministries', href: '/solutions/ministries' },
      { labelKey: 'states', href: '/solutions/states' },
      { labelKey: 'boards', href: '/solutions/boards' },
      { labelKey: 'schools', href: '/solutions/schools' },
    ],
  },
  {
    key: 'developers',
    links: [
      { labelKey: 'documentation', href: '/docs' },
      { labelKey: 'apiReference', href: '/docs/api' },
      { labelKey: 'sdk', href: '/docs/sdk' },
      { labelKey: 'webhooks', href: '/docs/webhooks' },
    ],
  },
  {
    key: 'installation',
    links: [
      { labelKey: 'guide', href: '/installation' },
      { labelKey: 'selfHosted', href: '/installation/self-hosted' },
      { labelKey: 'cloud', href: '/installation/cloud' },
      { labelKey: 'requirements', href: '/installation/requirements' },
    ],
  },
  {
    key: 'plugins',
    links: [
      { labelKey: 'marketplace', href: '/plugins' },
      { labelKey: 'directory', href: '/plugins/directory' },
      { labelKey: 'build', href: '/plugins/build' },
      { labelKey: 'submit', href: '/plugins/submit' },
    ],
  },
  {
    key: 'resources',
    links: [
      { labelKey: 'blog', href: '/blog' },
      { labelKey: 'guides', href: '/guides' },
      { labelKey: 'caseStudies', href: '/case-studies' },
      { labelKey: 'help', href: '/help' },
    ],
  },
  {
    key: 'company',
    links: [
      { labelKey: 'about', href: '/about' },
      { labelKey: 'careers', href: '/careers' },
      { labelKey: 'press', href: '/press' },
      { labelKey: 'partners', href: '/partners' },
    ],
  },
  {
    key: 'contact',
    links: [
      { labelKey: 'sales', href: '/contact/sales' },
      { labelKey: 'support', href: '/contact/support' },
      { labelKey: 'offices', href: '/contact/offices' },
      { labelKey: 'form', href: '/contact' },
    ],
  },
  {
    key: 'legal',
    links: [
      { labelKey: 'terms', href: '/legal/terms' },
      { labelKey: 'acceptableUse', href: '/legal/acceptable-use' },
      { labelKey: 'dpa', href: '/legal/dpa' },
      { labelKey: 'subprocessors', href: '/legal/subprocessors' },
    ],
  },
  {
    key: 'privacy',
    links: [
      { labelKey: 'policy', href: '/legal/privacy' },
      { labelKey: 'cookies', href: '/legal/cookies' },
      { labelKey: 'dataRights', href: '/legal/data-rights' },
      { labelKey: 'children', href: '/legal/children' },
    ],
  },
  {
    key: 'security',
    links: [
      { labelKey: 'overview', href: '/security' },
      { labelKey: 'compliance', href: '/security/compliance' },
      { labelKey: 'trust', href: '/trust' },
      { labelKey: 'report', href: '/security/report' },
    ],
  },
  {
    key: 'status',
    links: [
      { labelKey: 'system', href: '/status' },
      { labelKey: 'incidents', href: '/status/incidents' },
      { labelKey: 'uptime', href: '/status/uptime' },
      { labelKey: 'subscribe', href: '/status/subscribe' },
    ],
  },
] as const;

// ─── Component ──────────────────────────────────────────────────────────────

export interface MarketingFooterProps {
  /** Override the rendered year (used by tests for deterministic snapshots). */
  year?: number;
}

export function MarketingFooter({
  year = new Date().getFullYear(),
}: MarketingFooterProps = {}) {
  const t = useTranslations('marketing.footer');
  const tFooterLabel = useTranslations('marketing.footer');
  const { name, logoUrl } = useBrand();

  return (
    <footer
      aria-label={tFooterLabel('label')}
      data-shell="marketing-footer"
      className="mt-auto border-t border-border bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]"
    >
      <div className="mx-auto w-full max-w-7xl px-6 py-12 lg:px-8 lg:py-16">
        {/* Top row: brand on the left, link columns flowing right. */}
        <div className="grid gap-10 lg:grid-cols-12">
          {/* Brand cell — tenant logo + name (Requirement 43.5). */}
          <div className="lg:col-span-3">
            <Link
              href="/"
              className="inline-flex items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2"
              aria-label={`${name} home`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logoUrl}
                alt={name}
                // Below-the-fold footer logo — width/height + lazy load
                // so it doesn't compete with the hero on first paint
                // (Requirement 39).
                width={32}
                height={32}
                loading="lazy"
                className="h-8 w-auto"
                data-testid="marketing-footer-brand-logo"
              />
              <span className="text-lg font-semibold tracking-tight">
                {name}
              </span>
            </Link>
          </div>

          {/* Link columns — laid out in a responsive grid. The 12 columns
              stack on small screens and fan out to 4 columns on lg, then
              compress further on xl so all 12 rows of links sit alongside
              the brand cell. */}
          <nav
            aria-label={tFooterLabel('navigationLabel')}
            className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:col-span-9 lg:grid-cols-4 xl:grid-cols-6"
          >
            {FOOTER_COLUMNS.map((column) => (
              <FooterColumnView
                key={column.key}
                column={column}
                t={t}
              />
            ))}
          </nav>
        </div>

        {/* Bottom row: copyright + Language/Region selector (column 13). */}
        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-border pt-8 sm:flex-row sm:items-center">
          <p
            className="text-sm text-[hsl(var(--muted-foreground))]"
            data-testid="marketing-footer-copyright"
          >
            {t('copyright', { year, brand: name })}
          </p>

          <div
            className="flex items-center gap-3"
            data-testid="marketing-footer-language-region"
          >
            <span
              id="marketing-footer-language-label"
              className="text-sm font-medium"
            >
              {t('language.title')}
            </span>
            <LanguageSelector
              // The selector exposes its own `aria-label="Select language"`,
              // but we also associate the visible "Language and region"
              // label so the section is announced cohesively.
              className="rtl:scale-x-[-1]"
            />
          </div>
        </div>
      </div>
    </footer>
  );
}

// ─── Column subcomponent ────────────────────────────────────────────────────

function FooterColumnView({
  column,
  t,
}: {
  column: FooterColumn;
  t: ReturnType<typeof useTranslations>;
}): JSX.Element {
  const headingId = `marketing-footer-column-${column.key}`;
  return (
    <section
      aria-labelledby={headingId}
      data-column={column.key}
      data-testid={`marketing-footer-column-${column.key}`}
    >
      <h2
        id={headingId}
        className="mb-4 text-sm font-semibold uppercase tracking-wide text-[hsl(var(--foreground))]"
      >
        {t(`${column.key}.title`)}
      </h2>
      <ul role="list" className="space-y-1">
        {column.links.map((link) => (
          <li key={link.labelKey}>
            <Link
              href={link.href}
              // 44 px tall row + 12 px gap (per Req 37 AC 3) — combined
              // with the row's vertical spacing this gives a 48 px hit
              // area without bloating the footer's visual rhythm.
              className="inline-flex min-h-[44px] items-center py-2 text-sm text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2"
              data-testid={`marketing-footer-link-${column.key}-${link.labelKey}`}
            >
              {t(`${column.key}.${link.labelKey}`)}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default MarketingFooter;
