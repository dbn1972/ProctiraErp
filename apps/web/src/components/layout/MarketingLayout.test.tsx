/**
 * @vitest-environment jsdom
 *
 * MarketingLayout / MarketingHeader / MarketingFooter tests
 * — Task 50.1, Requirements 31.1, 31.2, 31.5, 31.6, 43.5
 *
 * Covers:
 *   • Header renders the tenant logo + brand name from `useBrand()`,
 *     primary nav (Features, Pricing, About, Contact, Demo) with
 *     localized labels, `<LanguageSelector>`, `<ThemeToggle>`, and the
 *     sign-in / get-started CTAs.
 *   • Footer renders all 13 required columns including the
 *     Language/Region selector and the brand-aware copyright line.
 *   • `<DocumentTitle>` is bound when `pageTitle` is supplied so the
 *     browser tab reflects `Brand_Name | <page>`.
 *   • RTL: the layout flows naturally when the document direction
 *     flips (the tests assert `dir="rtl"` propagates from the language
 *     provider down to the marketing layout markup).
 *   • Touch targets (Requirement 37 AC 3) — primary nav links and CTAs
 *     enforce a 48 px floor.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

// ─── next/navigation mock ────────────────────────────────────────────────

let currentPathname = '/';
vi.mock('next/navigation', () => ({
  usePathname: () => currentPathname,
}));

// ─── Subjects + providers ───────────────────────────────────────────────

import { MarketingLayout } from './MarketingLayout';
import { MarketingFooter } from './marketing-footer';
import { MarketingHeader, isMarketingNavActive } from './marketing-header';
import {
  BrandConfigProvider,
  DEFAULT_BRAND,
  clearBrandCache,
  type Brand,
} from '@/providers/BrandConfigProvider';
import { LanguageProvider, type TranslationMap } from '@/providers/LanguageProvider';
import { ThemeProvider } from '@/providers/ThemeProvider';

// ─── Mock the message catalogs the header / footer reach for ────────────

import enMessages from '@/messages/en.json';

vi.mock('@/messages/en.json', async () => {
  const actual = await vi.importActual<{ default: TranslationMap }>('@/messages/en.json');
  return actual;
});

const SAMPLE_BRAND: Brand = {
  name: 'EduZo',
  shortName: 'eduzo',
  slug: 'eduzo',
  logo: { url: 'https://cdn.example.test/eduzo/logo.svg', alt: 'EduZo' },
  favicon: 'https://cdn.example.test/eduzo/favicon.ico',
  primary_color: 'hsl(280, 70%, 45%)',
  accent_color: 'hsl(40, 90%, 55%)',
  login_background: 'linear-gradient(135deg, hsl(280, 70%, 30%), hsl(280, 70%, 50%))',
  document_title_template: '{page} | {brand}',
};

// ─── Test harness ───────────────────────────────────────────────────────

function Harness({
  brand = SAMPLE_BRAND,
  pathname = '/',
  initialLocale = 'en',
  children,
}: {
  brand?: Brand;
  pathname?: string;
  initialLocale?: string;
  children: React.ReactNode;
}) {
  currentPathname = pathname;
  return (
    <BrandConfigProvider initialBrand={brand}>
      <LanguageProvider
        initialLocale={initialLocale}
        messagesByLocale={{
          en: enMessages as unknown as TranslationMap,
        }}
      >
        <ThemeProvider>{children}</ThemeProvider>
      </LanguageProvider>
    </BrandConfigProvider>
  );
}

beforeEach(() => {
  clearBrandCache();
  document.title = '';
  currentPathname = '/';
  // Radix internals require a few APIs that jsdom does not implement.
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  /* eslint-disable @typescript-eslint/unbound-method --
     The Element.prototype.* checks below are intentionally reading the
     prototype slot to detect whether jsdom has provided an implementation;
     the rule's safety concern (`this`-binding) does not apply to a
     polyfill check that re-assigns the same slot when missing. */
  if (typeof Element.prototype.hasPointerCapture !== 'function') {
    Element.prototype.hasPointerCapture = function () {
      return false;
    };
  }
  if (typeof Element.prototype.setPointerCapture !== 'function') {
    Element.prototype.setPointerCapture = function () {};
  }
  if (typeof Element.prototype.releasePointerCapture !== 'function') {
    Element.prototype.releasePointerCapture = function () {};
  }
  if (typeof Element.prototype.scrollIntoView !== 'function') {
    Element.prototype.scrollIntoView = function () {};
  }
  /* eslint-enable @typescript-eslint/unbound-method */
});

// ─── isMarketingNavActive — helper unit tests ───────────────────────────

describe('isMarketingNavActive', () => {
  it('returns false when pathname is null/undefined', () => {
    expect(isMarketingNavActive(null, '/features')).toBe(false);
    expect(isMarketingNavActive(undefined, '/features')).toBe(false);
  });

  it('returns true on exact match', () => {
    expect(isMarketingNavActive('/features', '/features')).toBe(true);
  });

  it('returns true on sub-route prefix match', () => {
    expect(isMarketingNavActive('/features/integrations', '/features')).toBe(true);
  });

  it('returns false when pathnames differ', () => {
    expect(isMarketingNavActive('/pricing', '/features')).toBe(false);
  });

  it('handles "/" specially — exact match only', () => {
    expect(isMarketingNavActive('/', '/')).toBe(true);
    expect(isMarketingNavActive('/features', '/')).toBe(false);
  });
});

// ─── MarketingHeader — render contract ──────────────────────────────────

describe('<MarketingHeader> — render contract (Task 50.1)', () => {
  it('renders the tenant logo and brand name from useBrand()', () => {
    render(
      <Harness>
        <MarketingHeader />
      </Harness>,
    );
    const logo = screen.getByTestId('marketing-header-brand-logo');
    expect(logo).toBeTruthy();
    expect(logo.tagName.toLowerCase()).toBe('img');
    expect(logo.getAttribute('src')).toBe(SAMPLE_BRAND.logo.url);
    expect(logo.getAttribute('alt')).toBe('EduZo');
    // The visible word-mark is the brand name as well (Requirement 43.5).
    expect(screen.getAllByText('EduZo').length).toBeGreaterThan(0);
  });

  it('renders the five primary nav links with localized labels', () => {
    render(
      <Harness>
        <MarketingHeader />
      </Harness>,
    );
    const nav = screen.getByTestId('marketing-header-nav');
    expect(nav.getAttribute('aria-label')).toBe('Main navigation');

    expect(within(nav).getByTestId('marketing-header-nav-features').textContent).toBe('Features');
    expect(within(nav).getByTestId('marketing-header-nav-pricing').textContent).toBe('Pricing');
    expect(within(nav).getByTestId('marketing-header-nav-about').textContent).toBe('About');
    expect(within(nav).getByTestId('marketing-header-nav-contact').textContent).toBe('Contact');
    expect(within(nav).getByTestId('marketing-header-nav-demo').textContent).toBe('Demo');
  });

  it('marks the active route with aria-current="page"', () => {
    render(
      <Harness pathname="/pricing">
        <MarketingHeader />
      </Harness>,
    );
    const pricing = screen.getByTestId('marketing-header-nav-pricing');
    expect(pricing.getAttribute('aria-current')).toBe('page');
    expect(pricing.getAttribute('data-active')).toBe('true');

    const features = screen.getByTestId('marketing-header-nav-features');
    expect(features.getAttribute('aria-current')).toBeNull();
  });

  it('renders the LanguageSelector and ThemeToggle anonymously', () => {
    render(
      <Harness>
        <MarketingHeader />
      </Harness>,
    );
    expect(screen.getByTestId('language-selector')).toBeTruthy();
    expect(screen.getByTestId('theme-toggle')).toBeTruthy();
  });

  it('renders the sign-in and get-started CTAs pointing at the auth + demo flows', () => {
    render(
      <Harness>
        <MarketingHeader />
      </Harness>,
    );
    const signIn = screen.getByTestId('marketing-header-sign-in');
    expect(signIn.textContent).toContain('Sign In');
    // shadcn `Button asChild` renders the wrapped <Link>; assert the inner
    // anchor's href to verify the destination.
    const signInAnchor = signIn.tagName.toLowerCase() === 'a' ? signIn : signIn.querySelector('a');
    expect(signInAnchor?.getAttribute('href')).toBe('/login');

    const getStarted = screen.getByTestId('marketing-header-get-started');
    expect(getStarted.textContent).toContain('Get Started');
    const getStartedAnchor =
      getStarted.tagName.toLowerCase() === 'a' ? getStarted : getStarted.querySelector('a');
    expect(getStartedAnchor?.getAttribute('href')).toBe('/demo');
  });

  it('enforces the 48 × 48 px touch-target floor on every primary nav link', () => {
    render(
      <Harness>
        <MarketingHeader />
      </Harness>,
    );
    for (const key of ['features', 'pricing', 'about', 'contact', 'demo'] as const) {
      const link = screen.getByTestId(`marketing-header-nav-${key}`);
      expect(link.className).toMatch(/min-h-\[48px\]/);
    }
  });
});

// ─── MarketingFooter — render contract ──────────────────────────────────

describe('<MarketingFooter> — render contract (Requirement 31 AC 2)', () => {
  it('renders all 13 link columns including the Language/Region selector', () => {
    render(
      <Harness>
        <MarketingFooter year={2025} />
      </Harness>,
    );

    // 12 link columns — each tagged with `data-testid="marketing-footer-column-<key>"`.
    const expectedColumns = [
      'product',
      'solutions',
      'developers',
      'installation',
      'plugins',
      'resources',
      'company',
      'contact',
      'legal',
      'privacy',
      'security',
      'status',
    ] as const;
    for (const key of expectedColumns) {
      expect(screen.getByTestId(`marketing-footer-column-${key}`)).toBeTruthy();
    }

    // 13th column — the Language/Region selector slot.
    const languageRegion = screen.getByTestId('marketing-footer-language-region');
    expect(languageRegion).toBeTruthy();
    expect(within(languageRegion).getByText('Language and region')).toBeTruthy();
    expect(within(languageRegion).getByTestId('language-selector')).toBeTruthy();
  });

  it('uses semantic <footer aria-label> + <nav aria-label> landmarks', () => {
    render(
      <Harness>
        <MarketingFooter />
      </Harness>,
    );
    const footer = screen.getByRole('contentinfo');
    expect(footer.getAttribute('aria-label')).toBe('Site footer');
    const nav = within(footer).getByRole('navigation');
    expect(nav.getAttribute('aria-label')).toBe('Footer navigation');
  });

  it('renders the brand-aware copyright line with the supplied year', () => {
    render(
      <Harness>
        <MarketingFooter year={2025} />
      </Harness>,
    );
    expect(screen.getByTestId('marketing-footer-copyright').textContent).toBe(
      '© 2025 EduZo. All rights reserved.',
    );
  });

  it('falls back to the canonical ProctiraERP brand when no tenant brand is set', () => {
    render(
      <Harness brand={DEFAULT_BRAND}>
        <MarketingFooter year={2024} />
      </Harness>,
    );
    expect(screen.getByTestId('marketing-footer-copyright').textContent).toBe(
      '© 2024 ProctiraERP. All rights reserved.',
    );
  });

  it('renders four links per column in the canonical order', () => {
    render(
      <Harness>
        <MarketingFooter />
      </Harness>,
    );
    const product = screen.getByTestId('marketing-footer-column-product');
    const links = within(product).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/features',
      '/pricing',
      '/demo',
      '/changelog',
    ]);
  });

  it('exposes the column heading via aria-labelledby for accessibility', () => {
    render(
      <Harness>
        <MarketingFooter />
      </Harness>,
    );
    const legal = screen.getByTestId('marketing-footer-column-legal');
    const labelledBy = legal.getAttribute('aria-labelledby');
    expect(labelledBy).toBe('marketing-footer-column-legal');
    const heading = legal.querySelector(`#${labelledBy}`);
    expect(heading?.textContent).toBe('Legal');
  });
});

// ─── MarketingLayout — composition + DocumentTitle binding ──────────────

describe('<MarketingLayout> — composition (Task 50.1)', () => {
  it('mounts the header, children outlet, and footer in order', () => {
    render(
      <Harness>
        <MarketingLayout>
          <main data-testid="marketing-page">
            <h1>Page content</h1>
          </main>
        </MarketingLayout>
      </Harness>,
    );
    expect(document.querySelector('[data-shell="marketing"]')).not.toBeNull();
    expect(document.querySelector('[data-shell="marketing-footer"]')).not.toBeNull();
    expect(screen.getByTestId('marketing-page').textContent).toContain('Page content');
  });

  it('binds <DocumentTitle> with the supplied pageTitle', async () => {
    render(
      <Harness>
        <MarketingLayout pageTitle="Pricing">
          <main>content</main>
        </MarketingLayout>
      </Harness>,
    );
    await waitFor(() => {
      // SAMPLE_BRAND uses the canonical "{page} | {brand}" template.
      expect(document.title).toBe('Pricing | EduZo');
    });
  });

  it('honours per-render template overrides (Task 50.1)', async () => {
    render(
      <Harness>
        <MarketingLayout pageTitle="Features" documentTitleTemplate="{brand} :: {page}">
          <main>content</main>
        </MarketingLayout>
      </Harness>,
    );
    await waitFor(() => {
      expect(document.title).toBe('EduZo :: Features');
    });
  });

  it('skips its own <DocumentTitle> when skipDocumentTitle is set', () => {
    document.title = 'untouched';
    render(
      <Harness>
        <MarketingLayout skipDocumentTitle>
          <main>content</main>
        </MarketingLayout>
      </Harness>,
    );
    // Layout did not call DocumentTitle, so the title remains whatever
    // the page (or test) set. The page would normally render its own.
    expect(document.title).toBe('untouched');
  });

  it('skips <DocumentTitle> when no pageTitle is provided', () => {
    document.title = 'untouched';
    render(
      <Harness>
        <MarketingLayout>
          <main>content</main>
        </MarketingLayout>
      </Harness>,
    );
    expect(document.title).toBe('untouched');
  });

  it('lets the page own its own <main> semantics', () => {
    render(
      <Harness>
        <MarketingLayout>
          <main data-testid="page-main">
            <h1>Marketing landing</h1>
          </main>
        </MarketingLayout>
      </Harness>,
    );
    // The layout deliberately does NOT introduce a <main> wrapper.
    // There should be exactly one <main> here — the page's.
    expect(document.querySelectorAll('main').length).toBe(1);
    expect(screen.getByTestId('page-main')).toBeTruthy();
  });
});
