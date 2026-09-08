/**
 * Gradebook / transcripts — ungated inventory smoke (WS3).
 *
 * Always runs (no E2E_BACKEND_READY gate on the primary suite).
 * Protected routes must redirect unauthenticated browsers to `/login`.
 */
import { expect, test } from '@playwright/test';

import { loginAsTenantAdmin } from './fixtures/auth';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

const INSTITUTION_ID = process.env.E2E_INSTITUTION_ID ?? '2e0126f1-752b-4d63-ba57-633a83cc6508';

const GRADEBOOK_ROUTES: { id: string; path: string }[] = [
  {
    id: 'institution-gradebook',
    path: `/institutions/${INSTITUTION_ID}/gradebook`,
  },
  {
    id: 'student-records',
    path: '/students/records',
  },
];

test.describe('Gradebook — inventory smoke (ungated)', () => {
  for (const route of GRADEBOOK_ROUTES) {
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

test.describe('Gradebook — authenticated inventory (E2E_BACKEND_READY)', () => {
  test.skip(
    !BACKEND_READY,
    'E2E_BACKEND_READY is not set; skipping authenticated gradebook inventory. Ungated suite above still asserts /login redirects.',
  );

  test.beforeEach(async ({ page }) => {
    await loginAsTenantAdmin(page);
  });

  for (const route of GRADEBOOK_ROUTES) {
    test(`${route.id} renders body + heading when signed in`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      await expect(page).not.toHaveURL(/\/login/);
      await expect(page.locator('body')).toBeVisible();
      await expect(page.getByRole('heading').first()).toBeVisible();
    });
  }
});
