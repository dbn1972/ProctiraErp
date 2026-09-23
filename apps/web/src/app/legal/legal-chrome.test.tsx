/**
 * The routed legal pages must not publish the marketing chrome.
 *
 * ## Why this is a render test and not a source scan
 *
 * `app/legal/privacy/page.tsx` renders `<PrivacyPolicy chrome="minimal" />`. Whether the
 * marketing header and footer end up in the output is decided one level down, inside the
 * component — so grepping the `app/` tree for `<MarketingLayout>` cannot see it. A first
 * attempt at a source-level guard passed happily when the `chrome` prop was removed, which
 * is the whole failure it was meant to prevent.
 *
 * It renders the **route modules**, not the components, for the same reason: passing the
 * prop is the route's job, so a test that supplies the prop itself cannot notice the route
 * dropping it. Both sabotages — removing `chrome="minimal"` from the route, and making the
 * component ignore the prop — fail this file.
 *
 * ## What is at stake
 *
 * `MarketingHeader` + `MarketingFooter` carry 45 link targets with no route in this app
 * (`/features`, `/pricing`, `/docs/api`, `/solutions/ministries`, `/legal/dpa`, …), because
 * `app/(marketing)/` has a layout and no `page.tsx` and nothing else renders them.
 * `dead-internal-links.test.ts` excludes those two files precisely because they are
 * unreachable. Routing a page through `<MarketingLayout>` would make all 45 live — on a
 * consent document, whose own footer "Legal" and "Privacy" columns are half dead.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import PrivacyPolicyRoute from './privacy/page';
import TermsOfServiceRoute from './terms/page';

vi.mock('@/providers/LanguageProvider', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock('@/providers/BrandConfigProvider', () => ({
  useBrand: () => ({ brand: { name: 'Test Tenant' } }),
}));

vi.mock('@/components/DocumentTitle', () => ({
  DocumentTitle: () => null,
}));

/**
 * The default (`chrome="marketing"`) variant is asserted by
 * `features/marketing/__tests__/marketing-pages.test.tsx`, which renders both components
 * and checks the header/footer landmarks. Re-asserting it here would duplicate that and
 * need next-intl and brand mocks for chrome this file exists to prove is *absent*.
 */
const PAGES = [
  { name: '/legal/privacy', Page: PrivacyPolicyRoute, testId: 'legal-privacy-page' },
  { name: '/legal/terms', Page: TermsOfServiceRoute, testId: 'legal-terms-page' },
] as const;

describe('legal documents with minimal chrome', () => {
  for (const { name, Page, testId } of PAGES) {
    it(`${name} renders the document without the marketing chrome`, () => {
      render(<Page />);

      expect(screen.getByTestId(testId)).toBeInTheDocument();
      // The chrome that carries the dead links.
      expect(screen.queryByTestId('marketing-header-nav')).not.toBeInTheDocument();
      expect(screen.queryByTestId('marketing-header-brand-logo')).not.toBeInTheDocument();
    });

    it(`${name} still offers a way back and names the tenant`, () => {
      render(<Page />);

      // Minimal is not bare: an anonymous reader arrives from sign-in or signup and needs
      // a route out, and the brand comes from useBrand() rather than a literal.
      expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute(
        'href',
        '/login',
      );
      expect(screen.getByText('Test Tenant')).toBeInTheDocument();
    });
  }
});
