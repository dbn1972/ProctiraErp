/**
 * PRC-L263 — render test for the Help page (previously only a source-text scan
 * in help-accuracy.test.ts covered it).
 */
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveSupportTicketHref = vi.fn<() => string | null>();

vi.mock('@/components/DocumentTitle', () => ({ DocumentTitle: () => null }));
vi.mock('@/lib/support', () => ({
  resolveSupportTicketHref: () => resolveSupportTicketHref(),
}));

import HelpPage from './page';

beforeEach(() => {
  resolveSupportTicketHref.mockReset();
});

describe('HelpPage (PRC-L263)', () => {
  it('renders one h1, the module guides and the keyboard shortcuts', () => {
    resolveSupportTicketHref.mockReturnValue(null);
    render(<HelpPage />);

    const page = screen.getByTestId('help-page');
    expect(within(page).getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(within(page).getByRole('heading', { level: 1 })).toHaveTextContent('Help');
    expect(within(page).getByRole('link', { name: /Students/ })).toHaveAttribute(
      'href',
      '/students',
    );
    const shortcuts = page.querySelectorAll('kbd');
    expect([...shortcuts].map((k) => k.textContent)).toEqual([
      '⌘ K / Ctrl K',
      'Esc',
      'Tab / Shift Tab',
      'Enter',
    ]);
  });

  it('links the support ticket to the resolved URL in a new tab', () => {
    resolveSupportTicketHref.mockReturnValue('https://support.example.org/new');
    render(<HelpPage />);

    const link = screen.getByTestId('raise-support-ticket');
    expect(link).toHaveAttribute('href', 'https://support.example.org/new');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByTestId('support-ticket-unconfigured')).toBeNull();
  });

  it('opens a mailto support link in place', () => {
    resolveSupportTicketHref.mockReturnValue('mailto:help@example.org');
    render(<HelpPage />);
    expect(screen.getByTestId('raise-support-ticket')).not.toHaveAttribute('target');
  });

  it('says the ticket link is not configured when none resolves', () => {
    resolveSupportTicketHref.mockReturnValue(null);
    render(<HelpPage />);
    expect(screen.queryByTestId('raise-support-ticket')).toBeNull();
    expect(screen.getByTestId('support-ticket-unconfigured')).toBeInTheDocument();
  });
});
