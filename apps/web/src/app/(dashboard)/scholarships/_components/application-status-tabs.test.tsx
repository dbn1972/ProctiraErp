/**
 * PRC-L053 — status filter is a nav of links (no orphan tablist) and is localised.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';
import hiMessages from '@/messages/hi.json';
import { ApplicationStatusTabs } from './application-status-tabs';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('page=2'),
}));

function renderTabs(locale: 'en' | 'hi', activeStatus: string) {
  const messages = locale === 'hi' ? hiMessages : enMessages;
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ApplicationStatusTabs activeStatus={activeStatus} counts={{ ALL: 3, PENDING: 1 }} />
    </NextIntlClientProvider>,
  );
}

describe('ApplicationStatusTabs (PRC-L053)', () => {
  it('renders a navigation landmark of links with aria-current, not an ARIA tablist', () => {
    const { container } = renderTabs('en', 'PENDING');
    expect(container.querySelector('[role="tablist"],[role="tab"]')).toBeNull();
    const nav = screen.getByRole('navigation', { name: 'Application status' });
    const links = within(nav).getAllByRole('link');
    expect(links).toHaveLength(5);
    const current = links.filter((l) => l.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Pending');
    // PRC-M114: switching status resets to the first page.
    expect(current[0]).toHaveAttribute('href', '/scholarships/applications?status=PENDING');
    expect(within(nav).getByRole('link', { name: /All/ })).toHaveAttribute(
      'href',
      '/scholarships/applications',
    );
  });

  it('translates labels when the locale changes', () => {
    renderTabs('hi', 'ALL');
    const nav = screen.getByRole('navigation', {
      name: hiMessages.scholarships.statusFilterLabel,
    });
    expect(within(nav).getByRole('link', { name: /लंबित/ })).toBeInTheDocument();
  });

  it('every locale defines the new notifications and rubrics keys', async () => {
    const locales = ['en', 'hi', 'ta', 'te', 'mr', 'bn', 'gu', 'kn', 'ar'];
    const enNotif = Object.keys(enMessages.notifications).sort();
    for (const l of locales) {
      const m = (await import(`@/messages/${l}.json`)).default as Record<
        string,
        Record<string, string>
      >;
      expect(Object.keys(m['notifications'] ?? {}).sort(), l).toEqual(enNotif);
      expect(m['lms']?.['rubricsTitle'], l).toBeTruthy();
    }
  });
});
