import { expect, test, type Page } from '@playwright/test';

/**
 * Examinations — ungated inventory + client create validation smoke.
 * Live create journeys remain gated elsewhere when E2E_BACKEND_READY=1.
 */

const EXAM_ID = '11111111-1111-4111-8111-111111111111';

/** Always-on inventory: list + create shell (no seeded exam required). */
const UNGATED_ROUTES: ReadonlyArray<{ path: string; heading: RegExp }> = [
  { path: '/examinations', heading: /examination/i },
  { path: '/examinations/new', heading: /schedule examination/i },
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

function createFakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

async function setupTenantSession(page: Page): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const token = createFakeJwt({
    sub: 'exam-e2e-user',
    email: 'admin@tenant-a.test',
    displayName: 'Exam E2E Admin',
    tenantId: '00000000-0000-4000-8000-0000000000aa',
    roles: [{ roleId: 'admin', roleName: 'Administrator', areaId: null }],
    iat: now,
    exp: now + 60 * 60 * 8,
  });

  await page.context().addCookies([
    {
      name: 'access_token',
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
    {
      name: 'refresh_token',
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
}

test.describe('Examinations — inventory smoke (ungated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupTenantSession(page);
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

  test('create form validates required fields client-side', async ({ page }) => {
    await page.goto('/examinations/new', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('examination-create-form')).toHaveAttribute(
      'data-hydrated',
      'true',
    );

    await page.getByTestId('examination-create-submit').click();
    await expect(page.getByText('Name is required')).toBeVisible();
    await expect(page.getByText('Code is required')).toBeVisible();
    await expect(page.getByText('Examination date is required')).toBeVisible();

    await page.locator('#exam-name').fill('Mid-term Assessment');
    await page.locator('#exam-code').fill('MTA-2026');
    await page.locator('#exam-date').fill('2026-10-01');
    await page.getByTestId('examination-create-submit').click();
    await expect(page.getByTestId('examination-create-demo-ack')).toBeVisible();
  });
});
