import { expect, test, type Page } from '@playwright/test';

import { createSignedJwt } from './fixtures/fake-session';

/**
 * Insights — live write proofs when gateway is up (E2E_BACKEND_READY).
 * Ungated suite still covers client validation via 14b.
 *
 * The session cookie must be a real HS256 token: the gateway verifies
 * signatures fail-closed (G-703), and the server components proxy this cookie
 * to /reports/templates — an unsigned token yields 401 → scaffold banner.
 */

async function setupTenantSession(page: Page): Promise<void> {
  const token = createSignedJwt({
    sub: 'insights-live-e2e',
    email: 'admin@tenant-a.test',
    displayName: 'Insights Live E2E',
    tenantId: '00000000-0000-4000-8000-0000000000aa',
    roles: [{ roleId: 'admin', roleName: 'Administrator', areaId: 'root' }],
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
  ]);
}

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

test.describe('Insights — live write proofs (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires Insights UI plugin on the live gateway');

  test.beforeEach(async ({ page }) => {
    await setupTenantSession(page);
  });

  test('report builder hides scaffold banner and can generate live', async ({ page }) => {
    await page.goto('/reports/new', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/new report/i);
    await expect(page.getByTestId('scaffold-mode-banner')).toHaveCount(0);
    await expect(page.getByTestId('report-builder-form')).toHaveAttribute(
      'data-live-generate',
      'true',
    );
    // Wait for React to attach handlers before driving the select.
    await expect(page.getByTestId('report-builder-form')).toHaveAttribute('data-hydrated', 'true');

    await page.locator('#report-template').selectOption('tpl-enrolment-summary');
    await page.locator('#filter-academicPeriodId').fill('2025-26');
    await page.getByRole('button', { name: /generate report/i }).click();
    await expect(page.getByTestId('report-builder-live-submit')).toBeVisible({ timeout: 15_000 });
  });

  test('warehouse import queues a live CSV job', async ({ page }) => {
    await page.goto('/data-warehouse/import', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/import data/i);
    await expect(page.getByTestId('scaffold-mode-banner')).toHaveCount(0);
    await expect(page.getByTestId('import-source-forms')).toHaveAttribute('data-hydrated', 'true');

    await page.setInputFiles('input[aria-label="Upload CSV file"]', {
      name: 'students.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('student_id,name\na,Ada\n'),
    });
    await page
      .getByRole('button', { name: /^upload$/i })
      .nth(1)
      .click();
    await expect(page.getByTestId('csv-live-submit')).toBeVisible({ timeout: 15_000 });
  });
});
