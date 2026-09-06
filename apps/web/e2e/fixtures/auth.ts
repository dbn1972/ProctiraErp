import type { Page } from '@playwright/test';

export interface LoginCredentials {
  /**
   * Tenant subdomain (e.g. `tenant-a`). Used to set the `X-Tenant` cookie or
   * navigate to a tenant-specific URL when the platform multi-tenants by host.
   */
  tenantSubdomain?: string;
  email: string;
  password: string;
}

/**
 * Default credentials for the seeded `tenant-a` admin user.
 * Override with environment variables when running against a real backend.
 */
export const TENANT_A_ADMIN: LoginCredentials = {
  tenantSubdomain: process.env.E2E_TENANT_A_SUBDOMAIN ?? 'tenant-a',
  email: process.env.E2E_TENANT_A_EMAIL ?? 'admin@tenant-a.test',
  password: process.env.E2E_TENANT_A_PASSWORD ?? 'Password123!',
};

export const TENANT_B_ADMIN: LoginCredentials = {
  tenantSubdomain: process.env.E2E_TENANT_B_SUBDOMAIN ?? 'tenant-b',
  email: process.env.E2E_TENANT_B_EMAIL ?? 'admin@tenant-b.test',
  password: process.env.E2E_TENANT_B_PASSWORD ?? 'Password123!',
};

/**
 * Logs into the ProctiraERP web app via the `/login` page and waits for the
 * dashboard route to load.
 */
export async function login(page: Page, credentials: LoginCredentials): Promise<void> {
  if (credentials.tenantSubdomain) {
    // Some deployments resolve tenant via subdomain, others via cookie. Set a
    // cookie so tests work against either model without code changes.
    const url = new URL(page.url() === 'about:blank' ? 'http://localhost' : page.url());
    await page.context().addCookies([
      {
        name: 'tenant',
        value: credentials.tenantSubdomain,
        domain: url.hostname,
        path: '/',
      },
    ]);
  }

  await page.goto('/login');
  await page.getByLabel(/email/i).fill(credentials.email);
  await page.getByRole('textbox', { name: /^password$/i }).fill(credentials.password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });
}

/**
 * Convenience wrapper that signs in as the seeded Tenant A admin user.
 */
export async function loginAsTenantAdmin(
  page: Page,
  overrides: Partial<LoginCredentials> = {},
): Promise<void> {
  await login(page, { ...TENANT_A_ADMIN, ...overrides });
}

/**
 * Convenience wrapper that signs in as the seeded Tenant B admin user, used
 * by the tenant-isolation spec to verify cross-tenant data is invisible.
 */
export async function loginAsTenantBUser(
  page: Page,
  overrides: Partial<LoginCredentials> = {},
): Promise<void> {
  await login(page, { ...TENANT_B_ADMIN, ...overrides });
}

/**
 * Signs the user out via the user menu. Falls back to clearing storage if the
 * signout button cannot be located (helpful for partial UI deploys).
 */
export async function logout(page: Page): Promise<void> {
  const userMenu = page.getByRole('button', { name: /account|profile|user menu/i }).first();
  if (await userMenu.isVisible().catch(() => false)) {
    await userMenu.click();
    const signOut = page.getByRole('menuitem', { name: /sign out|log out|logout/i });
    if (await signOut.isVisible().catch(() => false)) {
      await signOut.click();
      await page.waitForURL((url) => url.pathname.startsWith('/login'), { timeout: 10_000 });
      return;
    }
  }
  await page.context().clearCookies();
  await page.goto('/login');
}
