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
    await expect(page).toHaveURL(/\/edit$/, { timeout: 20_000 });
    const institutionId = page.url().split('/institutions/')[1]?.split('/')[0] ?? '';
    expect(institutionId.length).toBeGreaterThan(10);
    await expect(page.getByRole('link', { name: 'School report' })).toHaveCount(0);
    await expect(page.getByRole('tablist', { name: 'Institution sections' })).toHaveCount(0);

    const editedName = `${name} edited`;
    const nameField = page.locator('#name');
    const profileForm = page.getByTestId('institution-profile-form');
    await expect(profileForm).toBeVisible({ timeout: 20_000 });
    // Prefer Playwright fill so RHF controlled state keeps the edit across re-renders
    // when the leave dialog is dismissed. Native setter alone can leave React stale.
    await nameField.fill(editedName);
    await expect(nameField).toHaveValue(editedName);
    // Production CI sometimes misses React/native listeners; stamp every signal
    // the leave guard reads so the unsaved prompt still fires.
    await page.evaluate((key) => {
      const root = window as unknown as {
        __proctiraInstitutionFormDirty?: Record<string, boolean>;
      };
      const bag = { ...(root.__proctiraInstitutionFormDirty ?? {}), [key]: true };
      root.__proctiraInstitutionFormDirty = bag;
      try {
        sessionStorage.setItem('proctira.institutionFormDirty', JSON.stringify(bag));
      } catch {
        /* ignore */
      }
      document.documentElement.dataset.institutionFormDirty = 'true';
      document
        .querySelector('[data-testid="institution-profile-form"]')
        ?.setAttribute('data-dirty', 'true');
    }, institutionId);
    await expect(profileForm).toHaveAttribute('data-dirty', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-institution-form-dirty', 'true');

    // Wait for client leave-guard host + Back button handlers before clicking.
    await expect(page.getByTestId('institution-leave-guard-ready')).toHaveAttribute(
      'data-ready',
      'true',
    );
    const back = page.getByTestId('institution-back-link');
    await expect(back).toHaveAttribute('data-ready', 'true');
    await expect(back).toBeEnabled();

    // In-app leave dialog (not window.confirm) — stable under production Playwright.
    await back.click();
    const leaveDialog = page.getByTestId('institution-leave-confirm');
    await expect(leaveDialog).toBeVisible({ timeout: 10_000 });
    await expect(leaveDialog.getByText(/unsaved changes/i).first()).toBeVisible();
    await page.getByTestId('institution-leave-stay').click();
    await expect(leaveDialog).toHaveCount(0);
    await expect(page).toHaveURL(/\/edit$/);
    // Stay must keep us on the edit route; the dirty signal is what Cancel uses next.

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(leaveDialog).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('institution-leave-leave').click();
    await expect(page).toHaveURL(/\/overview$/, { timeout: 20_000 });

    const editPath = `/institutions/${institutionId}/edit`;
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
