/**
 * @vitest-environment jsdom
 *
 * Header — help link (Task 12.2 / Requirement 2 AC3, AC4), real session
 * identity (Task 12.1 / Requirement 2 AC1, AC2, AC8), and notification
 * bell (Task 12.3 / Requirement 2 AC5, AC6, AC7) tests.
 *
 * `<Header>` is a Client Component. `next-intl`, `next/link`, and the
 * sibling chrome controls (`<ThemeToggle>`, `<LanguageSelector>`) are
 * mocked to thin stand-ins so this suite stays focused on `Header`'s own
 * contract: the help link (Task 12.2), the `identity` prop's rendering
 * and fallback rules (Task 12.1), the notification bell's badge/aria
 * states (Task 12.3), and that neither addition regresses
 * search/theme/language/logout.
 *
 * This file deliberately does NOT re-test `<ThemeToggle>` or
 * `<LanguageSelector>` internals (each has its own test file) — only
 * that they still render inside `<Header>`.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/components/ThemeToggle', () => ({
  ThemeToggle: () => <button type="button" data-testid="theme-toggle-stub" />,
}));

vi.mock('@/components/LanguageSelector', () => ({
  LanguageSelector: () => <button type="button" data-testid="language-selector-stub" />,
}));

vi.mock('@/lib/auth', () => ({
  signOut: vi.fn(async () => {}),
}));

import { Header, type HeaderIdentity } from './header';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('<Header> — help link (Task 12.2 / Req 2 AC3, AC4)', () => {
  it('renders a link to the existing /help route', () => {
    render(<Header />);

    const helpLink = screen.getByTestId('header-help-link');
    expect(helpLink.tagName.toLowerCase()).toBe('a');
    expect(helpLink.getAttribute('href')).toBe('/help');
  });

  it('exposes an accessible name via aria-label', () => {
    render(<Header />);

    const helpLink = screen.getByRole('link', { name: 'Help' });
    expect(helpLink.getAttribute('href')).toBe('/help');
  });

  it('renders the help link in the right-side icon cluster alongside theme/language controls', () => {
    render(<Header />);

    expect(screen.getByTestId('theme-toggle-stub')).toBeInTheDocument();
    expect(screen.getByTestId('language-selector-stub')).toBeInTheDocument();
    expect(screen.getByTestId('header-help-link')).toBeInTheDocument();
  });

  it('does not duplicate or fork help content — it is a bare link with only an icon', () => {
    render(<Header />);

    const helpLink = screen.getByTestId('header-help-link');
    expect(helpLink.textContent?.trim()).toBe('');
    expect(helpLink.querySelector('svg')).not.toBeNull();
  });
});

// ─── Real session identity (Task 12.1 / Req 2 AC1, AC2, AC8) ────────────────

function identity(overrides: Partial<HeaderIdentity> = {}): HeaderIdentity {
  return {
    displayName: 'Asha Rao',
    email: 'asha.rao@sunrise.test',
    primaryRole: 'Principal',
    tenantName: 'Sunrise Public School',
    ...overrides,
  };
}

describe('<Header> — real session identity (Task 12.1 / Req 2 AC1, AC2, AC8)', () => {
  it('renders the real displayName instead of the hardcoded "U" placeholder', () => {
    render(<Header identity={identity()} />);

    expect(screen.getByTestId('header-display-name')).toHaveTextContent('Asha Rao');
  });

  it('derives the avatar initial from the real display name, not a hardcoded "U"', () => {
    render(<Header identity={identity({ displayName: 'Zara Khan' })} />);

    const avatar = screen.getByTestId('header-user-identity').querySelector('span');
    expect(avatar?.textContent).toBe('Z');
  });

  it('falls back to email when displayName is empty', () => {
    render(<Header identity={identity({ displayName: '' })} />);

    expect(screen.getByTestId('header-display-name')).toHaveTextContent(
      'asha.rao@sunrise.test',
    );
  });

  it('falls back to email when displayName is absent (undefined)', () => {
    render(<Header identity={identity({ displayName: undefined })} />);

    expect(screen.getByTestId('header-display-name')).toHaveTextContent(
      'asha.rao@sunrise.test',
    );
  });

  it('falls back to email when displayName is only whitespace', () => {
    render(<Header identity={identity({ displayName: '   ' })} />);

    expect(screen.getByTestId('header-display-name')).toHaveTextContent(
      'asha.rao@sunrise.test',
    );
  });

  it('renders the primary role and tenant name as identity subtext', () => {
    render(<Header identity={identity()} />);

    expect(screen.getByTestId('header-identity-subtext')).toHaveTextContent(
      'Principal · Sunrise Public School',
    );
  });

  it('renders only the tenant name when primaryRole is null', () => {
    render(<Header identity={identity({ primaryRole: null })} />);

    expect(screen.getByTestId('header-identity-subtext')).toHaveTextContent(
      'Sunrise Public School',
    );
  });

  it('renders only the primary role when tenantName is null', () => {
    render(<Header identity={identity({ tenantName: null })} />);

    expect(screen.getByTestId('header-identity-subtext')).toHaveTextContent('Principal');
  });

  it('omits the subtext line entirely (not blank) when both are null', () => {
    render(<Header identity={identity({ primaryRole: null, tenantName: null })} />);

    expect(screen.queryByTestId('header-identity-subtext')).toBeNull();
  });

  it('never renders a literally blank name when identity itself is not supplied', () => {
    render(<Header />);

    const name = screen.getByTestId('header-display-name');
    expect(name.textContent?.trim()).not.toBe('');
  });

  it('scopes to only the authenticated caller — never renders another tenant/session\'s data from props it was not given', () => {
    render(<Header identity={identity({ tenantName: 'Sunrise Public School' })} />);

    expect(screen.queryByText(/Greenwood/)).toBeNull();
  });
});

// ─── Notification bell (Task 12.3 / Req 2.5, 2.6, 2.7) ──────────────────────

describe('<Header> — notification bell (Task 12.3 / Req 2.5, 2.6, 2.7)', () => {
  it('renders a plain bell with no badge when unreadNotificationCount is absent from identity', () => {
    // `identity()`'s defaults omit `unreadNotificationCount` entirely, so
    // this already exercises the "absent" case without an override.
    render(<Header identity={identity()} />);

    expect(screen.queryByTestId('header-notifications-badge')).toBeNull();
    expect(screen.getByRole('link', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('renders a plain bell with no badge when unreadNotificationCount is 0', () => {
    render(<Header identity={identity({ unreadNotificationCount: 0 })} />);

    expect(screen.queryByTestId('header-notifications-badge')).toBeNull();
    expect(screen.getByRole('link', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('renders the badge with the count and an aria-label naming it when unreadNotificationCount is a small positive number', () => {
    render(<Header identity={identity({ unreadNotificationCount: 3 })} />);

    expect(screen.getByTestId('header-notifications-badge')).toHaveTextContent('3');
    expect(screen.getByRole('link', { name: 'Notifications, 3 unread' })).toBeInTheDocument();
  });

  it('does not cap the badge at the exact boundary count of 9', () => {
    render(<Header identity={identity({ unreadNotificationCount: 9 })} />);

    expect(screen.getByTestId('header-notifications-badge')).toHaveTextContent('9');
    expect(screen.getByRole('link', { name: 'Notifications, 9 unread' })).toBeInTheDocument();
  });

  it('renders "9+" instead of the literal number once the count exceeds 9, while the aria-label keeps the uncapped count', () => {
    render(<Header identity={identity({ unreadNotificationCount: 12 })} />);

    // The visible badge caps its display at "9+" (`formatNotificationBadgeCount`),
    // but `header.tsx` builds the aria-label from the raw, uncapped
    // `unreadNotificationCount` — the two intentionally diverge above 9.
    expect(screen.getByTestId('header-notifications-badge')).toHaveTextContent('9+');
    expect(screen.getByRole('link', { name: 'Notifications, 12 unread' })).toBeInTheDocument();
  });

  it('renders a plain bell with no badge (never an error state) for a negative unreadNotificationCount', () => {
    render(<Header identity={identity({ unreadNotificationCount: -1 })} />);

    expect(screen.queryByTestId('header-notifications-badge')).toBeNull();
    expect(screen.getByRole('link', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('renders a plain bell with no badge (never an error state) for a NaN unreadNotificationCount', () => {
    render(<Header identity={identity({ unreadNotificationCount: NaN })} />);

    expect(screen.queryByTestId('header-notifications-badge')).toBeNull();
    expect(screen.getByRole('link', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('renders a plain bell with no badge (never an error state) for an Infinity unreadNotificationCount', () => {
    render(<Header identity={identity({ unreadNotificationCount: Infinity })} />);

    expect(screen.queryByTestId('header-notifications-badge')).toBeNull();
    expect(screen.getByRole('link', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('always points the bell link to /notifications with a stable test id, regardless of count', () => {
    const { unmount } = render(<Header identity={identity({ unreadNotificationCount: 0 })} />);
    const bellLinkNoBadge = screen.getByTestId('header-notifications-link');
    expect(bellLinkNoBadge.tagName.toLowerCase()).toBe('a');
    expect(bellLinkNoBadge.getAttribute('href')).toBe('/notifications');
    unmount();

    render(<Header identity={identity({ unreadNotificationCount: 7 })} />);
    const bellLinkWithBadge = screen.getByTestId('header-notifications-link');
    expect(bellLinkWithBadge.tagName.toLowerCase()).toBe('a');
    expect(bellLinkWithBadge.getAttribute('href')).toBe('/notifications');
  });
});

// ─── Regression: search, theme, language, and logout still work ────────────

describe('<Header> — existing search/theme/language/logout unaffected', () => {
  it('still renders the global search trigger with its ⌘K affordance', () => {
    render(<Header identity={identity()} />);

    expect(screen.getByRole('button', { name: 'Search (Ctrl+K)' })).toBeInTheDocument();
    expect(screen.getByText('Search students, staff, schools…')).toBeInTheDocument();
  });

  it('still renders ThemeToggle and LanguageSelector', () => {
    render(<Header identity={identity()} />);

    expect(screen.getByTestId('theme-toggle-stub')).toBeInTheDocument();
    expect(screen.getByTestId('language-selector-stub')).toBeInTheDocument();
  });

  it('still renders a working logout button that calls signOut', async () => {
    const { signOut } = await import('@/lib/auth');
    render(<Header identity={identity()} />);

    const logoutButton = screen.getByText('logout');
    logoutButton.click();

    expect(signOut).toHaveBeenCalledWith('/login');
  });
});
