/**
 * @vitest-environment jsdom
 *
 * AuthProvider — real cookie session gate (P0-02), not a stub login shell.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const fetchSessionMock = vi.fn();
const refreshAccessTokenMock = vi.fn();
const sessionSignInMock = vi.fn();
const sessionSignOutMock = vi.fn();

vi.mock('@/lib/auth/session', () => ({
  fetchSession: (...args: unknown[]) => fetchSessionMock(...args),
  refreshAccessToken: (...args: unknown[]) => refreshAccessTokenMock(...args),
  signIn: (...args: unknown[]) => sessionSignInMock(...args),
  signOut: (...args: unknown[]) => sessionSignOutMock(...args),
}));

import { AuthProvider, isAuthDemoModeEnabled, useAuth, type AuthUser } from './AuthProvider';

function Probe(): JSX.Element {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="status">{auth.status}</span>
      <span data-testid="email">{auth.user?.email ?? ''}</span>
      <span data-testid="authed">{String(auth.isAuthenticated)}</span>
      <span data-testid="token">{auth.accessToken ?? 'null'}</span>
      <span data-testid="demo">{String(auth.isDemoMode)}</span>
      <button type="button" onClick={() => void auth.signIn('a@b.c', 'secret')}>
        sign-in
      </button>
      <button type="button" onClick={() => void auth.refreshToken()}>
        refresh
      </button>
    </div>
  );
}

const sampleUser: AuthUser = {
  id: 'u1',
  email: 'principal@school.test',
  name: 'Principal',
  roles: ['principal'],
  permissions: [],
  scope: { level: 'school' },
  tenant_id: 't1',
};

describe('isAuthDemoModeEnabled', () => {
  it('is off by default (prod-safe)', () => {
    expect(isAuthDemoModeEnabled({})).toBe(false);
    expect(isAuthDemoModeEnabled({ NEXT_PUBLIC_AUTH_DEMO_MODE: '' })).toBe(false);
  });

  it('requires an explicit env opt-in', () => {
    expect(isAuthDemoModeEnabled({ NEXT_PUBLIC_AUTH_DEMO_MODE: '1' })).toBe(true);
    expect(isAuthDemoModeEnabled({ AUTH_DEMO_MODE: 'true' })).toBe(true);
  });
});

describe('<AuthProvider> — cookie session hydration', () => {
  beforeEach(() => {
    fetchSessionMock.mockReset();
    refreshAccessTokenMock.mockReset();
    sessionSignInMock.mockReset();
    sessionSignOutMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('hydrates from GET /api/auth/session (no stub user)', async () => {
    fetchSessionMock.mockResolvedValue({ authenticated: true, user: sampleUser });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(screen.getByTestId('status').textContent).toBe('loading');

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('authenticated');
    });
    expect(screen.getByTestId('email').textContent).toBe('principal@school.test');
    expect(screen.getByTestId('authed').textContent).toBe('true');
    expect(screen.getByTestId('token').textContent).toBe('null');
    expect(fetchSessionMock).toHaveBeenCalled();
  });

  it('marks unauthenticated when the cookie gate returns no session', async () => {
    fetchSessionMock.mockResolvedValue({ authenticated: false, user: null });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('unauthenticated');
    });
    expect(screen.getByTestId('authed').textContent).toBe('false');
  });

  it('refreshes an expired session then re-hydrates', async () => {
    fetchSessionMock
      .mockResolvedValueOnce({ authenticated: false, user: null, reason: 'expired' })
      .mockResolvedValueOnce({ authenticated: true, user: sampleUser });
    refreshAccessTokenMock.mockResolvedValue(true);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('authenticated');
    });
    expect(refreshAccessTokenMock).toHaveBeenCalled();
    expect(fetchSessionMock).toHaveBeenCalledTimes(2);
  });

  it('signIn uses the real BFF then hydrates (not a stub no-op)', async () => {
    fetchSessionMock.mockResolvedValue({ authenticated: true, user: sampleUser });
    sessionSignInMock.mockResolvedValue({ success: true });

    render(
      <AuthProvider hydrate={false} initialUser={null}>
        <Probe />
      </AuthProvider>,
    );

    await act(async () => {
      screen.getByText('sign-in').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('authenticated');
    });
    expect(sessionSignInMock).toHaveBeenCalledWith('a@b.c', 'secret');
  });

  it('skips cookie hydration when initialUser is injected for tests', () => {
    render(
      <AuthProvider initialUser={sampleUser}>
        <Probe />
      </AuthProvider>,
    );
    expect(screen.getByTestId('status').textContent).toBe('authenticated');
    expect(fetchSessionMock).not.toHaveBeenCalled();
  });
});
