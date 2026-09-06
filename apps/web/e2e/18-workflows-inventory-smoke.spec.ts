/**
 * Workflows — ungated inventory smoke.
 *
 * Always runs (no `E2E_BACKEND_READY` gate on the primary suite).
 * Protected workflow routes must redirect unauthenticated browsers
 * to `/login` with body + heading visible.
 *
 * Authenticated heading inventory is optional and gated when a live
 * backend session is available.
 */
import { expect, test } from '@playwright/test';

import { loginAsTenantAdmin } from './fixtures/auth';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

const DEFINITION_ID =
  process.env.WORKFLOW_DEFINITION_ID ?? 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';

const WORKFLOW_ROUTES: { id: string; path: string; heading?: RegExp }[] = [
  { id: 'definitions', path: '/workflows', heading: /workflow/i },
  {
    id: 'new-definition',
    path: '/workflows/definitions/new',
    heading: /new definition|create|definition/i,
  },
  { id: 'instances', path: '/workflows/instances', heading: /instance/i },
  { id: 'approvals', path: '/workflows/approvals', heading: /approval/i },
  {
    id: 'definition-detail',
    path: `/workflows/definitions/${DEFINITION_ID}`,
    heading: /.+/i,
  },
];

test.describe('Workflows — inventory smoke (ungated)', () => {
  for (const route of WORKFLOW_ROUTES) {
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

test.describe('Workflows — authenticated inventory (E2E_BACKEND_READY)', () => {
  test.skip(
    !BACKEND_READY,
    'E2E_BACKEND_READY is not set; skipping authenticated workflows inventory. Ungated suite above still asserts /login redirects.',
  );

  test.beforeEach(async ({ page }) => {
    await loginAsTenantAdmin(page);
  });

  for (const route of WORKFLOW_ROUTES) {
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
