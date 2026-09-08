'use client';

/**
 * MarketingHeader — Public/anonymous header for unauthenticated routes
 * (Task 50.1, Requirements 31 AC 1, 31 AC 5, 31 AC 6, 43 AC 5).
 *
 * Composes the marketing site's persistent top chrome:
 *
 *   • Tenant logo + brand name from `useBrand()`. The image's alt text
 *     and the visible word-mark both come from the tenant configuration
 *     so multi-tenant deployments display the correct organization
 *     without hardcoding a brand string (Requirement 43.2).
 *   • Primary navigation — Features, Pricing, About, Contact, Demo —
 *     with localized labels via `useTranslations('marketing.nav')`. The
 *     active route is marked with `aria-current="page"` so assistive
 *     technologies announce the user's location.
 *   • `<LanguageSelector>` and `<ThemeToggle>` — both work anonymously
 *     because `<LanguageProvider>` and `<ThemeProvider>` sit above the
 *     `<AuthProvider>` in the provider hierarchy (Design §A).
 *   • Sign-In and Get Started CTAs — both link into the auth flow at
 *     `/login` and the marketing demo request page at `/demo`. The
 *     primary action is the Get Started button styled with the tenant
 *     theme tokens.
 *
 * Mounted by `app/(marketing)/layout.tsx` so anonymous visitors can flip
 * the theme, switch language, and proceed to sign-in without an active
 * session. Kept under the same component name `MarketingHeader` so the
 * existing public-route `app/(public)/layout.tsx` (used by the
 * Application Tracking page from Task 51.4) continues to render the
 * same chrome.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { Button } from '@proctira/ui/components';
import { LanguageSelector } from '@/components/LanguageSelector';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useBrand } from '@/providers/BrandConfigProvider';
import { cn } from '@/lib/utils';

// ─── Primary navigation model ────────────────────────────────────────────

/**
 * The five primary marketing destinations called out in Task 50.1. Order
 * matches the design intent (Features → Pricing → About → Contact →
 * Demo). Each entry's `labelKey` points at `marketing.nav.<labelKey>` in
 * the message catalogs.
 */
interface MarketingNavLink {
  labelKey: 'features' | 'pricing' | 'about' | 'contact' | 'demo';
  href: string;
}

const PRIMARY_NAV_LINKS: readonly MarketingNavLink[] = [
  { labelKey: 'features', href: '/features' },
  { labelKey: 'pricing', href: '/pricing' },
  { labelKey: 'about', href: '/about' },
  { labelKey: 'contact', href: '/contact' },
  { labelKey: 'demo', href: '/demo' },
] as const;

/**
 * Determines whether a navigation link is the active one for the current
 * pathname. Exact match for `/`, prefix match for everything else so
 * sub-routes (e.g. `/features/integrations`) still highlight the parent.
 */
export function isMarketingNavActive(pathname: string | null | undefined, href: string): boolean {
  if (!pathname) return false;
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

// ─── Component ───────────────────────────────────────────────────────────

export function MarketingHeader() {
  const t = useTranslations('marketing.nav');
  const tCta = useTranslations('marketing.cta');
  const { name, logoUrl } = useBrand();
  const pathname = usePathname();

  return (
    <header
      data-shell="marketing"
      className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-[hsl(var(--background))]/95 px-4 backdrop-blur-sm sm:px-6 lg:px-8"
    >
      {/* Brand mark — tenant logo + word-mark. */}
      <Link
        href="/"
        aria-label={`${name} home`}
        className="inline-flex min-h-12 items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl}
          alt={name}
          // Above-the-fold tenant logo — explicit dimensions stabilize the
          // header against the brand fetch (Requirement 39 — performance
          // budgets / CLS) and we mark it `data-hero` so the lint rule
          // recognises this is intentionally a priority asset (no
          // `loading="lazy"` here).
          width={40}
          height={40}
          data-hero=""
          fetchPriority="high"
          className="h-10 w-auto"
          data-testid="marketing-header-brand-logo"
        />
        <span className="text-lg font-semibold tracking-tight text-[hsl(var(--foreground))]">
          {name}
        </span>
      </Link>

      {/* Primary navigation. Hidden below `md` to make room for the
          brand and the action cluster; on mobile the items collapse
          to the side under future menu work (out of scope for 50.1
          which only wires the layout chrome). */}
      <nav
        aria-label={t('primaryLabel')}
        data-testid="marketing-header-nav"
        className="hidden md:flex"
      >
        <ul role="list" className="flex items-center gap-1">
          {PRIMARY_NAV_LINKS.map((link) => {
            const active = isMarketingNavActive(pathname, link.href);
            return (
              <li key={link.labelKey}>
                <Link
                  href={link.href}
                  aria-current={active ? 'page' : undefined}
                  data-active={active ? 'true' : undefined}
                  data-testid={`marketing-header-nav-${link.labelKey}`}
                  className={cn(
                    // 48 × 48 px hit-area floor (Requirement 37 AC 3).
                    'inline-flex min-h-[48px] items-center rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2',
                    active
                      ? 'text-[hsl(var(--foreground))]'
                      : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]',
                  )}
                >
                  {t(link.labelKey)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Action cluster. Theme/language always render so anonymous
          visitors can configure both before signing in. */}
      <div className="flex items-center gap-2 sm:gap-3">
        <ThemeToggle />
        <LanguageSelector />

        {/* CTA cluster. The sign-in link uses the ghost variant so the
            primary "Get Started" button reads as the dominant action. */}
        <Button
          asChild
          variant="ghost"
          size="sm"
          data-testid="marketing-header-sign-in"
          className="hidden sm:inline-flex"
        >
          <Link href="/login">{tCta('signIn')}</Link>
        </Button>
        <Button asChild variant="default" size="sm" data-testid="marketing-header-get-started">
          <Link href="/demo">{tCta('getStarted')}</Link>
        </Button>
      </div>
    </header>
  );
}

export default MarketingHeader;
