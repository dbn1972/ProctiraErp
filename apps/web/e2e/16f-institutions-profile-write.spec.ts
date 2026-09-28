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
import { expect, test, type Page } from '@playwright/test';

import { setupFakeTenantSession, setupGatewayTenantSession } from './fixtures/fake-session';

const BACKEND_READY = process.env.E2E_BACKEND_READY === '1';
const GATEWAY_SIM = process.env.E2E_ALLOW_GATEWAY_SIMULATION === '1';
const SUNRISE = '00000000-0000-4000-8000-00000000a501';
const MAYUR = '00000000-0000-4000-8000-00000000a551';

async function signIn(page: Page) {
  // Create needs institution:create. Principals only have read/update on
  // institution by design (DEFAULT_ROLES); tenant admin covers the write path
  // while keep the Sunrise tenant and Priya display for the UX review seed.
  await setupGatewayTenantSession(page, {
    sub: 'priya-sharma',
    email: 'priya.sharma@school.edu',
    displayName: 'Priya Sharma',
    tenantId: SUNRISE,
    roles: [{ roleId: 'admin', roleName: 'Administrator', areaId: null }],
  });
}

/** Radix Select: wait for hydration, open the combobox, then pick an option. */
async function chooseSelectOption(page: Page, triggerId: string, optionName: string | RegExp) {
  const trigger = page.locator(`#${triggerId}`);
  await expect(trigger).toBeVisible();
  await expect(trigger).toBeEnabled();
  // Retry open until the listbox mounts (client Select hydrates after SSR).
  await expect(async () => {
    if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
      await trigger.click();
    }
    await expect(page.getByRole('listbox')).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 15_000 });
  await page.getByRole('option', { name: optionName }).click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
}

/** Set an input value through the native setter and fire input/change so RHF sees it. */
async function fillReactInput(locator: import('@playwright/test').Locator, value: string) {
  await locator.evaluate((el, next) => {
    if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) {
      throw new Error('fillReactInput expects an input or textarea');
    }
    const proto =
      el instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    descriptor?.set?.call(el, next);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

test.describe('Institutions profile forms — Sunrise live', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1, gateway, and the Sunrise seed');

  test('create a school, keep unsaved edits, and deactivate from the edit form', async ({
    page,
  }) => {
    test.setTimeout(90_000);
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
    await expect(page.locator('#areaId')).toBeEnabled();
    await expect(page.getByTestId('institution-profile-form')).toBeVisible();

    // Classification first: SelectTrigger used to default to type=submit and
    // wipe sibling fields on open. Fill identity after the selects settle.
    await chooseSelectOption(page, 'areaId', 'Delhi East');
    await chooseSelectOption(page, 'typeId', 'Primary School');
    await chooseSelectOption(page, 'sectorId', 'Private');
    await chooseSelectOption(page, 'ownershipId', 'Private');
    await page.getByLabel('Name').fill(name);
    await page.getByLabel('UDISE code').fill(code);
    await page.getByLabel('Latitude').fill('28.6072');
    await page.getByLabel('Longitude').fill('77.2965');
    await expect(page.getByTestId('coordinate-map-preview')).toBeVisible();
    await expect(page.getByLabel('Name')).toHaveValue(name);
    await expect(page.getByLabel('UDISE code')).toHaveValue(code);

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

    const editedName = `${name} edited`;
    const nameField = page.getByLabel('Name');
    await nameField.click();
    await fillReactInput(nameField, editedName);
    await expect(nameField).toHaveValue(editedName);
    await expect(page.getByTestId('institution-profile-form')).toHaveAttribute(
      'data-dirty',
      'true',
      { timeout: 10_000 },
    );

    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toMatch(/unsaved changes/i);
      await dialog.dismiss();
    });
    await page.getByRole('link', { name: 'Back to institutions' }).click();
    await expect(page).toHaveURL(/\/edit$/);
    await expect(page.getByLabel('Name')).toHaveValue(editedName);

    page.once('dialog', async (dialog) => {
      await dialog.accept();
    });
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page).toHaveURL(/\/overview$/, { timeout: 20_000 });

    const editPath = `/institutions/${page.url().split('/institutions/')[1]?.split('/')[0]}/edit`;
    const institutionId = page.url().split('/institutions/')[1]?.split('/')[0] ?? '';
    await page.goto(editPath, { waitUntil: 'domcontentloaded' });
    const deactivate = page.getByTestId(`deactivate-form-${institutionId}`);
    const dialog = page.getByTestId(`deactivate-form-dialog-${institutionId}`);
    await expect(deactivate).toBeVisible({ timeout: 20_000 });
    await deactivate.scrollIntoViewIfNeeded();
    await expect(async () => {
      if (!(await dialog.isVisible().catch(() => false))) {
        await deactivate.click();
      }
      await expect(dialog).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await dialog.getByLabel('Reason').fill('UX findings closure');
    await dialog.getByTestId(`deactivate-form-dialog-${institutionId}-confirm`).click();
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
