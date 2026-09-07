/**
 * Campus communication — gated live write smoke.
 * Uses HS256 cookies (`setupGatewayTenantSession`) so api-gateway jwtVerify accepts writes.
 * Does not relax production auth. Requires JWT_SECRET aligned with the gateway.
 */
import { expect, test } from '@playwright/test';

import { setupGatewayTenantSession } from './fixtures/fake-session';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
const HAS_JWT_SECRET = !!process.env.JWT_SECRET?.trim();

test.describe('Communication — client validation (ungated)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!HAS_JWT_SECRET, 'JWT_SECRET required to open authenticated campaign form');
    await setupGatewayTenantSession(page);
  });

  test('/communication/campaigns/new rejects empty name client-side', async ({ page }) => {
    await page.goto('/communication/campaigns/new', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('communication-campaign-form')).toHaveAttribute(
      'data-hydrated',
      'true',
    );
    await page.getByRole('button', { name: /create campaign/i }).click();
    await expect(page.getByRole('alert')).toContainText(/name is required/i);
  });
});

test.describe('Communication — live campaign create (E2E_BACKEND_READY)', () => {
  test.skip(
    !BACKEND_READY || !HAS_JWT_SECRET,
    'Requires E2E_BACKEND_READY=1, live gateway, and JWT_SECRET matching api-gateway',
  );

  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('creates a draft campaign via live API', async ({ page }) => {
    await page.goto('/communication/campaigns/new', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('communication-campaign-form')).toHaveAttribute(
      'data-hydrated',
      'true',
    );

    const name = `E2E campaign ${Date.now()}`;
    await page.getByLabel(/^name/i).fill(name);
    await page.getByLabel(/message body/i).fill('Created by campus live write smoke.');
    await page.getByRole('button', { name: /create campaign/i }).click();

    await expect(page).toHaveURL(/\/communication\/campaigns/, { timeout: 20_000 });
    await expect(page.getByText(name)).toBeVisible({ timeout: 10_000 });
  });
});
