/**
 * @vitest-environment jsdom
 *
 * PRC-L021: the login form must not render a no-op "Remember me" control and
 * must confirm a completed password reset (`/login?reset=true`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

let params = new URLSearchParams();
const push = vi.fn();
const signIn = vi.fn();

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
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
  signIn: (...args: unknown[]) => signIn(...args),
}));

import { LoginForm } from './login-form';

describe('LoginForm (PRC-L021)', () => {
  beforeEach(() => {
    params = new URLSearchParams();
    push.mockReset();
    signIn.mockReset();
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

  it('routes to /mfa without the challenge token in the URL (PRC-L024)', async () => {
    params = new URLSearchParams('returnTo=/dashboard');
    signIn.mockResolvedValue({ success: true, requiresMfa: true });
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText('emailAddress'), {
      target: { value: 'user@example.test' },
    });
    fireEvent.change(screen.getByLabelText('password'), { target: { value: 'pw' } });
    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: 'signIn' }).closest('form')!);
    });
    expect(push).toHaveBeenCalledTimes(1);
    const target = String(push.mock.calls[0]![0]);
    expect(target.startsWith('/mfa')).toBe(true);
    expect(target).not.toContain('token');
  });
});
describe('LoginForm password toggle (PRC-M059)', () => {
  it('keeps the show/hide toggle in the tab order and exposes its pressed state', () => {
    render(<LoginForm />);
    const toggle = screen.getByRole('button', { name: 'showPassword' });
    expect(toggle.hasAttribute('tabindex')).toBe(false);
    expect(toggle.tabIndex).toBe(0);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    const pressed = screen.getByRole('button', { name: 'hidePassword' });
    expect(pressed.getAttribute('aria-pressed')).toBe('true');
    expect(document.getElementById('password')?.getAttribute('type')).toBe('text');
  });
});
