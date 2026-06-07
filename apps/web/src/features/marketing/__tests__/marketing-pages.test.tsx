/**
 * @vitest-environment jsdom
 *
 * Marketing & legal page smoke tests — Task 50.2
 *
 * Mounts each of the eight anonymous-accessible pages introduced by
 * Task 50.2 (Landing, About, Features, Pricing, Contact, Demo, Privacy
 * Policy, Terms of Service) under the same provider stack used by the
 * production marketing layout, and asserts:
 *
 *   • The page renders a recognizable heading sourced through `t()`.
 *   • `<MarketingLayout>` chrome is present (header + footer landmarks),
 *     proving the page is reachable from the marketing header / footer
 *     navigation (Requirement 31 AC 5).
 *
 * The intent is a thin smoke test, not a deep behavioural test — every
 * page already has copy verified through the translation catalogue, so
 * we only need to prove the page mounts without runtime errors and the
 * shared chrome is in place.
 *
 * Validates: Requirements 31.1, 31.3, 31.5, 31.6 (Task 50.2)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';

// `next/navigation` requires Next.js context that jsdom does not provide;
// the marketing header reads `usePathname()` to highlight the active
// route, so a lightweight stub keeps the chrome rendering in tests.
let currentPathname = '/';
vi.mock('next/navigation', () => ({
  usePathname: () => currentPathname,
}));

import LandingPage from '../LandingPage';
import AboutPage from '../AboutPage';
import FeaturesPage from '../FeaturesPage';
import PricingPage from '../PricingPage';
import ContactPage from '../ContactPage';
import DemoPage from '../DemoPage';
import PrivacyPolicy from '../../legal/PrivacyPolicy';
import TermsOfService from '../../legal/TermsOfService';

import {
  BrandConfigProvider,
  clearBrandCache,
  type Brand,
} from '@/providers/BrandConfigProvider';
import {
  LanguageProvider,
  type TranslationMap,
} from '@/providers/LanguageProvider';
import { ThemeProvider } from '@/providers/ThemeProvider';
import enMessages from '@/messages/en.json';

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

function renderPage(
  Page: React.ComponentType,
  pathname = '/',
): ReturnType<typeof render> {
  currentPathname = pathname;
  return render(
    <BrandConfigProvider initialBrand={SAMPLE_BRAND}>
      <LanguageProvider
        initialLocale="en"
        messagesByLocale={{ en: enMessages as unknown as TranslationMap }}
      >
        <ThemeProvider>
          <Page />
        </ThemeProvider>
      </LanguageProvider>
    </BrandConfigProvider>,
  );
}

beforeEach(() => {
  clearBrandCache();
  document.title = '';
  currentPathname = '/';
  cleanup();

  // Radix internals reach for these jsdom does not provide. The
  // dropdowns inside `<LanguageSelector>` (mounted by the marketing
  // header/footer) instantiate observers eagerly.
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      } as unknown as typeof ResizeObserver;
  }
  /* eslint-disable @typescript-eslint/unbound-method --
     Polyfill probes intentionally read the prototype slot. */
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

interface PageCase {
  name: string;
  Page: React.ComponentType;
  pathname: string;
  pageTestId: string;
  /** Heading text that should appear on the page. */
  expectedHeading: string;
}

const PAGE_CASES: readonly PageCase[] = [
  {
    name: 'LandingPage',
    Page: LandingPage,
    pathname: '/',
    pageTestId: 'marketing-landing-page',
    expectedHeading: 'Education management, unified.',
  },
  {
    name: 'AboutPage',
    Page: AboutPage,
    pathname: '/about',
    pageTestId: 'marketing-about-page',
    expectedHeading:
      'Open source education infrastructure for the public good',
  },
  {
    name: 'FeaturesPage',
    Page: FeaturesPage,
    pathname: '/features',
    pageTestId: 'marketing-features-page',
    expectedHeading: 'An EMIS that grows with you',
  },
  {
    name: 'PricingPage',
    Page: PricingPage,
    pathname: '/pricing',
    pageTestId: 'marketing-pricing-page',
    expectedHeading: 'Plans that scale with your jurisdiction',
  },
  {
    name: 'ContactPage',
    Page: ContactPage,
    pathname: '/contact',
    pageTestId: 'marketing-contact-page',
    expectedHeading: 'Talk to the ProctiraERP team',
  },
  {
    name: 'DemoPage',
    Page: DemoPage,
    pathname: '/demo',
    pageTestId: 'marketing-demo-page',
    expectedHeading: 'See ProctiraERP in your context',
  },
  {
    name: 'PrivacyPolicy',
    Page: PrivacyPolicy,
    pathname: '/legal/privacy',
    pageTestId: 'legal-privacy-page',
    expectedHeading: 'Privacy Policy',
  },
  {
    name: 'TermsOfService',
    Page: TermsOfService,
    pathname: '/legal/terms',
    pageTestId: 'legal-terms-page',
    expectedHeading: 'Terms of Service',
  },
];

describe('Marketing & legal pages — smoke tests (Task 50.2)', () => {
  for (const { name, Page, pathname, pageTestId, expectedHeading } of PAGE_CASES) {
    it(`${name} renders its heading and the shared marketing chrome`, () => {
      renderPage(Page, pathname);

      // Page renders with its expected heading.
      expect(screen.getByTestId(pageTestId)).toBeTruthy();
      const heading = screen.getByRole('heading', {
        level: 1,
        name: expectedHeading,
      });
      expect(heading).toBeTruthy();

      // Shared chrome is present so the page is reachable from the
      // marketing header and footer navigation (Requirement 31 AC 5).
      expect(document.querySelector('[data-shell="marketing"]')).not.toBeNull();
      expect(
        document.querySelector('[data-shell="marketing-footer"]'),
      ).not.toBeNull();
    });
  }
});
