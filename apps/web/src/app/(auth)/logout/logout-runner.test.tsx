/**
 * PRC-L259 — /logout must sign out through the POST `signOut()` flow, never a
 * GET redirect to /api/auth/logout.
 */
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const signOut = vi.fn(async (_redirectTo?: string) => undefined);
const redirect = vi.fn();

vi.mock('@/lib/auth/session', () => ({ signOut: (to?: string) => signOut(to) }));
vi.mock('next/navigation', () => ({ redirect: (...args: unknown[]) => redirect(...args) }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

import LogoutPage from './page';

afterEach(() => {
  cleanup();
  signOut.mockClear();
  redirect.mockClear();
});

describe('/logout page', () => {
  it('calls the POST signOut flow once on mount and never redirects to the API', () => {
    render(<LogoutPage />);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith('/login');
    expect(redirect).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('offers an accessible manual sign-out button', () => {
    render(<LogoutPage />);
    fireEvent.click(screen.getByRole('button', { name: 'auth.logout' }));
    expect(signOut).toHaveBeenCalledTimes(2);
  });
});
