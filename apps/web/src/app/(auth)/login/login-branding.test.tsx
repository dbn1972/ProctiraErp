/**
 * @vitest-environment jsdom
 *
 * Phase 2 branding smoke: /login surfaces must be ProctiraERP-first and must
 * not leak CivitasOne / OpenEMIS chrome.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const labels: Record<string, string> = {
      welcomeBack: 'Welcome back',
      signInToWorkspace: 'Sign in to your ProctiraERP workspace.',
      emailAddress: 'Email address',
      password: 'Password',
      forgotPassword: 'Forgot password?',
      hidePassword: 'Hide password',
      showPassword: 'Show password',
      rememberMe: 'Keep me signed in on this device',
      signingIn: 'Signing in…',
      signIn: 'Sign in',
      contactAdmin: "Don't have an account? Contact your administrator.",
      invalidCredentials: 'Invalid email or password.',
      sessionExpired: 'Session expired',
      oauthFailed: 'OAuth failed',
      orContinueWith: 'or continue with',
      noAccount: "Don't have an account?",
      contactAdministrator: 'Contact your administrator',
    };
    return labels[key] ?? key;
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: React.PropsWithChildren<{ href: string } & React.AnchorHTMLAttributes<HTMLAnchorElement>>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/components/auth/oauth-icon', () => ({ OAuthIcon: () => <span>icon</span> }));
vi.mock('@/lib/auth/oauth', () => ({ buildOAuthHref: () => '#' }));
vi.mock('@/lib/auth', () => ({
  signIn: vi.fn(),
}));

vi.mock('@/components/LanguageSelector', () => ({
  LanguageSelector: () => <button type="button">English (India)</button>,
}));

import { AuthShell } from '../_components/auth-shell';
import { LoginForm } from './login-form';

describe('Phase 2 login branding', () => {
  it('renders ProctiraERP brand chrome and workspace copy without CivitasOne', () => {
    const { container } = render(
      <AuthShell>
        <LoginForm />
      </AuthShell>,
    );

    expect(screen.getAllByText(/Proctira/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ERP/).length).toBeGreaterThan(0);
    expect(screen.getByText('Sign in to your ProctiraERP workspace.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeTruthy();

    const html = container.textContent ?? '';
    expect(html).not.toMatch(/CivitasOne/i);
    expect(html).not.toMatch(/OpenEMIS/i);
    expect(html).not.toMatch(/EduZo/i);
    expect(html).not.toMatch(/Keycloak/i);
  });
});
