/**
 * Assessments — ungated inventory smoke.
 *
 * Always runs (no `E2E_BACKEND_READY` gate on the primary suite).
 * Protected assessment routes must redirect unauthenticated browsers
 * to `/login` with body + heading visible.
 *
 * Authenticated heading inventory is optional and gated when a live
 * backend session is available. Scheme edit uses a placeholder UUID —
 * live detail may 404 without seed data.
 */
import { expect, test } from '@playwright/test';

import { loginAsTenantAdmin } from './fixtures/auth';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

const SCHEME_ID = process.env.E2E_GRADING_SCHEME_ID ?? '44444444-4444-4444-8444-444444444444';

const ASSESSMENT_ROUTES: { id: string; path: string; heading?: RegExp }[] = [
  { id: 'schemes-list', path: '/assessments', heading: /assessment/i },
  { id: 'schemes-new', path: '/assessments/schemes/new', heading: /grading scheme/i },
  {
    id: 'schemes-edit',
    path: `/assessments/schemes/${SCHEME_ID}/edit`,
    heading: /.+/i,
  },
  { id: 'items', path: '/assessments/items', heading: /assessment|item/i },
  { id: 'results', path: '/assessments/results', heading: /result|assessment/i },
];

/** Routes that do not need a seeded scheme id. */
const UNGATED_ROUTES = ASSESSMENT_ROUTES.filter((r) => r.id !== 'schemes-edit');

test.describe('Assessments — inventory smoke (ungated)', () => {
  for (const route of UNGATED_ROUTES) {
    test(`${route.id} (${route.path}) unauthenticated → /login with body + heading`, async ({
      page,
    }) => {
      await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/\/login/);
      await expect(page.locator('body')).toBeVisible();
      await expect(page.getByRole('heading').first()).toBeVisible();
    });
  }

  test(`schemes-edit (${ASSESSMENT_ROUTES.find((r) => r.id === 'schemes-edit')!.path}) unauthenticated → /login`, async ({
    page,
  }) => {
    const route = ASSESSMENT_ROUTES.find((r) => r.id === 'schemes-edit')!;
    await page.goto(route.path, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('body')).toBeVisible();
    await expect(page.getByRole('heading').first()).toBeVisible();
  });
});

test.describe('Assessments — authenticated inventory (E2E_BACKEND_READY)', () => {
  test.skip(
    !BACKEND_READY,
    'E2E_BACKEND_READY is not set; skipping authenticated assessments inventory. Ungated suite above still asserts /login redirects.',
  );

  test.beforeEach(async ({ page }) => {
    await loginAsTenantAdmin(page);
  });

  for (const route of UNGATED_ROUTES) {
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

  test('schemes-edit renders when seeded scheme exists', async ({ page }) => {
    const route = ASSESSMENT_ROUTES.find((r) => r.id === 'schemes-edit')!;
    const response = await page.goto(route.path, { waitUntil: 'domcontentloaded' });
    expect(response, `missing response for ${route.path}`).toBeTruthy();
    // Seeded id may 404 — only assert usable shell when not not-found.
    if (response && response.status() < 400) {
      await expect(page.locator('body')).toBeVisible();
      await expect(page.getByRole('heading').first()).toBeVisible();
    }
  });
});
