/**
 * PRC-L262 — the routed Privacy Policy and Terms render the Decision D5
 * DPDP-aligned draft, visibly marked "draft — pending legal review", and
 * never claim legal compliance (D5 guardrail).
 *
 * Renders the route modules (as `app/legal/legal-chrome.test.tsx` does) so the
 * assertion covers what `/legal/privacy` and `/legal/terms` actually serve.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import PrivacyPolicyRoute from '@/app/legal/privacy/page';
import TermsOfServiceRoute from '@/app/legal/terms/page';

vi.mock('@/providers/LanguageProvider', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock('@/providers/BrandConfigProvider', () => ({
  useBrand: () => ({ brand: { name: 'Test Tenant' } }),
}));

vi.mock('@/components/DocumentTitle', () => ({
  DocumentTitle: () => null,
}));

const PAGES = [
  { name: '/legal/privacy', Page: PrivacyPolicyRoute, testId: 'legal-privacy-page' },
  { name: '/legal/terms', Page: TermsOfServiceRoute, testId: 'legal-terms-page' },
] as const;

describe('legal pages carry the D5 draft marker (PRC-L262)', () => {
  for (const { name, Page, testId } of PAGES) {
    it(`${name} shows a visible "pending legal review" draft note`, () => {
      render(<Page />);
      const note = screen.getByTestId('legal-draft-notice');
      expect(note).toHaveAttribute('role', 'note');
      expect(note.textContent).toMatch(/draft/i);
      expect(note.textContent).toContain('pending legal review');
      expect(within(screen.getByTestId(testId)).getByTestId('legal-draft-notice')).toBe(note);
    });

    it(`${name} does not claim legal compliance`, () => {
      render(<Page />);
      expect(screen.getByTestId(testId).textContent).not.toMatch(/\bcomplian(t|ce)\b/i);
    });
  }

  it('/legal/privacy carries the DPDP-shaped notice sections', () => {
    render(<PrivacyPolicyRoute />);
    const page = screen.getByTestId('legal-privacy-page');
    expect(page.textContent).toContain('Digital Personal Data Protection Act');
    expect(screen.getByRole('heading', { name: /data fiduciary/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /children.s data/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /data principal rights/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /grievance/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /retention/i })).toBeInTheDocument();
    // Tenant-configurable placeholder, not an invented contact.
    expect(page.textContent).toContain('[institution DPO contact — set by your institution]');
  });

  it('/legal/privacy numbers its sections 1..n in order with a single rights section', () => {
    render(<PrivacyPolicyRoute />);
    const numbers = screen
      .getAllByRole('heading', { level: 2 })
      .map((h) => /^(\d+)\./.exec(h.textContent ?? '')?.[1])
      .filter((n): n is string => n !== undefined)
      .map(Number);
    expect(numbers.length).toBeGreaterThan(0);
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
    // D5 §6: one rights channel ("exercised through your institution"); no legacy copy that
    // routes rights requests elsewhere or lists non-DPDP rights.
    expect(screen.getAllByRole('heading', { level: 2, name: /rights/i })).toHaveLength(1);
    const page = screen.getByTestId('legal-privacy-page');
    expect(page.textContent).toContain('exercised through your institution');
    expect(page.textContent).not.toMatch(/portability|operating ministry or board/i);
  });

  it('/legal/terms carries the D5 terms summary with the counsel placeholder', () => {
    render(<TermsOfServiceRoute />);
    const page = screen.getByTestId('legal-terms-page');
    expect(page.textContent).toContain('[counsel to supply jurisdiction-specific terms]');
    for (const topic of [
      /acceptable use/i,
      /institution-owned data/i,
      /service availability/i,
      /limitation of liability/i,
    ]) {
      expect(page.textContent).toMatch(topic);
    }
  });
});
