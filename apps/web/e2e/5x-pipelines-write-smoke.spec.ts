import { expect, test, type Page } from '@playwright/test';

import { setupFakeTenantSession, setupGatewayTenantSession } from './fixtures/fake-session';

/**
 * ETL pipelines — ungated shell + gated create/list smoke (PRD-009).
 */

async function setupPipelinesSession(page: Page): Promise<void> {
  await setupFakeTenantSession(page, {
    sub: 'etl-e2e-user',
    email: 'etl@tenant-a.test',
    displayName: 'ETL E2E',
    tenantId: '00000000-0000-4000-8000-0000000000aa',
    roles: [{ roleId: 'admin', roleName: 'SUPER_ADMIN', areaId: null }],
  });
}

async function setupPipelinesLiveSession(page: Page): Promise<void> {
  await setupGatewayTenantSession(page, {
    sub: 'etl-e2e-user',
    email: 'etl@tenant-a.test',
    displayName: 'ETL E2E',
    tenantId: '00000000-0000-4000-8000-0000000000aa',
    roles: [{ roleId: 'admin', roleName: 'SUPER_ADMIN', areaId: null }],
  });
}

test.describe('ETL pipelines — shell (ungated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupPipelinesSession(page);
  });

  test('/pipelines renders create form and heading', async ({ page }) => {
    const response = await page.goto('/pipelines', { waitUntil: 'domcontentloaded' });
    expect(response?.status() ?? 500).toBeLessThan(400);
    await expect(page.getByRole('heading', { name: /etl pipelines/i })).toBeVisible();
    await expect(page.getByTestId('create-pipeline-form')).toBeVisible();
    // Prefer the in-page CTA — sidebar also has a "Data Warehouse" nav link.
    await expect(page.getByRole('link', { name: /data warehouse indicators/i })).toBeVisible();
  });

  test('/pipelines rejects empty name client-side', async ({ page }) => {
    await page.goto('/pipelines', { waitUntil: 'domcontentloaded' });
    await page.getByLabel(/pipeline name/i).fill('');
    await page.getByRole('button', { name: /create pipeline/i }).click();
    // HTML required attribute or our setError — either is acceptable honesty.
    const nativeInvalid = await page.getByLabel(/pipeline name/i).evaluate((el) => {
      return (el as HTMLInputElement).validity.valueMissing;
    });
    expect(nativeInvalid || (await page.getByRole('alert').count()) > 0).toBeTruthy();
  });
});

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

test.describe('ETL pipelines — live create (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires live gateway + ETL mount');

  test.beforeEach(async ({ page }) => {
    await setupPipelinesLiveSession(page);
  });

  test('creates a pipeline and lists it', async ({ page }) => {
    const name = `E2E Pipeline ${Date.now()}`;
    await page.goto('/pipelines', { waitUntil: 'domcontentloaded' });
    await page.getByLabel(/pipeline name/i).fill(name);
    await page.getByRole('button', { name: /create pipeline/i }).click();
    await expect(page.getByText(name)).toBeVisible({ timeout: 20_000 });
  });
});
