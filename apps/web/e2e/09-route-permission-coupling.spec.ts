/**
 * Property F-7: Route ↔ Permission Coupling (E2E)
 *
 * For any authenticated route `r` defined in `apps/web/app/(dashboard)/`,
 * rendering `r` SHALL be gated by the role/permission set declared in the
 * spec's RBAC section; an unauthorized session SHALL receive a 403 page or
 * redirect, never the page content.
 *
 * **Validates: Requirements 4.4, 40.9; existing Property 3**
 *
 * This Playwright suite loads every authenticated dashboard route under three
 * personas (no scope, mismatched scope, correct scope) and asserts the
 * unauthorized cases receive a 403 page or redirect, never the page content.
 *
 * Requires E2E_BACKEND_READY=1 to run (needs a live backend with seeded
 * test users for each persona).
 */
import { expect, test } from '@playwright/test';
import { login, logout, type LoginCredentials } from './fixtures/auth';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

// ─── Persona Credentials ─────────────────────────────────────────────────────
// These personas must be seeded in the test backend:
// - NO_SCOPE: authenticated user with zero permissions
// - MISMATCHED: authenticated user with only transport.read permission
// - CORRECT: authenticated admin user with all permissions

const NO_SCOPE_USER: LoginCredentials = {
  tenantSubdomain: process.env.E2E_TENANT_A_SUBDOMAIN ?? 'tenant-a',
  email: process.env.E2E_NO_SCOPE_EMAIL ?? 'noscope@tenant-a.test',
  password: process.env.E2E_NO_SCOPE_PASSWORD ?? 'Password123!',
};

const MISMATCHED_USER: LoginCredentials = {
  tenantSubdomain: process.env.E2E_TENANT_A_SUBDOMAIN ?? 'tenant-a',
  email: process.env.E2E_MISMATCHED_EMAIL ?? 'transport-only@tenant-a.test',
  password: process.env.E2E_MISMATCHED_PASSWORD ?? 'Password123!',
};

const CORRECT_USER: LoginCredentials = {
  tenantSubdomain: process.env.E2E_TENANT_A_SUBDOMAIN ?? 'tenant-a',
  email: process.env.E2E_TENANT_A_EMAIL ?? 'admin@tenant-a.test',
  password: process.env.E2E_TENANT_A_PASSWORD ?? 'Password123!',
};

// ─── Protected Dashboard Routes ──────────────────────────────────────────────

interface ProtectedRoute {
  id: string;
  path: string;
  requiredPermissions: string[];
}

const PROTECTED_ROUTES: ProtectedRoute[] = [
  { id: 'institutions', path: '/institutions', requiredPermissions: ['institution.read'] },
  { id: 'students', path: '/students', requiredPermissions: ['student.read'] },
  { id: 'staff', path: '/staff', requiredPermissions: ['staff.read'] },
  { id: 'attendance', path: '/attendance', requiredPermissions: ['attendance.read'] },
  { id: 'assessments', path: '/assessments', requiredPermissions: ['assessment.read'] },
  { id: 'examinations', path: '/examinations', requiredPermissions: ['examination.read'] },
  { id: 'reports', path: '/reports', requiredPermissions: ['report.read'] },
];

// ─── Test Suite ──────────────────────────────────────────────────────────────

test.describe('Property F-7: Route ↔ Permission Coupling (E2E)', () => {
  test.skip(
    !BACKEND_READY,
    'E2E_BACKEND_READY is not set; skipping live-backend e2e test. See e2e/README.md.',
  );

  for (const route of PROTECTED_ROUTES) {
    test.describe(`Route: ${route.path}`, () => {
      test(`persona 1 — no permissions → blocked from ${route.path}`, async ({ page }) => {
        await login(page, NO_SCOPE_USER);
        await page.goto(route.path, { waitUntil: 'domcontentloaded', timeout: 15_000 });
        await page.waitForTimeout(2000);

        const url = new URL(page.url());
        const redirectedToLogin = url.pathname.startsWith('/login');
        const accessDenied = await page
          .getByText(/access denied|forbidden|insufficient permissions|not authorized/i)
          .isVisible({ timeout: 2000 })
          .catch(() => false);

        expect(
          redirectedToLogin || accessDenied,
          `No-scope user should be blocked from ${route.path}. URL: ${page.url()}`,
        ).toBe(true);

        await logout(page);
      });

      test(`persona 2 — mismatched permissions → blocked from ${route.path}`, async ({ page }) => {
        await login(page, MISMATCHED_USER);
        await page.goto(route.path, { waitUntil: 'domcontentloaded', timeout: 15_000 });
        await page.waitForTimeout(2000);

        const url = new URL(page.url());
        const redirectedToLogin = url.pathname.startsWith('/login');
        const accessDenied = await page
          .getByText(/access denied|forbidden|insufficient permissions|not authorized/i)
          .isVisible({ timeout: 2000 })
          .catch(() => false);

        expect(
          redirectedToLogin || accessDenied,
          `Mismatched-scope user should be blocked from ${route.path}. URL: ${page.url()}`,
        ).toBe(true);

        await logout(page);
      });

      test(`persona 3 — correct permissions → can access ${route.path}`, async ({ page }) => {
        await login(page, CORRECT_USER);
        await page.goto(route.path, { waitUntil: 'domcontentloaded', timeout: 15_000 });
        await page.waitForTimeout(2000);

        const url = new URL(page.url());

        // Should NOT be redirected to login
        expect(
          url.pathname.startsWith('/login'),
          `Correct-scope user should NOT be redirected to /login from ${route.path}`,
        ).toBe(false);

        // Should NOT see access denied
        const accessDenied = await page
          .getByText(/access denied|forbidden|insufficient permissions/i)
          .isVisible({ timeout: 1000 })
          .catch(() => false);
        expect(
          accessDenied,
          `Correct-scope user should NOT see "access denied" on ${route.path}`,
        ).toBe(false);

        await logout(page);
      });
    });
  }
});
