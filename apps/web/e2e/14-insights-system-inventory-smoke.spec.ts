import { expect, test, type Page } from '@playwright/test';

/**
 * Insights & System — ungated inventory smoke.
 *
 * Always runs (no E2E_BACKEND_READY). Seeds a fake access_token so dashboard
 * `requireSession` passes. Asserts HTTP 200 + primary h1 / landmark for each
 * inventory route. Live API journeys remain in `13-insights-system.spec.ts`.
 */

const REPORT_SMOKE_ID = 'smoke-template-missing';

const INVENTORY_ROUTES: ReadonlyArray<{ path: string; heading: RegExp }> = [
  { path: '/reports', heading: /^reports$/i },
  { path: '/reports/new', heading: /new report/i },
  { path: `/reports/${REPORT_SMOKE_ID}/results`, heading: /report results/i },
  { path: '/data-warehouse', heading: /data warehouse/i },
  { path: '/data-warehouse/import', heading: /import data/i },
  { path: '/data-warehouse/field-mapping', heading: /field mapping/i },
  { path: '/data-warehouse/map', heading: /gis map/i },
  { path: '/admin', heading: /administration/i },
  { path: '/admin/users', heading: /^users$/i },
  { path: '/admin/roles', heading: /^roles$/i },
  { path: '/admin/permissions', heading: /permissions/i },
  { path: '/admin/tenant', heading: /tenant settings/i },
  { path: '/track', heading: /.+/ },
];

function createFakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64');
  return `${header}.${body}.ZmFrZS1zaWduYXR1cmU`;
}

async function setupTenantSession(page: Page): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const token = createFakeJwt({
    sub: 'insights-e2e-user',
    email: 'admin@tenant-a.test',
    displayName: 'Insights E2E Admin',
    tenantId: 'tenant-a',
    roles: [{ roleId: 'admin', roleName: 'Administrator', areaId: 'root' }],
    iat: now,
    exp: now + 60 * 60 * 8,
  });

  const baseUrl = new URL(page.url() === 'about:blank' ? 'http://localhost:3001' : page.url());

  await page.context().addCookies([
    {
      name: 'access_token',
      value: token,
      domain: baseUrl.hostname,
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
    {
      name: 'refresh_token',
      value: 'fake-refresh',
      domain: baseUrl.hostname,
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
    {
      name: 'tenant',
      value: 'tenant-a',
      domain: baseUrl.hostname,
      path: '/',
      secure: false,
      sameSite: 'Lax',
    },
  ]);
}

test.describe('Insights & System — inventory smoke (ungated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupTenantSession(page);
  });

  for (const route of INVENTORY_ROUTES) {
    test(`${route.path} returns 200 with h1`, async ({ page }) => {
      // Public track should not require auth; still fine with cookie present.
      if (route.path === '/track') {
        await page.route('**/api/v1/registration/applications/**', async (r) => {
          await r.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'NOT_FOUND' }),
          });
        });
      }

      const response = await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      expect(response, `missing response for ${route.path}`).toBeTruthy();
      expect(response!.status(), `${route.path} status`).toBeLessThan(400);

      const heading = page.locator('main h1, h1').first();
      await expect(heading).toBeVisible();
      await expect(heading).toHaveText(route.heading);

      if (route.path !== '/track') {
        await expect(page.getByTestId('scaffold-mode-banner')).toBeVisible();
      }
    });
  }

  test('field mapping form validates before demo continue', async ({ page }) => {
    await page.goto('/data-warehouse/field-mapping');
    await page.getByRole('button', { name: /continue to validate/i }).click();
    await expect(page.getByText(/map at least one source column/i)).toBeVisible();

    await page.getByLabel(/warehouse field for student_id/i).selectOption('student.externalId');
    await page.getByRole('button', { name: /continue to validate/i }).click();
    await expect(page.getByTestId('field-mapping-demo-submit')).toBeVisible();
  });

  test('import database form validates connection string', async ({ page }) => {
    await page.goto('/data-warehouse/import');
    await page.getByRole('button', { name: /^import$/i }).click();
    await expect(page.getByText(/connection string is required/i)).toBeVisible();

    await page.getByLabel(/connection string/i).fill('postgres://demo:demo@localhost/dw');
    await page.getByRole('button', { name: /^import$/i }).click();
    await expect(page.getByTestId('database-demo-submit')).toBeVisible();
  });
});
