'use client';

/**
 * AuthProvider — Authentication and session context (Design Sections D, Q)
 *
 * Owns session hydration from the httpOnly cookie gate (`GET /api/auth/session`),
 * credential sign-in / sign-out / refresh via the existing `/api/auth/*` BFF
 * (Keycloak + local auth-service — ADR-001), and exposes `useAuth()` for
 * dashboard scoping and chrome.
 *
 * P0-02: This is the real session shell — not a stub. Tokens never enter
 * client JS; `accessToken` stays null and API calls use cookie credentials
 * or server `getSessionContext()`.
 *
 * Demo / fake login is **not** the primary path. Optional
 * `NEXT_PUBLIC_AUTH_DEMO_MODE=1` only surfaces an honesty banner (no fake
 * credentials accepted here).
 *
 * Requirements: 4
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import {
  fetchSession,
  refreshAccessToken,
  signIn as sessionSignIn,
  signOut as sessionSignOut,
} from '@/lib/auth/session';

// ─── Types ───────────────────────────────────────────────────────────────────

export type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'unauthenticated';

export interface UserScope {
  level: 'country' | 'state' | 'district' | 'board' | 'school';
  area_id?: string;
  board_id?: string;
  institution_id?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  roles: string[];
  permissions: string[];
  scope: UserScope;
  tenant_id: string;
}

export interface AuthContextValue {
  /** Current authentication status */
  status: AuthStatus;
  /** The authenticated user, or null if not authenticated */
  user: AuthUser | null;
  /** Whether the user is currently authenticated */
  isAuthenticated: boolean;
  /**
   * True when `NEXT_PUBLIC_AUTH_DEMO_MODE=1` — honesty flag only; sign-in still
   * goes through the real `/api/auth/login` cookie gate.
   */
  isDemoMode: boolean;
  /** Sign in with credentials (sets httpOnly cookies via BFF) */
  signIn: (email: string, password: string) => Promise<void>;
  /** Sign out and invalidate session */
  signOut: () => Promise<void>;
  /** Refresh the access token cookie, then re-hydrate user claims */
  refreshToken: () => Promise<void>;
  /**
   * Always `null` on the client — access tokens are httpOnly.
   * Kept for API compatibility with earlier provider consumers.
   */
  accessToken: string | null;
}

// ─── Demo honesty ────────────────────────────────────────────────────────────

/**
 * Explicit opt-in only. Never treat unset / production as demo.
 * Does not enable a stub credential path — banner honesty only.
 */
export function isAuthDemoModeEnabled(
  env: Record<string, string | undefined> = typeof process !== 'undefined'
    ? (process.env as Record<string, string | undefined>)
    : {},
): boolean {
  const raw = env.NEXT_PUBLIC_AUTH_DEMO_MODE ?? env.AUTH_DEMO_MODE ?? '';
  return raw === '1' || raw.toLowerCase() === 'true';
}

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

// ─── Context ─────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// ─── Provider ────────────────────────────────────────────────────────────────

export interface AuthProviderProps {
  children: ReactNode;
  /**
   * When provided (including `null`), skips cookie hydration — used by unit
   * tests that inject a synthetic user. Production mounts omit this prop.
   */
  initialUser?: AuthUser | null;
  /** Override hydration; defaults to `true` when `initialUser` is omitted. */
  hydrate?: boolean;
}

export function AuthProvider({ children, initialUser, hydrate }: AuthProviderProps) {
  const shouldHydrate = hydrate ?? initialUser === undefined;
  const demoMode = isAuthDemoModeEnabled();

  const [user, setUser] = useState<AuthUser | null>(initialUser ?? null);
  const [status, setStatus] = useState<AuthStatus>(() => {
    if (initialUser) return 'authenticated';
    if (shouldHydrate) return 'loading';
    return 'idle';
  });

  const applySession = useCallback(async (signal?: AbortSignal) => {
    const snapshot = await fetchSession({ signal });
    if (signal?.aborted) return;

    if (snapshot.authenticated && snapshot.user) {
      setUser(snapshot.user);
      setStatus('authenticated');
      return;
    }

    if (snapshot.reason === 'expired') {
      const refreshed = await refreshAccessToken();
      if (signal?.aborted) return;
      if (refreshed) {
        const again = await fetchSession({ signal });
        if (signal?.aborted) return;
        if (again.authenticated && again.user) {
          setUser(again.user);
          setStatus('authenticated');
          return;
        }
      }
    }

    setUser(null);
    setStatus('unauthenticated');
  }, []);

  useEffect(() => {
    if (!shouldHydrate || !isBrowser()) return;
    const controller = new AbortController();
    void applySession(controller.signal);
    return () => controller.abort();
  }, [shouldHydrate, applySession]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!isBrowser()) return;

      setStatus('loading');
      const result = await sessionSignIn(email, password);

      if (!result.success) {
        setUser(null);
        setStatus('unauthenticated');
        throw new Error(result.message || 'Sign-in failed.');
      }

      if (result.requiresMfa) {
        // Cookies are not set until MFA completes — leave unauthenticated.
        setUser(null);
        setStatus('unauthenticated');
        return;
      }

      await applySession();
    },
    [applySession],
  );

  const signOut = useCallback(async () => {
    if (!isBrowser()) return;
    setStatus('loading');
    await sessionSignOut('/login');
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  const refreshToken = useCallback(async () => {
    if (!isBrowser()) return;
    const ok = await refreshAccessToken();
    if (!ok) {
      setUser(null);
      setStatus('unauthenticated');
      return;
    }
    await applySession();
  }, [applySession]);

  const value: AuthContextValue = {
    status,
    user,
    isAuthenticated: status === 'authenticated' && user !== null,
    isDemoMode: demoMode,
    signIn,
    signOut,
    refreshToken,
    accessToken: null,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Access the current authentication state and actions.
 * Must be used within an `<AuthProvider>`.
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an <AuthProvider>');
  }
  return context;
}
