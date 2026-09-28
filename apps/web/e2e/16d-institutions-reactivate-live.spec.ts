/**
 * Live Sunrise reactivate. Requires Postgres seeded with
 * db/seeds/006_sunrise_public_school_demo.sql, the gateway, and
 * E2E_BACKEND_READY=1. A throwaway school is inserted and deleted here so
 * the seeded Inactive "Sunrise Pre-Primary – Vasundhara Enclave" row is unchanged.
 */
import { execFileSync } from 'node:child_process';

import { expect, test } from '@playwright/test';

import { setupGatewayTenantSession } from './fixtures/fake-session';

const BACKEND_READY = process.env.E2E_BACKEND_READY === '1';
const SUNRISE = '00000000-0000-4000-8000-00000000a501';
const AREA_EAST = '00000000-0000-4000-8000-00000000a511';
const THROWAWAY_ID = '00000000-0000-4000-8000-00000000a5e2';

function psql(sql: string): void {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for the throwaway school');
  }
  execFileSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-c', sql], { stdio: 'pipe' });
}

function withTenant(body: string): string {
  return `
BEGIN;
DO $$ BEGIN
  PERFORM set_config('app.platform_admin', '1', true);
  PERFORM set_app_tenant_id('${SUNRISE}');
END $$;
${body}
COMMIT;
`;
}

function insertThrowawaySchool(): void {
  psql(
    withTenant(`
INSERT INTO institutions (
  id, tenant_id, name, code, board_id, area_id, type, sector, ownership, status
) VALUES (
  '${THROWAWAY_ID}',
  '${SUNRISE}',
  'Throwaway Reactivate Wing',
  'SPS-REACT-99',
  '00000000-0000-4000-8000-00000000a521',
  '${AREA_EAST}',
  'school',
  'private',
  'private',
  'active'
) ON CONFLICT (id) DO UPDATE SET
  status = 'active',
  name = 'Throwaway Reactivate Wing',
  deleted_at = NULL;
`),
  );
}

function deleteThrowawaySchool(): void {
  psql(
    withTenant(`
DELETE FROM institutions
 WHERE tenant_id = '${SUNRISE}'
   AND id = '${THROWAWAY_ID}';
`),
  );
}

test.describe('Institutions reactivate — Sunrise live', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1, gateway, and the Sunrise seed');

  test.beforeAll(() => {
    insertThrowawaySchool();
  });

  test.afterAll(() => {
    deleteThrowawaySchool();
  });

  test('deactivates a throwaway school, reactivates it from the keyboard, then reactivates again from the detail header', async ({ page }) => {
    test.setTimeout(120_000);
    await setupGatewayTenantSession(page, {
      sub: 'priya-sharma',
      email: 'priya.sharma@school.edu',
      displayName: 'Priya Sharma',
      tenantId: SUNRISE,
      roles: [{ roleId: 'principal', roleName: 'Principal', areaId: null }],
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/institutions', { waitUntil: 'domcontentloaded' });

    const directoryTable = page.getByRole('table', { name: 'Institutions' });
    const schoolsKpi = page
      .getByText('Schools', { exact: true })
      .locator('xpath=ancestor::div[contains(@class,"rounded")][1]')
      .filter({ visible: true })
      .locator('p')
      .first();
    const schoolsBefore = await schoolsKpi.innerText();

    const more = page.getByTestId(`institution-more-${THROWAWAY_ID}`).filter({ visible: true });
    const deactivateItem = page.getByRole('menuitem', { name: 'Deactivate school' });
    // ArrowDown opens the Radix menu only after hydration. Retry until it does.
    await expect(async () => {
      await more.focus();
      await more.press('ArrowDown');
      await expect(deactivateItem).toBeVisible();
    }).toPass();
    await deactivateItem.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId(`deactivate-${THROWAWAY_ID}`)).toBeVisible();
    await page.getByLabel('Reason').fill('Screen review throwaway');
    await page.getByTestId(`deactivate-${THROWAWAY_ID}-confirm`).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId(`deactivate-${THROWAWAY_ID}`)).toBeHidden({ timeout: 30_000 });

    const throwawayRow = directoryTable.getByRole('row', { name: /Throwaway Reactivate Wing/ });
    await expect(throwawayRow).toContainText('Inactive');

    const reactivateItem = page.getByRole('menuitem', { name: 'Reactivate' });
    await expect(async () => {
      await more.focus();
      await more.press('ArrowDown');
      await expect(reactivateItem).toBeVisible();
    }).toPass();
    await reactivateItem.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByTestId(`reactivate-${THROWAWAY_ID}`);
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Reason').fill('Screen review restored');
    await page.getByTestId(`reactivate-${THROWAWAY_ID}-confirm`).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId(`reactivate-${THROWAWAY_ID}`)).toBeHidden({ timeout: 30_000 });

    await expect(throwawayRow).toContainText('Active');
    await expect(page.getByTestId('institution-status-toast')).toContainText('active again');
    await expect(schoolsKpi).toHaveText(schoolsBefore);

    // Second cycle: deactivate from the list, then click Reactivate on the detail header.
    await expect(async () => {
      await more.focus();
      await more.press('ArrowDown');
      await expect(deactivateItem).toBeVisible();
    }).toPass();
    await deactivateItem.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId(`deactivate-${THROWAWAY_ID}`)).toBeVisible();
    await page.getByLabel('Reason').fill('Header review throwaway');
    await page.getByTestId(`deactivate-${THROWAWAY_ID}-confirm`).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId(`deactivate-${THROWAWAY_ID}`)).toBeHidden({ timeout: 30_000 });
    await expect(throwawayRow).toContainText('Inactive');

    await page.goto(`/institutions/${THROWAWAY_ID}/overview`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Throwaway Reactivate Wing' })).toBeVisible();
    await expect(page.getByText('Inactive', { exact: true }).first()).toBeVisible();
    const headerReactivate = page.getByTestId(`reactivate-header-${THROWAWAY_ID}`);
    const headerDialog = page.getByTestId(`reactivate-header-dialog-${THROWAWAY_ID}`);
    // The header button is in the first paint; its click handler attaches after hydration.
    await expect(async () => {
      await headerReactivate.click({ timeout: 2_000 });
      await expect(headerDialog).toBeVisible({ timeout: 1_500 });
    }).toPass({ timeout: 20_000 });
    await headerDialog.getByLabel('Reason').fill('Header review restored');
    await page.getByTestId(`reactivate-header-dialog-${THROWAWAY_ID}-confirm`).click();
    await expect(headerDialog).toBeHidden({ timeout: 30_000 });

    await expect(page.getByText('Active', { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId('institution-status-toast')).toContainText('active again');
    await expect(headerReactivate).toHaveCount(0);
  });
});
