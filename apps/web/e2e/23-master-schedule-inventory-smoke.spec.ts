/**
 * Master schedule — ungated inventory smoke (WS2).
 *
 * Always runs (no E2E_BACKEND_READY gate on the primary suite).
 * Protected routes must redirect unauthenticated browsers to `/login`.
 */
import { expect, test } from '@playwright/test';

import { loginAsTenantAdmin } from './fixtures/auth';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

const INSTITUTION_ID =
  process.env.E2E_INSTITUTION_ID ?? '2e0126f1-752b-4d63-ba57-633a83cc6508';
const SECTION_ID =
  process.env.E2E_SECTION_ID ?? 'a3000001-0001-4000-8000-000000000001';

const SCHEDULE_ROUTES: { id: string; path: string }[] = [
  {
    id: 'institution-schedule',
    path: `/institutions/${INSTITUTION_ID}/schedule`,
  },
  {
    id: 'section-roster',
    path: `/institutions/${INSTITUTION_ID}/schedule/${SECTION_ID}`,
  },
];

test.describe('Master schedule — inventory smoke (ungated)', () => {
  for (const route of SCHEDULE_ROUTES) {
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

test.describe('Master schedule — authenticated inventory (E2E_BACKEND_READY)', () => {
  test.skip(
    !BACKEND_READY,
    'E2E_BACKEND_READY is not set; skipping authenticated schedule inventory. Ungated suite above still asserts /login redirects.',
  );

  test.beforeEach(async ({ page }) => {
    await loginAsTenantAdmin(page);
  });

  for (const route of SCHEDULE_ROUTES) {
    test(`${route.id} renders body + heading when signed in`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      await expect(page).not.toHaveURL(/\/login/);
      await expect(page.locator('body')).toBeVisible();
      await expect(page.getByRole('heading').first()).toBeVisible();
    });
  }
});
