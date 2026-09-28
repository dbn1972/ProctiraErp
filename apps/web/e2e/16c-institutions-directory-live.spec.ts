/**
 * Live Sunrise directory. Requires Postgres seeded with
 * db/seeds/006_sunrise_public_school_demo.sql, the gateway, and
 * E2E_BACKEND_READY=1. The seed has one school, five enrolments, three
 * staff assignments, and no student_attendance rows.
 */
import { execFileSync } from 'node:child_process';

import { expect, test } from '@playwright/test';

import { setupGatewayTenantSession } from './fixtures/fake-session';

const BACKEND_READY = process.env.E2E_BACKEND_READY === '1';
const SUNRISE = '00000000-0000-4000-8000-00000000a501';
const AREA_PUNE = '00000000-0000-4000-8000-00000000a511';
const THROWAWAY_ID = '00000000-0000-4000-8000-00000000a5e1';

function insertThrowawaySchool(): void {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to insert the throwaway school');
  }
  const sql = `
BEGIN;
DO $$ BEGIN
  PERFORM set_config('app.platform_admin', '1', true);
  PERFORM set_app_tenant_id('${SUNRISE}');
END $$;
DELETE FROM institutions
 WHERE tenant_id = '${SUNRISE}'
   AND code LIKE 'SPS-PG-%';
INSERT INTO institutions (
  id, tenant_id, name, code, board_id, area_id, type, sector, ownership, status
) VALUES (
  '${THROWAWAY_ID}',
  '${SUNRISE}',
  'Throwaway Wing',
  'SPS-TMP-99',
  '00000000-0000-4000-8000-00000000a521',
  '${AREA_PUNE}',
  'school',
  'private',
  'private',
  'active'
) ON CONFLICT (id) DO UPDATE SET status = 'active', name = 'Throwaway Wing';
COMMIT;
`;
  execFileSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-c', sql], { stdio: 'pipe' });
}

test.describe('Institutions directory — Sunrise live', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1, gateway, and the Sunrise seed');

  test.beforeAll(() => {
    insertThrowawaySchool();
  });

  test('filters, KPIs, and keyboard deactivate use seeded rows', async ({ page }) => {
    await setupGatewayTenantSession(page, {
      sub: 'priya-sharma',
      email: 'priya.sharma@school.edu',
      displayName: 'Priya Sharma',
      tenantId: SUNRISE,
      roles: [{ roleId: 'principal', roleName: 'Principal', areaId: null }],
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/institutions', { waitUntil: 'domcontentloaded' });

    const heading = page.getByRole('heading', { name: 'Institutions', exact: true });
    await expect(heading).toBeVisible();
    await expect(page.getByText('SCREEN STATE')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /UX review/i })).toHaveCount(0);

    await expect(page.getByText('SPS-PUN-01')).toBeVisible();
    await expect(page.getByText('2 schools · profiles, classes, and infrastructure')).toBeVisible();
    await expect(page.getByText('Showing 1–2 of 2')).toBeVisible();
    await expect(page.getByText('Page 1 of 1')).toBeVisible();

    const studentsKpi = page.getByText('Students enrolled').locator('xpath=ancestor::div[contains(@class,"rounded")][1]');
    await expect(studentsKpi).toContainText('5');
    const reportingKpi = page.getByText('Reporting today').locator('xpath=ancestor::div[contains(@class,"rounded")][1]');
    await expect(reportingKpi).toContainText('0');

    const sunriseRow = page.getByRole('row', { name: /Sunrise Public School/ });
    await expect(sunriseRow).toContainText('5');
    await expect(sunriseRow).toContainText('3');
    await expect(sunriseRow).toContainText('Pune');
    await expect(sunriseRow).toContainText('School');
    await expect(sunriseRow.getByText('—').first()).toBeVisible();

    const switcher = page.getByTestId('tenant-switcher').filter({ visible: true });
    await expect(switcher).toContainText('CBSE');
    await expect(switcher).not.toContainText('Board:');

    await page.getByRole('searchbox', { name: 'Search' }).fill('zzzz-no-match');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page).toHaveURL(/search=zzzz-no-match/);
    await expect(page.getByTestId('institutions-empty').filter({ visible: true })).toBeVisible();

    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(page).not.toHaveURL(/search=/);
    await expect(page.getByText('SPS-PUN-01')).toBeVisible();

    await page.locator('#filter-area').click();
    await page.getByRole('option', { name: 'Pune' }).click();
    await expect(page).toHaveURL(new RegExp(`areaId=${AREA_PUNE}`));
    await expect(page.getByText('SPS-PUN-01')).toBeVisible();

    await page.locator('#filter-status').click();
    await page.getByRole('option', { name: 'Inactive' }).click();
    await expect(page).toHaveURL(/status=INACTIVE/);
    await expect(page.getByTestId('institutions-empty').filter({ visible: true })).toBeVisible();

    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(page).not.toHaveURL(/status=/);
    await expect(page).not.toHaveURL(/areaId=/);

    const more = page.getByTestId(`institution-more-${THROWAWAY_ID}`).filter({ visible: true });
    await more.focus();
    await page.keyboard.press('ArrowDown');
    const deactivateItem = page.getByRole('menuitem', { name: 'Deactivate school' });
    await expect(deactivateItem).toBeVisible();
    await deactivateItem.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByTestId(`deactivate-${THROWAWAY_ID}`);
    await expect(dialog).toBeVisible();
    await page.getByLabel('Reason').fill('Screen review throwaway');
    await page.getByTestId(`deactivate-${THROWAWAY_ID}-confirm`).focus();
    await page.keyboard.press('Enter');
    const throwawayRow = page.getByRole('row', { name: /Throwaway Wing/ });
    await expect(throwawayRow).toContainText('Inactive');
    await expect(page.getByText('SPS-PUN-01')).toBeVisible();
  });

  test('page 2 renders when more than one page of schools exists', async ({ page }) => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is required');
    const values = Array.from({ length: 19 }, (_, index) => {
      const n = String(index + 1).padStart(2, '0');
      const id = `00000000-0000-4000-8000-00000000a6${n}`;
      return `('${id}', '${SUNRISE}', 'Page School ${n}', 'SPS-PG-${n}', '00000000-0000-4000-8000-00000000a521', '${AREA_PUNE}', 'school', 'private', 'private', 'active')`;
    }).join(',\n');
    const sql = `
BEGIN;
DO $$ BEGIN
  PERFORM set_config('app.platform_admin', '1', true);
  PERFORM set_app_tenant_id('${SUNRISE}');
END $$;
INSERT INTO institutions (
  id, tenant_id, name, code, board_id, area_id, type, sector, ownership, status
) VALUES
${values}
ON CONFLICT (id) DO NOTHING;
COMMIT;
`;
    execFileSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-c', sql], { stdio: 'pipe' });

    await setupGatewayTenantSession(page, {
      sub: 'priya-sharma',
      email: 'priya.sharma@school.edu',
      displayName: 'Priya Sharma',
      tenantId: SUNRISE,
      roles: [{ roleId: 'principal', roleName: 'Principal', areaId: null }],
    });
    await page.goto('/institutions?page=2', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Page 2 of 2')).toBeVisible();
    await expect(page.getByText('Showing 21–21 of 21')).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(1);
  });
});
