/**
 * Task 56.7 — End-to-end accessibility gate.
 *
 * Walks every public surface the ProctiraERP web app exposes and runs
 * axe-core against it at the WCAG 2.1 AA rule set. The spec is split
 * into two `test.describe` blocks so reviewers can read the coverage
 * matrix at a glance:
 *
 *   1. Surfaces that ship without a backend (login screen, public
 *      tracking page, signup landing) — these run unconditionally so
 *      regressions are caught even on a vanilla `pnpm test:e2e`.
 *
 *   2. Surfaces that require an authenticated session (dashboard,
 *      students list, registration wizard step 1, mobile shell home).
 *      They are gated on `E2E_BACKEND_READY=1`, matching every other
 *      authenticated spec in this directory. When the gate is unset
 *      Playwright still parses the suite (verifying the helper
 *      compiles), so `pnpm playwright test --list` keeps working in
 *      CI without a live API.
 *
 * Each surface uses {@link runAxe} from `./helpers/axe`, which fails
 * the test on any violation and pretty-prints the offending rule(s) +
 * selector(s) so triaging the failure does not require running the
 * report locally.
 *
 * Requirements: 37.7, 37.8
 * Design: K
 */

import { expect, test } from '@playwright/test';

import { loginAsTenantAdmin } from './fixtures/auth';
import { runAxe } from './helpers/axe';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

// ────────────────────────────────────────────────────────────────────
// Surfaces that do not require a live backend.
// ────────────────────────────────────────────────────────────────────

test.describe('a11y — public surfaces (no backend required)', () => {
  test('login page is WCAG 2.1 AA clean', async ({ page }) => {
    await page.goto('/login');
    // Wait for the form chrome to be rendered before scanning so axe
    // sees the same DOM a real user would interact with.
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByRole('textbox', { name: /^password$/i })).toBeVisible();

    await runAxe(page, { checkpointLabel: '/login' });
  });

  test('public application-tracking page is WCAG 2.1 AA clean', async ({ page }) => {
    // Stub the backend so the empty form state is what axe scans.
    await page.route('**/api/v1/registration/applications/**', async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'NOT_FOUND' }),
      });
    });

    await page.goto('/track');
    await expect(page.getByLabel(/tracking number/i)).toBeVisible();

    await runAxe(page, { checkpointLabel: '/track (empty form)' });
  });

  test('signup form is WCAG 2.1 AA clean', async ({ page }) => {
    // The signup page is part of the auth route group but does not
    // require an authenticated session — it's the entry point for
    // creating one. Some deploys redirect to a marketing site; we
    // tolerate that by scanning whichever page actually loads.
    const response = await page.goto('/signup');
    if (response && response.status() >= 400) {
      test.skip(true, 'signup route is not enabled in this build');
    }
    await runAxe(page, { checkpointLabel: '/signup' });
  });

  for (const route of [
    { path: '/forgot-password', label: /email/i },
    { path: '/reset-password', label: /password/i },
    { path: '/mfa', label: /code|verification|authenticator|digit/i },
  ] as const) {
    test(`${route.path} is WCAG 2.1 AA clean`, async ({ page }) => {
      const response = await page.goto(route.path);
      if (response && response.status() >= 400) {
        test.skip(true, `${route.path} is not enabled in this build`);
      }
      // Best-effort wait for primary form chrome; MFA may render digit inputs.
      await page
        .getByLabel(route.label)
        .first()
        .waitFor({ state: 'visible', timeout: 5_000 })
        .catch(() => undefined);
      await runAxe(page, { checkpointLabel: route.path });
    });
  }
});

// ────────────────────────────────────────────────────────────────────
// Surfaces that require a live backend.
// ────────────────────────────────────────────────────────────────────

test.describe('a11y — authenticated surfaces (E2E_BACKEND_READY=1)', () => {
  test.skip(
    !BACKEND_READY,
    'E2E_BACKEND_READY is not set; skipping live-backend a11y scans. See e2e/README.md.',
  );

  test('signed-in dashboard landing is WCAG 2.1 AA clean', async ({ page }) => {
    await loginAsTenantAdmin(page);
    await expect(page.getByRole('main')).toBeVisible();
    await runAxe(page, { checkpointLabel: 'dashboard /' });
  });

  test('students list is WCAG 2.1 AA clean', async ({ page }) => {
    await loginAsTenantAdmin(page);
    await page.goto('/students');
    await expect(page.getByRole('heading', { name: /students/i })).toBeVisible();
    await runAxe(page, { checkpointLabel: '/students' });
  });

  for (const path of [
    '/reports',
    '/data-warehouse',
    '/data-warehouse/import',
    '/data-warehouse/field-mapping',
    '/data-warehouse/map',
    '/admin',
    '/health',
    '/health/screenings',
    '/health/counselling',
    '/health/counselling/new',
    '/health/special-needs',
    '/scholarships',
    '/scholarships/programs/new',
    '/scholarships/applications',
    '/scholarships/disbursements',
  ] as const) {
    test(`${path} is WCAG 2.1 AA clean`, async ({ page }) => {
      await loginAsTenantAdmin(page);
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await runAxe(page, { checkpointLabel: path });
    });
  }

  test('institutions list is WCAG 2.1 AA clean', async ({ page }) => {
    await loginAsTenantAdmin(page);
    await page.goto('/institutions');
    await expect(page.getByRole('heading', { name: /institutions/i })).toBeVisible();
    await runAxe(page, { checkpointLabel: '/institutions' });
  });

  test('registration portal wizard — step 1 is WCAG 2.1 AA clean', async ({ page }) => {
    // The registration portal lives at port 3002 in dev. We use the
    // PLAYWRIGHT_BASE_URL escape hatch so this test points at it when
    // the orchestrator boots both servers.
    const base = process.env.E2E_REGISTRATION_BASE_URL ?? 'http://localhost:3002';
    const response = await page.goto(`${base}/apply`);
    test.skip(
      !response || response.status() >= 500,
      'registration portal not running on E2E_REGISTRATION_BASE_URL',
    );
    await runAxe(page, { checkpointLabel: 'registration /apply' });
  });

  test('mobile shell home — viewport-scoped scan', async ({ browser }) => {
    // The mobile shell is a Flutter app, so we approximate its web
    // surface by scanning the dashboard at a phone viewport. This
    // catches viewport-conditional issues (touch target collisions,
    // mobile-only menus, hidden labels) at the WCAG AA rule set.
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }, // iPhone 14 Pro logical px
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    try {
      await loginAsTenantAdmin(page);
      await expect(page.getByRole('main')).toBeVisible();
      await runAxe(page, { checkpointLabel: 'mobile shell /' });
    } finally {
      await context.close();
    }
  });
});
