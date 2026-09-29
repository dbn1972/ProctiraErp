/**
 * @vitest-environment jsdom
 *
 * Header — real session identity (Task 12.1 / Req 2 AC1, AC2, AC8), help
 * link (Task 12.2 / Req 2 AC3, AC4), and notification bell (Task 12.3 /
 * Req 2.5, 2.6, 2.7) tests.
 *
 * `<Header>` is a Client Component that reads identity from `useAuth()`
 * (not a prop) and the tenant/org name from `useDirectoryContext()` — the
 * same real, same-origin, bearer-scoped sources `<Sidebar>`'s tenant
 * switcher already uses. `next-intl`, `next/link`, and the sibling chrome
 * controls (`<ThemeToggle>`, `<LanguageSelector>`) are mocked to thin
 * stand-ins so this suite stays focused on `Header`'s own contract.
 *
 * This file deliberately does NOT re-test `<ThemeToggle>`/`<LanguageSelector>`
 * internals (each has its own test file), or the shared loading-skeleton
 * contract (`sidebar.loading.test.tsx` already covers `Header` + `Sidebar`
 * together while the session is still hydrating).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

const useAuthMock = vi.fn();
vi.mock('@/providers/AuthProvider', () => ({
  useAuth: () => useAuthMock(),
}));

const useDirectoryContextMock = vi.fn();
vi.mock('@/lib/institutions/use-directory-context', () => ({
  useDirectoryContext: () => useDirectoryContextMock(),
}));

const useOptionalBrandMock = vi.fn();
vi.mock('@/providers/BrandConfigProvider', () => ({
  useOptionalBrand: () => useOptionalBrandMock(),
}));

const fetchMock = vi.fn();

import { Header } from './header';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function authenticatedUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'user-1',
    email: 'asha.rao@sunrise.test',
    name: 'Asha Rao',
    roles: ['principal'],
    permissions: [],
    scope: { level: 'school' as const },
    tenant_id: 'tenant-1',
    ...overrides,
  };
}

function mockUnreadCountResponse(unread: number, ok = true): void {
  fetchMock.mockResolvedValue({
    ok,
    json: async () => ({ unread }),
  });
}

beforeEach(() => {
  useAuthMock.mockReset();
  useDirectoryContextMock.mockReset();
  useOptionalBrandMock.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);

  useAuthMock.mockReturnValue({ user: authenticatedUser(), status: 'authenticated' });
  useDirectoryContextMock.mockReturnValue({
    organizationName: 'Sunrise Public School',
    boardLabel: null,
    studentsEnrolled: 620,
    schools: {},
  });
  useOptionalBrandMock.mockReturnValue(null);
  mockUnreadCountResponse(0);
});

// ─── Help link (Task 12.2 / Req 2 AC3, AC4) ─────────────────────────────────

describe('<Header> — help link (Task 12.2 / Req 2 AC3, AC4)', () => {
  it('renders a link to the existing /help route', () => {
    render(<Header />);

    const helpLink = screen.getByTestId('header-help-link');
    expect(helpLink.tagName.toLowerCase()).toBe('a');
    expect(helpLink.getAttribute('href')).toBe('/help');
  });

  it('exposes an accessible name via aria-label', () => {
    render(<Header />);

    expect(screen.getByRole('link', { name: 'Help' }).getAttribute('href')).toBe('/help');
  });

  it('does not duplicate or fork help content — it is a bare link with only an icon', () => {
    render(<Header />);

    const helpLink = screen.getByTestId('header-help-link');
    expect(helpLink.textContent?.trim()).toBe('');
    expect(helpLink.querySelector('svg')).not.toBeNull();
  });
});

// ─── Real session identity (Task 12.1 / Req 2 AC1, AC2, AC8) ───────────────

describe('<Header> — real session identity (Task 12.1 / Req 2 AC1, AC2, AC8)', () => {
  it('renders the real displayName instead of a hardcoded placeholder', () => {
    render(<Header />);

    expect(screen.getByTestId('header-display-name')).toHaveTextContent('Asha Rao');
  });

  it('derives the avatar initials from the real display name', () => {
    useAuthMock.mockReturnValue({
      user: authenticatedUser({ name: 'Zara Khan' }),
      status: 'authenticated',
    });

    render(<Header />);

    expect(screen.getByTestId('header-display-name-avatar')).toHaveTextContent('ZK');
  });

  it('falls back to "Account" when the session has no user (never a blank name)', () => {
    useAuthMock.mockReturnValue({ user: null, status: 'unauthenticated' });

    render(<Header />);

    const name = screen.getByTestId('header-display-name');
    expect(name.textContent?.trim()).toBe('Account');
  });

  it('renders the role and tenant/organisation name as identity subtext', () => {
    render(<Header />);

    expect(screen.getByTestId('header-identity-subtext')).toHaveTextContent(
      'Principal · Sunrise Public School',
    );
  });

  it('renders only the tenant/org name when the session carries no role', () => {
    useAuthMock.mockReturnValue({
      user: authenticatedUser({ roles: [] }),
      status: 'authenticated',
    });

    render(<Header />);

    expect(screen.getByTestId('header-identity-subtext')).toHaveTextContent(
      'Sunrise Public School',
    );
  });

  it('falls back to the brand name when the directory context has no organisation name', () => {
    useDirectoryContextMock.mockReturnValue(null);
    // A neutral placeholder, not the real product brand string — this test
    // only asserts that Header falls back to useOptionalBrand()'s `name`
    // when the directory context has none, not what that name happens to
    // be (the `no-hardcoded-brand-strings` lint rule flags literal brand
    // strings in source, including test fixtures).
    useOptionalBrandMock.mockReturnValue({ name: 'Acme School Group' });

    render(<Header />);

    expect(screen.getByTestId('header-identity-subtext')).toHaveTextContent(
      'Principal · Acme School Group',
    );
  });

  it('omits the subtext line entirely (not blank) when neither role nor tenant/org name is available', () => {
    useAuthMock.mockReturnValue({
      user: authenticatedUser({ roles: [] }),
      status: 'authenticated',
    });
    useDirectoryContextMock.mockReturnValue(null);
    useOptionalBrandMock.mockReturnValue(null);

    render(<Header />);

    expect(screen.queryByTestId('header-identity-subtext')).toBeNull();
  });

  it('shows the loading skeleton (not a placeholder identity) while the session is still hydrating', () => {
    useAuthMock.mockReturnValue({ user: null, status: 'loading' });

    render(<Header />);

    expect(screen.getByTestId('header-user-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('header-display-name')).toBeNull();
  });
});

// ─── Notification bell (Task 12.3 / Req 2.5, 2.6, 2.7) ──────────────────────

describe('<Header> — notification bell (Task 12.3 / Req 2.5, 2.6, 2.7)', () => {
  it('renders a plain bell with no badge before the unread-count fetch resolves', () => {
    render(<Header />);

    expect(screen.queryByTestId('header-notifications-badge')).toBeNull();
    expect(screen.getByTestId('header-notifications-link')).toHaveAttribute(
      'href',
      '/notifications',
    );
  });

  it('renders the badge with the real unread count once the fetch resolves', async () => {
    mockUnreadCountResponse(3);

    render(<Header />);

    await waitFor(() =>
      expect(screen.getByTestId('header-notifications-badge')).toHaveTextContent('3'),
    );
    expect(screen.getByRole('link', { name: 'Notifications, 3 unread' })).toBeInTheDocument();
  });

  it('caps the badge display at "9+" once the count exceeds 9', async () => {
    mockUnreadCountResponse(25);

    render(<Header />);

    await waitFor(() =>
      expect(screen.getByTestId('header-notifications-badge')).toHaveTextContent('9+'),
    );
  });

  it('renders a plain bell with no badge when the unread count is 0', async () => {
    mockUnreadCountResponse(0);

    render(<Header />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId('header-notifications-badge')).toBeNull();
  });

  it('renders a plain bell with no badge (never an error state) when the fetch fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });

    render(<Header />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId('header-notifications-badge')).toBeNull();
  });

  it('renders a plain bell with no badge (never an error state) when the fetch rejects', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    render(<Header />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId('header-notifications-badge')).toBeNull();
  });

  it('does not fetch the unread count while the session is unauthenticated', () => {
    useAuthMock.mockReturnValue({ user: null, status: 'unauthenticated' });

    render(<Header />);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches the same-origin unread-count route, not the gateway directly', () => {
    render(<Header />);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/notifications/unread-count',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });
});

// ─── Regression: search, theme, language, logout, and the menu toggle ──────

describe('<Header> — existing search/theme/language/logout unaffected', () => {
  it('still renders the global search trigger with its ⌘K affordance', () => {
    render(<Header />);

    expect(screen.getByRole('button', { name: 'Search (Ctrl+K)' })).toBeInTheDocument();
  });

  it('still renders ThemeToggle and LanguageSelector', () => {
    render(<Header />);

    expect(screen.getByTestId('theme-toggle-stub')).toBeInTheDocument();
    expect(screen.getByTestId('language-selector-stub')).toBeInTheDocument();
  });

  it('renders the mobile/drawer menu-open button only when onOpenMenu is supplied', () => {
    const { rerender } = render(<Header />);
    expect(screen.queryByTestId('desktop-shell-menu')).toBeNull();

    rerender(<Header onOpenMenu={() => {}} />);
    expect(screen.getByTestId('desktop-shell-menu')).toBeInTheDocument();
  });
});
