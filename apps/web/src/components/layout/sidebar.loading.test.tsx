/**
 * @vitest-environment jsdom
 *
 * While the session is still hydrating, the sidebar and header must not
 * render a permission-empty nav (Fees, Transport, …) or the fallback
 * "Account" identity.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/institutions',
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

vi.mock('@/lib/institutions/use-directory-context', () => ({
  useDirectoryContext: () => null,
}));

vi.mock('@/providers/BrandConfigProvider', () => ({
  useOptionalBrand: () => null,
}));

vi.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({
    user: null,
    status: 'loading' as const,
    isAuthenticated: false,
  }),
}));

vi.mock('@/components/ThemeToggle', () => ({
  ThemeToggle: () => null,
}));

vi.mock('@/components/LanguageSelector', () => ({
  LanguageSelector: () => null,
}));

vi.mock('@/lib/auth', () => ({
  signOut: vi.fn(),
}));

import { Header } from './header';
import { Sidebar } from './sidebar';

describe('shell loading skeleton', () => {
  it('hides the permission-empty nav and the Account label while the session loads', () => {
    render(
      <>
        <Sidebar />
        <Header />
      </>,
    );

    expect(screen.getByTestId('sidebar-nav-skeleton')).toBeTruthy();
    expect(screen.getByTestId('tenant-switcher-skeleton')).toBeTruthy();
    expect(screen.getByTestId('header-user-skeleton')).toBeTruthy();
    expect(screen.queryByTestId('sidebar-link-fees')).toBeNull();
    expect(screen.queryByTestId('sidebar-link-notifications')).toBeNull();
    expect(screen.queryByText('Account')).toBeNull();
    expect(screen.queryByLabelText(/Account menu/)).toBeNull();
  });
});
