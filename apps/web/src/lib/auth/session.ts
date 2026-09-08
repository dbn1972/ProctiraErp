/**
 * Session management utilities for authentication.
 *
 * Tokens are stored as httpOnly cookies (set by the Next.js Route Handlers
 * under /api/auth/*) and are not directly accessible from client-side
 * JavaScript. This module exposes the cookie/endpoint constants and small
 * client-side helpers that call those route handlers.
 */

import { withCsrfHeader } from '@/lib/auth/csrf';

/** Cookie names used for authentication. */
export const AUTH_COOKIES = {
  ACCESS_TOKEN: 'access_token',
  REFRESH_TOKEN: 'refresh_token',
  SESSION_ID: 'session_id',
} as const;

/** Auth API endpoints (Next.js route handlers, not the upstream auth-service). */
export const AUTH_ENDPOINTS = {
  LOGIN: '/api/auth/login',
  LOGOUT: '/api/auth/logout',
  REFRESH: '/api/auth/refresh',
  FORGOT_PASSWORD: '/api/auth/forgot-password',
  RESET_PASSWORD: '/api/auth/reset-password',
  VERIFY_MFA: '/api/auth/mfa/verify',
  RESEND_MFA: '/api/auth/mfa/resend',
  OAUTH_AUTHORIZE: '/api/auth/oauth/authorize',
  OAUTH_CALLBACK: '/api/auth/oauth/callback',
  SIGNUP: '/api/auth/signup',
  SIGNUP_ROLES: '/api/tenant/signup-roles',
} as const;

/** Supported OAuth/OIDC providers. */
export type OAuthProvider = 'google' | 'microsoft' | 'custom-oidc';

export interface OAuthProviderConfig {
  id: OAuthProvider;
  name: string;
  icon: string;
}

/** Available OAuth providers for the login page. */
export const OAUTH_PROVIDERS: OAuthProviderConfig[] = [
  { id: 'microsoft', name: 'Microsoft', icon: 'microsoft' },
  { id: 'google', name: 'Google', icon: 'google' },
];

/** JWT token payload structure (matches @proctira/auth TokenPayload). */
export interface TokenPayload {
  sub: string;
  tenantId: string;
  email: string;
  displayName?: string;
  sessionId?: string;
  roles: Array<{
    roleId: string;
    roleName: string;
    areaId: string;
    institutionId?: string;
  }>;
  iat: number;
  exp: number;
}

/** Result returned by the login endpoint. */
export interface SignInResult {
  success: boolean;
  /** Set when the auth-service requires MFA verification. */
  requiresMfa?: boolean;
  /** Server-issued, short-lived MFA challenge token (passed back to /verify). */
  mfaToken?: string;
  /** Human-readable error message when success is false. */
  message?: string;
}

/**
 * Decodes a JWT token payload without verifying the signature.
 * Used client-side for reading user info from the token; signature
 * verification happens server-side.
 */
export function decodeTokenPayload(token: string): TokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]!));
    return payload as TokenPayload;
  } catch {
    return null;
  }
}

/**
 * Returns true when the access token is expired (or within 30s of expiry).
 */
export function isTokenExpired(token: string): boolean {
  const payload = decodeTokenPayload(token);
  if (!payload || !payload.exp) return true;
  const now = Math.floor(Date.now() / 1000);
  return payload.exp - 30 < now;
}

/**
 * Builds the OAuth authorization URL for a given provider.
 * The route handler will redirect to the upstream OAuth provider.
 */
export function getOAuthAuthorizeUrl(
  provider: OAuthProvider,
  returnTo?: string,
): string {
  const params = new URLSearchParams({
    provider,
    ...(returnTo && { returnTo }),
  });
  return `${AUTH_ENDPOINTS.OAUTH_AUTHORIZE}?${params.toString()}`;
}

/**
 * Submits credentials to the login route. Returns a structured result that
 * tells the caller whether MFA is required.
 */
export async function signIn(
  email: string,
  password: string,
): Promise<SignInResult> {
  try {
    const response = await fetch(AUTH_ENDPOINTS.LOGIN, {
      method: 'POST',
      credentials: 'include',
      headers: withCsrfHeader({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ email, password }),
    });

    const data: {
      requiresMfa?: boolean;
      mfaToken?: string;
      message?: string;
    } = await safeJson(response);

    if (response.ok) {
      return {
        success: true,
        requiresMfa: Boolean(data.requiresMfa),
        mfaToken: data.mfaToken,
      };
    }

    return {
      success: false,
      message: data.message || 'Invalid email or password.',
    };
  } catch {
    return {
      success: false,
      message: 'Network error. Please try again.',
    };
  }
}

/**
 * Verifies an MFA challenge code (TOTP or SMS).
 */
export async function verifyMfa(
  mfaToken: string,
  code: string,
): Promise<SignInResult> {
  try {
    const response = await fetch(AUTH_ENDPOINTS.VERIFY_MFA, {
      method: 'POST',
      credentials: 'include',
      headers: withCsrfHeader({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ mfaToken, code }),
    });
    const data: { message?: string } = await safeJson(response);
    if (response.ok) {
      return { success: true };
    }
    return {
      success: false,
      message: data.message || 'Invalid verification code.',
    };
  } catch {
    return { success: false, message: 'Network error. Please try again.' };
  }
}

/**
 * Performs a token refresh by calling the refresh route handler.
 * The refresh token is sent automatically via httpOnly cookie.
 */
export async function refreshAccessToken(): Promise<boolean> {
  try {
    const response = await fetch(AUTH_ENDPOINTS.REFRESH, {
      method: 'POST',
      credentials: 'include',
      headers: withCsrfHeader({ 'Content-Type': 'application/json' }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Performs logout by calling the logout route. The server invalidates the
 * session and clears all auth cookies. The browser is then redirected to
 * /login.
 */
export async function signOut(redirectTo: string = '/login'): Promise<void> {
  try {
    await fetch(AUTH_ENDPOINTS.LOGOUT, {
      method: 'POST',
      credentials: 'include',
      headers: withCsrfHeader({ 'Content-Type': 'application/json' }),
    });
  } catch {
    // Even if the API call fails, we redirect to login.
  }

  if (typeof window !== 'undefined') {
    window.location.href = redirectTo;
  }
}

/** Backwards-compat alias: existing callers used `logout`. */
export const logout = signOut;

// ─── Sign-up (Task 49.2) ────────────────────────────────────────────────────
//
// The sign-up surface (role catalog fetch + new-account submission + terms
// acceptance audit payload) lives in `@/lib/api/auth` so it sits next to
// the other domain API clients (`admin.ts`, `registration.ts`, …). The
// types and helpers are re-exported here so existing imports from
// `@/lib/auth/session` keep working without churn.

export {
  fetchSignupRoles,
  signUp,
  DEFAULT_TERMS_VERSION,
  DEFAULT_PRIVACY_VERSION,
  type SignupRole,
  type SignUpRequest,
  type SignUpResult,
  type TermsAcceptancePayload,
} from '@/lib/api/auth';

/**
 * Submits a forgot-password request.
 */
export async function requestPasswordReset(
  email: string,
): Promise<{ success: boolean; message?: string }> {
  try {
    const response = await fetch(AUTH_ENDPOINTS.FORGOT_PASSWORD, {
      method: 'POST',
      credentials: 'include',
      headers: withCsrfHeader({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ email }),
    });

    if (response.ok) {
      return { success: true };
    }

    const data: { message?: string } = await safeJson(response);
    return {
      success: false,
      message: data.message || 'Failed to send reset email.',
    };
  } catch {
    return { success: false, message: 'Network error. Please try again.' };
  }
}

/**
 * Submits a password reset using the token sent by email.
 */
export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<{ success: boolean; message?: string }> {
  try {
    const response = await fetch(AUTH_ENDPOINTS.RESET_PASSWORD, {
      method: 'POST',
      credentials: 'include',
      headers: withCsrfHeader({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ token, newPassword }),
    });

    if (response.ok) {
      return { success: true };
    }

    const data: { message?: string } = await safeJson(response);
    return {
      success: false,
      message: data.message || 'Failed to reset password.',
    };
  } catch {
    return { success: false, message: 'Network error. Please try again.' };
  }
}

/** Reads JSON from a Response without throwing on empty body. */
async function safeJson<T = Record<string, unknown>>(
  response: Response,
): Promise<T> {
  try {
    const text = await response.text();
    return text ? (JSON.parse(text) as T) : ({} as T);
  } catch {
    return {} as T;
  }
}
