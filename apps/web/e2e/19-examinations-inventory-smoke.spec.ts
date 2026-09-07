import { expect, test } from '@playwright/test';

import { setupFakeTenantSession } from './fixtures/fake-session';

const EXAM_ID = '11111111-1111-4111-8111-111111111111';
const PERIOD_ID = '22222222-2222-4222-8222-222222222222';
const INSTITUTION_ID = '33333333-3333-4333-8333-333333333333';

/** Always-on inventory: list + create shell (no seeded exam required). */
const UNGATED_ROUTES: ReadonlyArray<{ path: string; heading: RegExp }> = [
  { path: '/examinations', heading: /examination/i },
  { path: '/examinations/new', heading: /schedule examination/i },
  { path: '/examinations/board-exports', heading: /board export/i },
];

/**
 * Detail tabs need a real/seeded examination. Gate on E2E_BACKEND_READY so
 * offline runs do not assert 200 against `notFound()` for a fake UUID.
 */
const SEEDED_DETAIL_ROUTES: ReadonlyArray<{ path: string; heading: RegExp }> = [
  { path: `/examinations/${EXAM_ID}`, heading: /.+/ },
  { path: `/examinations/${EXAM_ID}/candidates`, heading: /.+/ },
  { path: `/examinations/${EXAM_ID}/results`, heading: /.+/ },
  { path: `/examinations/${EXAM_ID}/documents`, heading: /.+/ },
];

test.describe('Examinations — unauthenticated inventory (ungated)', () => {
  for (const route of UNGATED_ROUTES) {
    test(`${route.path} unauthenticated → /login with body + heading`, async ({
      page,
    }) => {
      await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/\/login/);
      await expect(page.locator('body')).toBeVisible();
      await expect(page.getByRole('heading').first()).toBeVisible();
    });
  }
});

test.describe('Examinations — inventory smoke (session cookie)', () => {
  test.beforeEach(async ({ page }) => {
    await setupFakeTenantSession(page, {
      sub: 'exam-e2e-user',
      displayName: 'Exam E2E Admin',
    });
  });

  for (const route of UNGATED_ROUTES) {
    test(`${route.path} returns usable shell`, async ({ page }) => {
      const response = await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      expect(response, `missing response for ${route.path}`).toBeTruthy();
      expect(response!.status(), `${route.path} status`).toBeLessThan(400);
      await expect(page.locator('main h1, h1').first()).toBeVisible();
      await expect(page.locator('main h1, h1').first()).toHaveText(route.heading);
    });
  }

  for (const route of SEEDED_DETAIL_ROUTES) {
    test(`${route.path} returns usable shell (seeded backend)`, async ({ page }) => {
      test.skip(
        process.env.E2E_BACKEND_READY !== '1',
        'Examination detail requires seeded exams API (E2E_BACKEND_READY=1)',
      );
      const response = await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      expect(response, `missing response for ${route.path}`).toBeTruthy();
      expect(response!.status(), `${route.path} status`).toBeLessThan(400);
      await expect(page.locator('main h1, h1').first()).toBeVisible();
      await expect(page.locator('main h1, h1').first()).toHaveText(route.heading);
    });
  }

  test('create form validates required CreateExamination fields client-side', async ({
    page,
  }) => {
    await page.goto('/examinations/new', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('examination-create-form')).toHaveAttribute(
      'data-hydrated',
      'true',
    );

    await page.getByTestId('examination-start-date').fill('');
    await page.getByTestId('examination-end-date').fill('');
    await page.getByTestId('examination-create-submit').click();

    await expect(page.getByText('Name is required', { exact: true })).toBeVisible();
    await expect(page.getByText('Code is required', { exact: true })).toBeVisible();
    await expect(page.getByText('UUID is required').first()).toBeVisible();
    await expect(page.getByText('Date is required').first()).toBeVisible();
    await expect(page.getByText('Subject name is required', { exact: true })).toBeVisible();
    await expect(page.getByText('Center name is required', { exact: true })).toBeVisible();
  });

  test('create form posts to API without inventing demo success', async ({ page }) => {
    await page.goto('/examinations/new', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('examination-create-form')).toHaveAttribute(
      'data-hydrated',
      'true',
    );

    await page.locator('#exam-name').fill('Mid-term Assessment');
    await page.locator('#exam-code').fill(`MTA-${Date.now()}`);
    await page.getByTestId('examination-academic-period').fill(PERIOD_ID);
    await page.getByTestId('examination-subject-name').fill('Mathematics');
    await page.getByTestId('examination-subject-code').fill('MATH');
    await page.getByTestId('examination-center-name').fill('Hall A');
    await page.getByTestId('examination-center-code').fill('CTR-A');

    const institutionControl = page.getByTestId('examination-center-institution');
    const tag = await institutionControl.evaluate((el) => el.tagName.toLowerCase());
    if (tag === 'input') {
      await institutionControl.fill(INSTITUTION_ID);
    }

    await page.getByTestId('examination-create-submit').click();

    await Promise.race([
      page.waitForURL(/\/examinations\/[0-9a-f-]{36}/i, { timeout: 20_000 }),
      page
        .getByTestId('examination-create-error')
        .waitFor({ state: 'visible', timeout: 20_000 }),
      page
        .getByTestId('examination-create-success')
        .waitFor({ state: 'visible', timeout: 20_000 }),
    ]);
    await expect(page.getByTestId('examination-create-demo-ack')).toHaveCount(0);
  });
});
