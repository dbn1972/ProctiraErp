/**
 * Institutions — ungated inventory smoke.
 *
 * Always runs (no `E2E_BACKEND_READY` gate on the primary suite).
 * Protected institution routes must redirect unauthenticated browsers
 * to `/login` with body + heading visible.
 *
 * Authenticated heading inventory is optional and gated when a live
 * backend session is available.
 */
import { expect, test } from '@playwright/test';

import { loginAsTenantAdmin } from './fixtures/auth';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

const INSTITUTION_ID = process.env.E2E_INSTITUTION_ID ?? 'a2e96cd1-0232-4cce-97e2-00ebbfb9a374';

const INSTITUTION_ROUTES: { id: string; path: string; heading?: RegExp }[] = [
  { id: 'list', path: '/institutions', heading: /institutions/i },
  { id: 'register', path: '/institutions/new', heading: /register institution/i },
  {
    id: 'profile',
    path: `/institutions/${INSTITUTION_ID}`,
    heading: /.+/i,
  },
  {
    id: 'overview',
    path: `/institutions/${INSTITUTION_ID}/overview`,
    heading: /.+/i,
  },
  {
    id: 'edit',
    path: `/institutions/${INSTITUTION_ID}/edit`,
    heading: /.+/i,
  },
  {
    id: 'classes',
    path: `/institutions/${INSTITUTION_ID}/classes`,
    heading: /.+/i,
  },
  {
    id: 'grades',
    path: `/institutions/${INSTITUTION_ID}/grades`,
    heading: /.+/i,
  },
  {
    id: 'infrastructure',
    path: `/institutions/${INSTITUTION_ID}/infrastructure`,
    heading: /infrastructure|.+/i,
  },
];

test.describe('Institutions — inventory smoke (ungated)', () => {
  for (const route of INSTITUTION_ROUTES) {
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

test.describe('Institutions — authenticated inventory (E2E_BACKEND_READY)', () => {
  test.skip(
    !BACKEND_READY,
    'E2E_BACKEND_READY is not set; skipping authenticated institutions inventory. Ungated suite above still asserts /login redirects.',
  );

  test.beforeEach(async ({ page }) => {
    await loginAsTenantAdmin(page);
  });

  for (const route of INSTITUTION_ROUTES) {
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
