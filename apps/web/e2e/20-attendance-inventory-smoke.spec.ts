/**
 * Attendance — ungated inventory smoke.
 *
 * Always runs (no `E2E_BACKEND_READY` gate on the primary suite).
 * Protected attendance routes must redirect unauthenticated browsers
 * to `/login` with body + heading visible.
 *
 * Authenticated heading inventory is optional and gated when a live
 * backend session is available.
 */
import { expect, test } from '@playwright/test';

import { loginAsTenantAdmin } from './fixtures/auth';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

const ATTENDANCE_ROUTES: { id: string; path: string; heading?: RegExp }[] = [
  { id: 'mark', path: '/attendance', heading: /mark attendance|attendance/i },
  {
    id: 'reports',
    path: '/attendance/reports',
    heading: /attendance|report/i,
  },
];

test.describe('Attendance — inventory smoke (ungated)', () => {
  for (const route of ATTENDANCE_ROUTES) {
    test(`${route.id} (${route.path}) unauthenticated → /login with body + heading`, async ({
      page,
    }) => {
      await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/\/login/);
      await expect(page.locator('body')).toBeVisible();
      await expect(page.getByRole('heading').first()).toBeVisible();
    });
  }
});

test.describe('Attendance — authenticated inventory (E2E_BACKEND_READY)', () => {
  test.skip(
    !BACKEND_READY,
    'E2E_BACKEND_READY is not set; skipping authenticated attendance inventory. Ungated suite above still asserts /login redirects.',
  );

  test.beforeEach(async ({ page }) => {
    await loginAsTenantAdmin(page);
  });

  for (const route of ATTENDANCE_ROUTES) {
    test(`${route.id} renders body + heading when signed in`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      await expect(page).not.toHaveURL(/\/login/);
      await expect(page.locator('body')).toBeVisible();
      const heading = page.getByRole('heading').first();
      await expect(heading).toBeVisible();
      if (route.heading && route.heading.source !== '.+') {
        await expect(heading).toHaveText(route.heading);
      }
    });
  }
});
