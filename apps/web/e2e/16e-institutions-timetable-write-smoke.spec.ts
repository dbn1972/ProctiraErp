/**
 * Live Sunrise timetable grid, generation, and substitutions.
 * Requires the Sunrise seed, gateway, and E2E_BACKEND_READY=1.
 */
import { expect, test } from '@playwright/test';

import { setupGatewayTenantSession } from './fixtures/fake-session';
import { runAxe } from './helpers/axe';

const BACKEND_READY = process.env.E2E_BACKEND_READY === '1';
const SUNRISE = '00000000-0000-4000-8000-00000000a501';
const MAYUR = '00000000-0000-4000-8000-00000000a551';

test.describe('Institutions timetable — Sunrise live', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1, gateway, and the Sunrise seed');

  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page, {
      sub: 'priya-sharma',
      email: 'priya.sharma@school.edu',
      displayName: 'Priya Sharma',
      tenantId: SUNRISE,
      roles: [{ roleId: 'principal', roleName: 'Principal', areaId: null }],
    });
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('week grid, list toggle, add meeting, and a 409 teacher clash', async ({ page }) => {
    await page.goto(`/institutions/${MAYUR}/timetable`, { waitUntil: 'domcontentloaded' });
    const grid = page.getByTestId('institution-timetable').filter({ visible: true });
    await expect(grid).toBeVisible();
    await expect(grid.getByRole('link', { name: 'Generate' })).toBeVisible();
    await expect(grid.getByRole('link', { name: 'Substitutions' })).toBeVisible();
    await expect(grid.getByText('9-B Maths').first()).toBeVisible();
    await expect(grid.getByText('Break').first()).toBeVisible();
    await expect(grid.getByRole('button', { name: 'Free' }).first()).toBeVisible();
    await expect(page.getByText('SCREEN STATE')).toHaveCount(0);

    await runAxe(page, { include: 'main' });

    await page.getByRole('link', { name: 'List', exact: true }).click();
    await expect(page.getByRole('table', { name: 'Meetings' })).toBeVisible();
    await expect(page.getByText('Neha Verma').first()).toBeVisible();

    await page.goto(`/institutions/${MAYUR}/timetable?view=grid&class=9-B`, {
      waitUntil: 'domcontentloaded',
    });
    await page.getByRole('button', { name: 'Free' }).first().click();
    await expect(page).toHaveURL(/day=\d+&period=/);
    const form = page.getByTestId('add-meeting-form');
    await form.getByLabel('Section').selectOption({ label: /G9B-HIN/ });
    await form.getByLabel('Staff').selectOption({ label: 'Rahul Joshi' });
    await form.getByRole('button', { name: 'Add meeting' }).click();
    await expect(page.getByText('9-B Hindi').first()).toBeVisible({ timeout: 15_000 });

    await form.getByLabel('Section').selectOption({ label: /G9B-HIN/ });
    await form.getByLabel('Staff').selectOption({ label: 'Neha Verma' });
    await form.getByLabel('Day').selectOption('Mon');
    await form.getByLabel('Period').selectOption({ label: /P1 \(07:40/ });
    await form.getByRole('button', { name: 'Add meeting' }).click();
    await expect(page.getByRole('alert')).toContainText(/Neha Verma already teaches/i);
  });

  test('generate and substitutions pages use names and pass axe', async ({ page }) => {
    await page.goto(`/institutions/${MAYUR}/timetable/generate`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Generate timetable' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run generator' })).toBeVisible();
    await expect(page.getByText('SCREEN STATE')).toHaveCount(0);
    await runAxe(page, { include: 'main' });

    await page.goto(`/institutions/${MAYUR}/timetable/substitutions`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByRole('heading', { name: 'Substitutions' })).toBeVisible();
    await expect(page.getByLabel('Substitute staff')).toBeVisible();
    await expect(page.getByText(/[0-9a-f]{8}-[0-9a-f]{4}-/i)).toHaveCount(0);
    const recent = page.getByRole('table', { name: 'Recent substitutions' });
    if (await recent.count()) {
      await expect(recent.getByText('Arun Kapoor').first()).toBeVisible();
    }
    await runAxe(page, { include: 'main' });
  });
});
