/**
 * Shared route-mocking helpers for the auth e2e suite (Task 49.7).
 *
 * Every spec mocks the auth-service contracts directly via Playwright's
 * `page.route()` interception so the suite stays green without a running
 * backend. The helpers below centralise the canned responses so any
 * change to the upstream contract only needs to be reflected in one
 * place.
 */
import type { Page, Route } from '@playwright/test';

/** Decorates `route.fulfill` with JSON content-type defaults. */
async function fulfillJson(
  route: Route,
  status: number,
  body: Record<string, unknown>,
): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

export interface LoginMockOptions {
  /** When `true` the login response signals MFA is required. */
  requiresMfa?: boolean;
  /** Stable mfa challenge token returned to the client. */
  mfaToken?: string;
  /** Force a 401 with the supplied message. */
  invalid?: string;
}

/**
 * Intercepts `POST /api/auth/login`. Returns either a happy-path
 * `{ success: true }` payload (with a fake JWT cookie set) or, when
 * `invalid` is supplied, a 401 with the message.
 */
export async function mockLogin(page: Page, options: LoginMockOptions = {}): Promise<void> {
  await page.route('**/api/auth/login', async (route) => {
    if (options.invalid) {
      await fulfillJson(route, 401, { message: options.invalid });
      return;
    }
    if (options.requiresMfa) {
      await fulfillJson(route, 200, {
        requiresMfa: true,
        mfaToken: options.mfaToken ?? 'mfa-challenge-token-abc',
      });
      return;
    }
    // Happy path. The Next.js route normally sets httpOnly cookies on
    // a successful upstream response — we replicate enough of that
    // shape here so client code that follows the success branch
    // doesn't trip on a missing field.
    await fulfillJson(route, 200, { success: true });
  });
}

/** Intercepts `POST /api/auth/mfa/verify`. */
export async function mockMfaVerify(page: Page, options: { invalid?: string } = {}): Promise<void> {
  await page.route('**/api/auth/mfa/verify', async (route) => {
    if (options.invalid) {
      await fulfillJson(route, 401, { message: options.invalid });
      return;
    }
    await fulfillJson(route, 200, { success: true });
  });
}

/** Intercepts `POST /api/auth/forgot-password` (always 200, never disclosing). */
export async function mockForgotPassword(page: Page): Promise<void> {
  await page.route('**/api/auth/forgot-password', async (route) => {
    await fulfillJson(route, 200, { success: true });
  });
}

/** Intercepts `POST /api/auth/reset-password`. */
export async function mockResetPassword(
  page: Page,
  options: { invalid?: string } = {},
): Promise<void> {
  await page.route('**/api/auth/reset-password', async (route) => {
    if (options.invalid) {
      await fulfillJson(route, 400, { message: options.invalid });
      return;
    }
    await fulfillJson(route, 200, { success: true });
  });
}

export interface SignupMockOptions {
  /** Force a non-2xx response with the supplied message. */
  error?: { status: number; message: string; code?: string };
}

/**
 * Intercepts `POST /api/auth/signup` and `GET /api/tenant/signup-roles`.
 * Default behaviour: returns three roles and a `requiresApproval: true`
 * confirmation so the test can assert the "check your email" surface.
 */
export async function mockSignup(page: Page, options: SignupMockOptions = {}): Promise<void> {
  await page.route('**/api/tenant/signup-roles', async (route) => {
    await fulfillJson(route, 200, {
      roles: [
        {
          id: 'principal',
          label: 'Principal',
          description: 'Lead an institution',
        },
        {
          id: 'teacher',
          label: 'Teacher',
          description: 'Manage classes and assessment',
        },
        {
          id: 'parent',
          label: 'Parent',
          description: 'Track a child enrolled at the institution',
        },
      ],
    });
  });

  await page.route('**/api/auth/signup', async (route) => {
    if (options.error) {
      await fulfillJson(route, options.error.status, {
        message: options.error.message,
        code: options.error.code,
      });
      return;
    }
    await fulfillJson(route, 200, {
      success: true,
      requiresApproval: true,
      email: 'jane@example.org',
      message: 'Check your email to activate your account.',
    });
  });
}

/**
 * Intercepts the OAuth authorize redirect so tests can assert the
 * federated provider parameter without actually following the redirect
 * to a third-party host (that would break offline runs and CI).
 */
export async function mockOAuthAuthorize(page: Page): Promise<void> {
  await page.route('**/api/auth/oauth/authorize**', async (route) => {
    const url = new URL(route.request().url());
    const provider = url.searchParams.get('provider') ?? 'unknown';
    // Redirect to a synthetic, same-origin sentinel page so we can
    // assert the parameters without leaving the dev origin.
    await route.fulfill({
      status: 302,
      headers: {
        location: `/login?oauth_test=1&provider=${encodeURIComponent(provider)}`,
      },
    });
  });
}
