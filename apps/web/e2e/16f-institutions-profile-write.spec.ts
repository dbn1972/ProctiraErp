/**
 * Institution create, edit, and gateway-down states.
 *
 * Live writes need Postgres seeded with db/seeds/006_sunrise_public_school_demo.sql,
 * the gateway, and E2E_BACKEND_READY=1. Principal: Priya Sharma.
 *
 * Gateway-down renders the error state when the web server is started with
 * E2E_ALLOW_GATEWAY_SIMULATION=1 and the browser sends cookie e2e-gateway-down=1.
 * That cookie is ignored unless the env flag is set.
 *
 * Routes for G-804:
 * /institutions/new
 * /institutions/${id}/edit
 * /institutions/${id}/overview
 */
import { expect, test } from '@playwright/test';

import { setupFakeTenantSession, setupGatewayTenantSession } from './fixtures/fake-session';

const BACKEND_READY = process.env.E2E_BACKEND_READY === '1';
const GATEWAY_SIM = process.env.E2E_ALLOW_GATEWAY_SIMULATION === '1';
const SUNRISE = '00000000-0000-4000-8000-00000000a501';
const MAYUR = '00000000-0000-4000-8000-00000000a551';

async function signIn(page: import('@playwright/test').Page) {
  await setupGatewayTenantSession(page, {
    sub: 'priya-sharma',
    email: 'priya.sharma@school.edu',
    displayName: 'Priya Sharma',
    tenantId: SUNRISE,
    roles: [{ roleId: 'principal', roleName: 'Principal', areaId: null }],
  });
}

test.describe('Institutions profile forms — Sunrise live', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1, gateway, and the Sunrise seed');

  test('create a school, keep unsaved edits, and deactivate from the edit form', async ({
    page,
  }) => {
    await signIn(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    const stamp = Date.now().toString().slice(-8);
    const name = `UX School ${stamp}`;
    const code = `UX${stamp}`;

    await page.goto('/institutions/new', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Register institution' })).toBeVisible();
    await expect(page.getByText(/once approved/i)).toHaveCount(0);
    await expect(page.getByText(/created active/i)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Identity' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Classification' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Location and contact' })).toBeVisible();

    await page.getByLabel('Name').fill(name);
    await page.getByLabel('UDISE code').fill(code);
    await page.getByLabel('Area').click();
    await page.getByRole('option', { name: 'Delhi East' }).click();
    await page.getByLabel('Type').click();
    await page.getByRole('option', { name: 'Primary School' }).click();
    await page.getByLabel('Sector').click();
    await page.getByRole('option', { name: 'Private' }).click();
    await page.getByLabel('Ownership').click();
    await page.getByRole('option', { name: 'Private' }).click();
    await page.getByLabel('Latitude').fill('28.6072');
    await page.getByLabel('Longitude').fill('77.2965');
    await expect(page.getByTestId('coordinate-map-preview')).toBeVisible();

    await page.getByRole('button', { name: 'Create institution' }).click();
    await expect(page).toHaveURL(/\/institutions\/[^/]+\/overview$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name })).toBeVisible();

    await page.goto(`/institutions?search=${encodeURIComponent(code)}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByRole('cell', { name: new RegExp(name) }).first()).toBeVisible();

    await page.getByRole('link', { name: `Edit ${name}` }).click();
    await expect(page).toHaveURL(/\/edit$/);
    await expect(page.getByRole('link', { name: 'School report' })).toHaveCount(0);
    await expect(page.getByRole('tablist', { name: 'Institution sections' })).toHaveCount(0);

    await page.getByLabel('Name').fill(`${name} edited`);
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toMatch(/unsaved changes/i);
      await dialog.dismiss();
    });
    await page.getByRole('link', { name: 'Back to institutions' }).click();
    await expect(page).toHaveURL(/\/edit$/);
    await expect(page.getByLabel('Name')).toHaveValue(`${name} edited`);

    page.once('dialog', async (dialog) => {
      await dialog.accept();
    });
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page).toHaveURL(/\/overview$/, { timeout: 20_000 });

    const editPath = `/institutions/${page.url().split('/institutions/')[1]?.split('/')[0]}/edit`;
    await page.goto(editPath, { waitUntil: 'domcontentloaded' });
    const deactivate = page.getByRole('button', { name: 'Deactivate school' });
    await expect(deactivate).toBeVisible();
    await deactivate.click();
    const dialog = page.getByTestId(/deactivate-form-dialog-/);
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Reason').fill('UX findings closure');
    await dialog.getByRole('button', { name: 'Deactivate' }).click();
    await expect(page.getByText('This school is inactive.')).toBeVisible({ timeout: 20_000 });
  });
});

test.describe('Institution gateway down', () => {
  test.skip(
    !GATEWAY_SIM,
    'Requires the web server to be started with E2E_ALLOW_GATEWAY_SIMULATION=1',
  );

  test('gateway down shows an error state instead of a green Active pill', async ({ page }) => {
    await setupFakeTenantSession(page, {
      sub: 'priya-sharma',
      email: 'priya.sharma@school.edu',
      displayName: 'Priya Sharma',
      tenantId: SUNRISE,
      roles: [{ roleId: 'principal', roleName: 'Principal', areaId: null }],
    });
    const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001';
    await page.context().addCookies([{ name: 'e2e-gateway-down', value: '1', url: baseUrl }]);
    const institutionEditRoute = `/institutions/${MAYUR}/edit`;
    await page.goto(institutionEditRoute, { waitUntil: 'domcontentloaded' });
    const down = page.getByTestId('institution-gateway-down');
    await expect(down).toBeVisible();
    await expect(down.getByRole('heading', { name: 'School unavailable' })).toBeVisible();
    await expect(down.getByRole('alert')).toBeVisible();
    await expect(page.getByText('Active', { exact: true })).toHaveCount(0);
  });
});
