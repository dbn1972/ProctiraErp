import { expect, test, type Page } from '@playwright/test';

import { setupFakeTenantSession, setupGatewayTenantSession } from './fixtures/fake-session';

/**
 * Health counselling — ungated write-validation smoke.
 * Asserts client UUID/date/required validation before any API call.
 *
 * Live create (E2E_BACKEND_READY) uses HS256 cookies so api-gateway jwtVerify
 * accepts writes without seeded password login / IdP secrets (G-401).
 */

async function setupHealthSession(page: Page): Promise<void> {
  await setupFakeTenantSession(page, {
    sub: 'health-e2e-user',
    email: 'nurse@tenant-a.test',
    displayName: 'Health E2E',
    tenantId: '00000000-0000-4000-8000-0000000000aa',
    roles: [
      { roleId: 'admin', roleName: 'SUPER_ADMIN', areaId: null },
      { roleId: 'health', roleName: 'HEALTH_OFFICER', areaId: null },
    ],
  });
}

async function setupHealthLiveSession(page: Page): Promise<void> {
  await setupGatewayTenantSession(page, {
    sub: 'health-e2e-user',
    email: 'nurse@tenant-a.test',
    displayName: 'Health E2E',
    tenantId: '00000000-0000-4000-8000-0000000000aa',
    roles: [
      { roleId: 'admin', roleName: 'SUPER_ADMIN', areaId: null },
      { roleId: 'health', roleName: 'HEALTH_OFFICER', areaId: null },
    ],
  });
}

test.describe('Health counselling — write validation (ungated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupHealthSession(page);
  });

  test('/health/counselling/new rejects invalid student UUID', async ({ page }) => {
    const response = await page.goto('/health/counselling/new', {
      waitUntil: 'domcontentloaded',
    });
    expect(response?.status() ?? 500).toBeLessThan(400);
    await expect(
      page.getByRole('heading', { name: /schedule counselling session/i }),
    ).toBeVisible();
    await expect(page.getByTestId('counselling-session-form')).toHaveAttribute(
      'data-hydrated',
      'true',
    );

    await page.getByLabel(/student id/i).fill('not-a-uuid');
    await page.getByLabel(/counsellor id/i).fill('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1');
    await page.getByLabel(/session date/i).fill('2026-09-06');
    await page.getByLabel(/^reason$/i).fill('Exam anxiety');
    await page.getByLabel(/case notes/i).fill('Initial notes');
    await page.getByRole('button', { name: /schedule session/i }).click();

    await expect(page.getByTestId('counselling-session-error')).toContainText(
      /student id must be a valid uuid/i,
    );
  });
});

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

test.describe('Health counselling — live create (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires live gateway + DATABASE_URL counselling store');

  test.beforeEach(async ({ page }) => {
    await setupHealthLiveSession(page);
  });

  test('schedules a counselling session via live API', async ({ page }) => {
    await page.goto('/health/counselling/new', { waitUntil: 'domcontentloaded' });
    await page.getByLabel(/student id/i).fill('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
    await page.getByLabel(/counsellor id/i).fill('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1');
    await page.getByLabel(/session date/i).fill('2026-09-06');
    await page.getByLabel(/^reason$/i).fill('Live E2E counselling create');
    await page.getByLabel(/case notes/i).fill('Created by enterprise live smoke.');
    await page.getByRole('button', { name: /schedule session/i }).click();

    await expect(page).toHaveURL(/\/health\/counselling/, { timeout: 20_000 });
    await expect(page.getByRole('heading').first()).toBeVisible();
  });
});
