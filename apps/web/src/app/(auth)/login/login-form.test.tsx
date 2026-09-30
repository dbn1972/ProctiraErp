/**
 * @vitest-environment jsdom
 *
 * PRC-L021: the login form must not render a no-op "Remember me" control and
 * must confirm a completed password reset (`/login?reset=true`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

let params = new URLSearchParams();

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => params,
}));
vi.mock('@/components/auth/auth-demo-mode-banner', () => ({
  AuthDemoModeBanner: () => null,
}));
vi.mock('@/components/auth/oauth-icon', () => ({ OAuthIcon: () => null }));
vi.mock('@/lib/auth', () => ({
  AUTH_ENDPOINTS: { KEYCLOAK: '/api/auth/keycloak' },
  OAUTH_PROVIDERS: [],
  getOAuthAuthorizeUrl: () => '#',
  sanitizeReturnTo: (v: string | null) => v ?? '/dashboard',
  signIn: vi.fn(),
}));

import { LoginForm } from './login-form';

describe('LoginForm (PRC-L021)', () => {
  beforeEach(() => {
    params = new URLSearchParams();
  });

  it('does not render a Remember me control that has no effect', () => {
    render(<LoginForm />);
    expect(screen.queryByText('rememberMe')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('shows a password reset success message when reset=true', () => {
    params = new URLSearchParams('reset=true');
    render(<LoginForm />);
    expect(screen.getByRole('status').textContent).toContain('passwordResetSuccess');
  });

  it('omits the reset message on a normal visit', () => {
    render(<LoginForm />);
    expect(screen.queryByText('passwordResetSuccess')).toBeNull();
  });
});
