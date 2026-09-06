/**
 * Overview & People — ungated inventory smoke.
 *
 * Always runs (no `E2E_BACKEND_READY` gate on the primary suite).
 * Protected Dashboard / Students / Staff routes must redirect
 * unauthenticated browsers to `/login` with body + heading visible.
 *
 * Authenticated heading inventory is optional and gated: without a live
 * backend there is no durable session / storageState, so we document that
 * path separately rather than skipping the whole file.
 */
import { expect, test } from '@playwright/test';

import { loginAsTenantAdmin } from './fixtures/auth';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

const STUDENT_ID = process.env.E2E_STUDENT_ID ?? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const STAFF_ID = process.env.E2E_STAFF_ID ?? 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';

/** People inventory routes (static + seeded dynamic). */
const PEOPLE_ROUTES: { id: string; path: string; heading?: RegExp }[] = [
  { id: 'dashboard', path: '/', heading: /dashboard/i },
  { id: 'students-list', path: '/students', heading: /students/i },
  { id: 'students-add', path: '/students/new', heading: /add student/i },
  { id: 'students-import', path: '/students/import', heading: /import/i },
  {
    id: 'students-profile',
    path: `/students/${STUDENT_ID}`,
    heading: /.+/i,
  },
  {
    id: 'students-edit',
    path: `/students/${STUDENT_ID}/edit`,
    heading: /edit student/i,
  },
  {
    id: 'students-transfer',
    path: `/students/${STUDENT_ID}/transfer`,
    heading: /transfer/i,
  },
  { id: 'staff-list', path: '/staff', heading: /^staff$/i },
  { id: 'staff-add', path: '/staff/new', heading: /add staff/i },
  { id: 'staff-profile', path: `/staff/${STAFF_ID}`, heading: /.+/i },
  { id: 'staff-edit', path: `/staff/${STAFF_ID}/edit`, heading: /edit/i },
  {
    id: 'staff-assignment',
    path: `/staff/${STAFF_ID}/assignments/new`,
    heading: /assignment/i,
  },
  {
    id: 'staff-appraisal',
    path: `/staff/${STAFF_ID}/appraisals/new`,
    heading: /appraisal/i,
  },
];

test.describe('Overview & People — inventory smoke (ungated)', () => {
  for (const route of PEOPLE_ROUTES) {
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

test.describe('Overview & People — authenticated inventory (E2E_BACKEND_READY)', () => {
  test.skip(
    !BACKEND_READY,
    'E2E_BACKEND_READY is not set; skipping authenticated people inventory. Ungated suite above still asserts /login redirects.',
  );

  test.beforeEach(async ({ page }) => {
    await loginAsTenantAdmin(page);
  });

  for (const route of PEOPLE_ROUTES) {
    test(`${route.id} renders body + heading when signed in`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      await expect(page).not.toHaveURL(/\/login/);
      await expect(page.locator('body')).toBeVisible();
      const heading = page.getByRole('heading').first();
      await expect(heading).toBeVisible();
      if (route.heading) {
        await expect(heading).toHaveText(route.heading);
      }
    });
  }
});
