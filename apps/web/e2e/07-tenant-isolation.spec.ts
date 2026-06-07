import { expect, test } from '@playwright/test';

import { loginAsTenantAdmin, loginAsTenantBUser, logout } from './fixtures/auth';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

test.describe('Critical journey: tenant isolation', () => {
  test.skip(
    !BACKEND_READY,
    'E2E_BACKEND_READY is not set; skipping live-backend e2e test. See e2e/README.md.',
  );

  test('Tenant B cannot see Tenant A students', async ({ page }) => {
    // 1. Capture a student name from Tenant A
    await loginAsTenantAdmin(page);
    await page.goto('/students');

    const tenantAStudentLink = page.getByRole('link', { name: /^[A-Z][\w\s.'-]+$/ }).first();
    await expect(tenantAStudentLink).toBeVisible({ timeout: 15_000 });
    const tenantAStudentName = (await tenantAStudentLink.innerText()).trim();
    expect(tenantAStudentName.length).toBeGreaterThan(0);

    // 2. Sign out, then login as Tenant B
    await logout(page);

    // Clear any stale tenant cookies before logging into Tenant B
    await page.context().clearCookies();

    await loginAsTenantBUser(page);

    // 3. Tenant B's students list does NOT contain the Tenant A student
    await page.goto('/students');
    await expect(page.getByRole('heading', { name: /students/i })).toBeVisible();

    // Search by the tenant A student name to be thorough
    const searchBox = page.getByPlaceholder(/search/i).first();
    if (await searchBox.isVisible().catch(() => false)) {
      await searchBox.fill(tenantAStudentName);
    }

    await expect(page.getByText(tenantAStudentName, { exact: true })).toHaveCount(0);
  });
});
