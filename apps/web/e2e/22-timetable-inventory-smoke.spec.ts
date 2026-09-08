/**
 * Timetable / bell / substitutions — ungated inventory smoke (WS1).
 *
 * Always runs (no E2E_BACKEND_READY gate on the primary suite).
 * Protected routes must redirect unauthenticated browsers to `/login`.
 */
import { expect, test } from '@playwright/test';

import { loginAsTenantAdmin } from './fixtures/auth';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

const ACADEMIC_PERIOD_ID =
  process.env.E2E_ACADEMIC_PERIOD_ID ?? 'a1b2c3d4-e5f6-4789-a012-3456789abcde';
const INSTITUTION_ID = process.env.E2E_INSTITUTION_ID ?? 'a2e96cd1-0232-4cce-97e2-00ebbfb9a374';

const TIMETABLE_ROUTES: { id: string; path: string }[] = [
  {
    id: 'bell-schedules',
    path: `/academic-periods/${ACADEMIC_PERIOD_ID}/bell-schedules`,
  },
  {
    id: 'institution-timetable',
    path: `/institutions/${INSTITUTION_ID}/timetable`,
  },
  {
    id: 'staff-substitutions',
    path: '/staff/substitutions',
  },
];

test.describe('Timetable — inventory smoke (ungated)', () => {
  for (const route of TIMETABLE_ROUTES) {
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

test.describe('Timetable — authenticated inventory (E2E_BACKEND_READY)', () => {
  test.skip(
    !BACKEND_READY,
    'E2E_BACKEND_READY is not set; skipping authenticated timetable inventory. Ungated suite above still asserts /login redirects.',
  );

  test.beforeEach(async ({ page }) => {
    await loginAsTenantAdmin(page);
  });

  for (const route of TIMETABLE_ROUTES) {
    test(`${route.id} renders body + heading when signed in`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      await expect(page).not.toHaveURL(/\/login/);
      await expect(page.locator('body')).toBeVisible();
      await expect(page.getByRole('heading').first()).toBeVisible();
    });
  }
});
