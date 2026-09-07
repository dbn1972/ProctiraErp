import { expect, test, type Page } from '@playwright/test';

/**
 * Insights & System — ungated write-validation smoke.
 *
 * Always runs (no E2E_BACKEND_READY). Seeds a fake access_token so dashboard
 * `requireSession` passes. Asserts client validation on report builder and
 * field-mapping forms without claiming live generate/import APIs.
 */

function createFakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64');
  return `${header}.${body}.ZmFrZS1zaWduYXR1cmU`;
}

async function setupTenantSession(page: Page): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const token = createFakeJwt({
    sub: 'insights-write-e2e-user',
    email: 'admin@tenant-a.test',
    displayName: 'Insights Write E2E',
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

test.describe('Insights & System — write validation (ungated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupTenantSession(page);
  });

  test('/reports/new requires a template before generate', async ({ page }) => {
    await page.goto('/reports/new');
    // Mobile shell also renders an h1 brand title — target the page heading by name.
    await expect(page.getByRole('heading', { name: 'New report', exact: true })).toBeVisible();
    await expect(page.getByTestId('scaffold-mode-banner')).toBeVisible();
    await expect(page.getByTestId('report-builder-form')).toBeVisible();

    await page.getByRole('button', { name: /generate report/i }).click();
    await expect(page.getByTestId('report-builder-error')).toContainText(
      /select a report template/i,
    );
  });

  test('/data-warehouse/field-mapping requires at least one mapped column', async ({ page }) => {
    await page.goto('/data-warehouse/field-mapping');
    await expect(page.locator('#dw-mapping-heading')).toHaveText(/field mapping/i);
    await expect(page.getByTestId('scaffold-mode-banner')).toBeVisible();

    await page.getByRole('button', { name: /continue to validate/i }).click();
    await expect(page.getByText(/map at least one source column/i)).toBeVisible();

    await page.getByLabel(/warehouse field for student_id/i).selectOption('student.externalId');
    await page.getByRole('button', { name: /continue to validate/i }).click();
    await expect(page.getByTestId('field-mapping-demo-submit')).toBeVisible();
  });
});
