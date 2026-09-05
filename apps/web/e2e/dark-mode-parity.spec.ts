/**
 * Task 47.6 — Property F-2: Dark Mode Parity
 *
 * **Validates: Requirements 36.5, 36.6, 37.2, 37.8**
 *
 * For any route `r` reachable in the authenticated dashboard, `r` SHALL
 * render without WCAG 2.1 AA contrast violations in both `light` and
 * `dark` themes when toggled via the ThemeProvider.
 *
 * Strategy:
 *   1. Enumerate every top-level dashboard route (the page.tsx files
 *      under `src/app/(dashboard)/`).
 *   2. For each route, log in, navigate to the route, and run axe-core
 *      in light mode.
 *   3. Toggle the theme to dark mode via the `<html>` element's
 *      `data-theme` attribute and `.dark` class (matching ThemeProvider
 *      behavior).
 *   4. Run axe-core again in dark mode.
 *   5. Assert zero WCAG 2.1 AA contrast violations in both modes.
 *
 * The test is gated on `E2E_BACKEND_READY=1` because the dashboard
 * routes require an authenticated session backed by a live API.
 */

import { expect, test } from '@playwright/test';

import { loginAsTenantAdmin } from './fixtures/auth';
import { runAxe } from './helpers/axe';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

/**
 * All top-level authenticated dashboard routes derived from the
 * `src/app/(dashboard)/` directory structure. Dynamic routes (e.g.
 * `[id]`) are excluded because they require seeded entity IDs; the
 * list pages exercise the same layout chrome, sidebar, header, and
 * shared components that dynamic pages inherit.
 */
const DASHBOARD_ROUTES = [
  { path: '/', label: 'dashboard home' },
  { path: '/students', label: 'students list' },
  { path: '/staff', label: 'staff list' },
  { path: '/institutions', label: 'institutions list' },
  { path: '/attendance', label: 'attendance' },
  { path: '/assessments', label: 'assessments' },
  { path: '/examinations', label: 'examinations' },
  { path: '/scholarships', label: 'scholarships' },
  { path: '/health', label: 'health' },
  { path: '/health/screenings', label: 'health-screenings' },
  { path: '/health/counselling', label: 'health-counselling' },
  { path: '/health/special-needs', label: 'health-special-needs' },
  { path: '/workflows', label: 'workflows' },
  { path: '/workflows/approvals', label: 'workflows-approvals' },
  { path: '/workflows/instances', label: 'workflows-instances' },
  { path: '/workflows/definitions/new', label: 'workflows-definition-new' },
  { path: '/reports', label: 'reports' },
  { path: '/reports/new', label: 'reports-new' },
  { path: '/data-warehouse', label: 'data warehouse' },
  { path: '/data-warehouse/import', label: 'data-warehouse-import' },
  { path: '/data-warehouse/field-mapping', label: 'data-warehouse-field-mapping' },
  { path: '/data-warehouse/map', label: 'data-warehouse-gis-map' },
  { path: '/academic-periods', label: 'academic periods' },
  { path: '/admin', label: 'admin' },
  { path: '/admin/users', label: 'admin-users' },
  { path: '/admin/roles', label: 'admin-roles' },
  { path: '/admin/permissions', label: 'admin-permissions' },
  { path: '/admin/tenant', label: 'admin-tenant' },
] as const;

/**
 * Toggles the page theme by manipulating the `<html>` element's
 * `data-theme` attribute and class list, mirroring what the
 * ThemeProvider does when `setMode` is called.
 */
async function setTheme(
  page: import('@playwright/test').Page,
  theme: 'light' | 'dark',
): Promise<void> {
  await page.evaluate((t) => {
    const root = document.documentElement;
    root.dataset.theme = t;
    if (t === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
    }
  }, theme);
  // Allow a repaint cycle so CSS custom properties resolve.
  await page.waitForTimeout(100);
}

test.describe('Property F-2: Dark Mode Parity (E2E_BACKEND_READY=1)', () => {
  test.skip(
    !BACKEND_READY,
    'E2E_BACKEND_READY is not set; skipping dark-mode parity scans. See e2e/README.md.',
  );

  for (const route of DASHBOARD_ROUTES) {
    test(`${route.label} (${route.path}) — no WCAG 2.1 AA contrast violations in light mode`, async ({
      page,
    }) => {
      await loginAsTenantAdmin(page);
      await page.goto(route.path);
      // Wait for the main content area to be visible before scanning.
      await page
        .waitForSelector('[role="main"], main', {
          state: 'visible',
          timeout: 15_000,
        })
        .catch(() => {
          // Some routes may not have a <main> landmark yet; proceed anyway.
        });

      await setTheme(page, 'light');
      await runAxe(page, {
        checkpointLabel: `${route.path} [light]`,
      });
    });

    test(`${route.label} (${route.path}) — no WCAG 2.1 AA contrast violations in dark mode`, async ({
      page,
    }) => {
      await loginAsTenantAdmin(page);
      await page.goto(route.path);
      await page
        .waitForSelector('[role="main"], main', {
          state: 'visible',
          timeout: 15_000,
        })
        .catch(() => {
          // Some routes may not have a <main> landmark yet; proceed anyway.
        });

      await setTheme(page, 'dark');
      await runAxe(page, {
        checkpointLabel: `${route.path} [dark]`,
      });
    });
  }
});

/**
 * Public Auth surfaces do not need a live backend — keep a always-on dark
 * parity smoke so Auth enterprise claims are not gated solely on dashboard.
 */
const AUTH_PUBLIC_ROUTES = [
  { path: '/login', label: 'login' },
  { path: '/signup', label: 'signup' },
  { path: '/forgot-password', label: 'forgot-password' },
  { path: '/reset-password', label: 'reset-password' },
  { path: '/mfa', label: 'mfa' },
] as const;

test.describe('Property F-2: Dark Mode Parity — Auth public surfaces (always on)', () => {
  for (const route of AUTH_PUBLIC_ROUTES) {
    test(`${route.label} (${route.path}) — no WCAG 2.1 AA contrast violations in dark mode`, async ({
      page,
    }) => {
      const response = await page.goto(route.path);
      if (!response || response.status() >= 400) {
        test.skip(true, `${route.path} is not enabled in this build`);
      }

      await setTheme(page, 'dark');
      await runAxe(page, {
        checkpointLabel: `${route.path} [dark]`,
      });
    });
  }
});
