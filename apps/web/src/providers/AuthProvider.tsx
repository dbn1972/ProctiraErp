/**
 * AuthProvider — Authentication and session context (Design Sections D, Q)
 *
 * Owns the session token, refresh rotation, MFA state, and exposes a `useAuth()`
 * hook. Provides authentication state to the entire app so that `<RequireAuth>`
 * guards and dashboard scoping can function.
 *
 * This is a stub implementation. Full functionality is implemented in task 49.x.
 *
 * Requirements: 4
 */

import React, { createContext, useContext, useState, useCallback } from 'react';

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
  /** Sign in with credentials */
  signIn: (email: string, password: string) => Promise<void>;
  /** Sign out and invalidate session */
  signOut: () => Promise<void>;
  /** Refresh the access token */
  refreshToken: () => Promise<void>;
  /** Access token for API calls (null if not authenticated) */
  accessToken: string | null;
}

// ─── SSR-safe helpers ────────────────────────────────────────────────────────

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

// ─── Context ─────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// ─── Provider ────────────────────────────────────────────────────────────────

export interface AuthProviderProps {
  children: React.ReactNode;
  /** Override initial user for testing */
  initialUser?: AuthUser | null;
}

export function AuthProvider({ children, initialUser = null }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(initialUser);
  const [status, setStatus] = useState<AuthStatus>(
    initialUser ? 'authenticated' : 'idle'
  );
  const [accessToken, setAccessToken] = useState<string | null>(null);

  const signIn = useCallback(async (_email: string, _password: string) => {
    if (!isBrowser()) return;

    // Stub: In production, this calls POST /api/v1/auth/sign-in
    setStatus('loading');
    try {
      // Placeholder — actual implementation in task 49.x
      setStatus('unauthenticated');
    } catch {
      setStatus('unauthenticated');
    }
  }, []);

  const signOut = useCallback(async () => {
    if (!isBrowser()) return;

    // Stub: In production, this calls POST /api/v1/auth/sign-out
    setUser(null);
    setAccessToken(null);
    setStatus('unauthenticated');
  }, []);

  const refreshToken = useCallback(async () => {
    if (!isBrowser()) return;

    // Stub: In production, this calls POST /api/v1/auth/refresh
    // No-op in stub
  }, []);

  const value: AuthContextValue = {
    status,
    user,
    isAuthenticated: status === 'authenticated' && user !== null,
    signIn,
    signOut,
    refreshToken,
    accessToken,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
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
