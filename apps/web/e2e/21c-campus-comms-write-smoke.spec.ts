/**
 * Campus communication — gated live write smoke.
 * Uses HS256 cookies (`setupGatewayTenantSession`) so api-gateway jwtVerify accepts writes.
 * Does not relax production auth. Requires JWT_SECRET aligned with the gateway.
 */
import { expect, test } from '@playwright/test';

import { setupGatewayTenantSession } from './fixtures/fake-session';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

test.describe('Communication — client validation (ungated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('/communication/campaigns/new rejects empty name client-side', async ({ page }) => {
    await page.goto('/communication/campaigns/new', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('communication-campaign-form')).toHaveAttribute(
      'data-hydrated',
      'true',
    );
    await page.getByRole('button', { name: /create campaign/i }).click();
    await expect(page.getByText(/name is required/i)).toBeVisible();
  });
});

test.describe('Communication — live campaign create (E2E_BACKEND_READY)', () => {
  test.skip(
    !BACKEND_READY,
    'Requires E2E_BACKEND_READY=1 and live gateway (JWT uses JWT_SECRET or gateway default)',
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

test.describe('Communication — live emergency dual-confirm (E2E_BACKEND_READY)', () => {
  test.skip(
    !BACKEND_READY,
    'Requires E2E_BACKEND_READY=1 and live gateway (JWT uses JWT_SECRET or gateway default)',
  );

  test('drafts an emergency blast that awaits dual confirm', async ({ page }) => {
    await setupGatewayTenantSession(page, { sub: 'officer-a' });
    await page.goto('/communication/emergency', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('emergency-blast-form')).toHaveAttribute('data-hydrated', 'true');

    const reason = `E2E emergency ${Date.now()}`;
    await page.getByLabel(/^reason/i).fill(reason);
    await page.getByLabel(/acknowledge dual confirm/i).check();
    await page.getByRole('button', { name: /draft blast/i }).click();

    await expect(page.getByText(reason)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/pending_confirm/i).first()).toBeVisible();
  });
});
