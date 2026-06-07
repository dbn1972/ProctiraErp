/**
 * Client-side authentication helpers for the Platform Admin Console.
 *
 * Login/logout calls go through Next.js Route Handlers (under /api/auth/*)
 * which set/clear httpOnly cookies on the response.
 */

export const ADMIN_AUTH_ENDPOINTS = {
  LOGIN: '/api/auth/login',
  LOGOUT: '/api/auth/logout',
} as const;

export interface AdminSignInResult {
  success: boolean;
  message?: string;
}

/** POST credentials to the admin login route. */
export async function signIn(
  email: string,
  password: string,
): Promise<AdminSignInResult> {
  try {
    const response = await fetch(ADMIN_AUTH_ENDPOINTS.LOGIN, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = (await safeJson(response)) as { message?: string };

    if (response.ok) {
      return { success: true };
    }
    return {
      success: false,
      message: data.message || 'Invalid email or password.',
    };
  } catch {
    return { success: false, message: 'Network error. Please try again.' };
  }
}

/** Calls the logout route, then redirects to /login. */
export async function signOut(redirectTo: string = '/login'): Promise<void> {
  try {
    await fetch(ADMIN_AUTH_ENDPOINTS.LOGOUT, {
      method: 'POST',
      credentials: 'include',
    });
  } catch {
    // ignore network failures — we still navigate to /login.
  }
  if (typeof window !== 'undefined') {
    window.location.href = redirectTo;
  }
}

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
