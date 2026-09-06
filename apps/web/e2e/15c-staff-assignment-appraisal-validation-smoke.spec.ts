import { expect, test, type Page } from '@playwright/test';

/**
 * Staff assignment / appraisal write-path — ungated client validation smoke.
 * Soft-renders forms when staff/API data is unavailable (fake JWT, no backend).
 * Does not claim a successful assignment/appraisal create against a live API.
 */

const STAFF_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';

function createFakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

async function setupTenantSession(page: Page): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const token = createFakeJwt({
    sub: 'staff-e2e-user',
    email: 'admin@tenant-a.test',
    displayName: 'Staff E2E Admin',
    tenantId: '00000000-0000-4000-8000-0000000000aa',
    roles: [{ roleId: 'admin', roleName: 'Administrator', areaId: null }],
    iat: now,
    exp: now + 60 * 60 * 8,
  });

  await page.context().addCookies([
    {
      name: 'access_token',
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
    {
      name: 'refresh_token',
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
}

test.describe('Staff assignment / appraisal validation — ungated', () => {
  test.beforeEach(async ({ page }) => {
    await setupTenantSession(page);
  });

  test('/staff/[id]/assignments/new validates required fields before submit', async ({
    page,
  }) => {
    const response = await page.goto(`/staff/${STAFF_ID}/assignments/new`, {
      waitUntil: 'domcontentloaded',
    });
    expect(response?.status() ?? 500).toBeLessThan(400);
    await expect(page.getByRole('heading', { name: /new teaching assignment/i })).toBeVisible();
    await expect(page.getByTestId('staff-assignment-form')).toHaveAttribute(
      'data-hydrated',
      'true',
    );

    // Clear role so client zod runs; UUID selects stay empty.
    await page.locator('#role').fill('');
    await page.getByRole('button', { name: /create assignment/i }).click();

    await expect(page.getByText('Role is required')).toBeVisible();
    await expect(page.getByText('Must be a valid UUID').first()).toBeVisible();
  });

  test('/staff/[id]/appraisals/new validates required fields before submit', async ({
    page,
  }) => {
    const response = await page.goto(`/staff/${STAFF_ID}/appraisals/new`, {
      waitUntil: 'domcontentloaded',
    });
    expect(response?.status() ?? 500).toBeLessThan(400);
    await expect(page.getByRole('heading', { name: /new appraisal/i })).toBeVisible();
    await expect(page.getByTestId('staff-appraisal-form')).toHaveAttribute(
      'data-hydrated',
      'true',
    );

    await page.locator('#appraisalDate').fill('');
    await page.getByRole('button', { name: /save appraisal/i }).click();

    await expect(page.getByText('Date is required')).toBeVisible();
    await expect(page.getByText('Must be a valid UUID').first()).toBeVisible();
    await expect(page.getByText('At least one score is required')).toBeVisible();
  });
});
