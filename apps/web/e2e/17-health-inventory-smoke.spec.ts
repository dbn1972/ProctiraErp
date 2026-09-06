/**
 * Health — ungated inventory smoke.
 *
 * Always runs (no `E2E_BACKEND_READY` gate on the primary suite).
 * Protected health routes must redirect unauthenticated browsers
 * to `/login` with body + heading visible.
 *
 * Authenticated heading inventory is optional and gated when a live
 * backend session is available.
 */
import { expect, test } from '@playwright/test';

import { loginAsTenantAdmin } from './fixtures/auth';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

const STUDENT_ID =
  process.env.HEALTH_STUDENT_ID ??
  process.env.E2E_STUDENT_ID ??
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

const HEALTH_ROUTES: { id: string; path: string; heading?: RegExp }[] = [
  { id: 'records-hub', path: '/health', heading: /health/i },
  { id: 'screenings', path: '/health/screenings', heading: /screenings/i },
  { id: 'counselling', path: '/health/counselling', heading: /counselling|counseling/i },
  {
    id: 'counselling-create',
    path: '/health/counselling/new',
    heading: /schedule counselling|counselling session/i,
  },
  { id: 'special-needs', path: '/health/special-needs', heading: /special needs/i },
  {
    id: 'student-profile',
    path: `/health/${STUDENT_ID}`,
    heading: /.+/i,
  },
];

test.describe('Health — inventory smoke (ungated)', () => {
  for (const route of HEALTH_ROUTES) {
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

test.describe('Health — authenticated inventory (E2E_BACKEND_READY)', () => {
  test.skip(
    !BACKEND_READY,
    'E2E_BACKEND_READY is not set; skipping authenticated health inventory. Ungated suite above still asserts /login redirects.',
  );

  test.beforeEach(async ({ page }) => {
    await loginAsTenantAdmin(page);
  });

  for (const route of HEALTH_ROUTES) {
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

  test('counselling create form exposes schedule fields when signed in', async ({ page }) => {
    await page.goto('/health/counselling/new', { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/\/login/);
    await expect(
      page.getByRole('heading', { name: /schedule counselling session/i }),
    ).toBeVisible();
    await expect(page.getByRole('form', { name: /create counselling session/i })).toBeVisible();
    await expect(page.getByLabel(/student id/i)).toBeVisible();
    await expect(page.getByLabel(/counsellor id/i)).toBeVisible();
    await expect(page.getByLabel(/session date/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /schedule session/i })).toBeVisible();
  });
});
