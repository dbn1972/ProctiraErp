import { expect, test, type Page } from '@playwright/test';

/**
 * Scholarships + Workflows — ungated write-validation + inventory smokes.
 * Does not claim live finance/workflow engine success without E2E_BACKEND_READY.
 */

function createFakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

async function setupTenantSession(page: Page): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const token = createFakeJwt({
    sub: 'services-e2e-user',
    email: 'admin@tenant-a.test',
    displayName: 'Services E2E Admin',
    tenantId: '00000000-0000-4000-8000-0000000000aa',
    roles: [
      { roleId: 'admin', roleName: 'SUPER_ADMIN', areaId: null },
      { roleId: 'health', roleName: 'HEALTH_OFFICER', areaId: null },
    ],
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

const SCHOLARSHIP_ROUTES = [
  { id: 'programs', path: '/scholarships', heading: /scholarship/i },
  { id: 'new-program', path: '/scholarships/programs/new', heading: /new scholarship|program/i },
  { id: 'applications', path: '/scholarships/applications', heading: /application/i },
  { id: 'disbursements', path: '/scholarships/disbursements', heading: /disbursement/i },
];

const WORKFLOW_ROUTES = [
  { id: 'definitions', path: '/workflows', heading: /workflow/i },
  { id: 'new-definition', path: '/workflows/definitions/new', heading: /new|create|definition/i },
  { id: 'instances', path: '/workflows/instances', heading: /instance/i },
  { id: 'approvals', path: '/workflows/approvals', heading: /approval/i },
];

test.describe('Services — scholarships/workflows inventory (ungated)', () => {
  for (const route of [...SCHOLARSHIP_ROUTES, ...WORKFLOW_ROUTES]) {
    test(`${route.id} (${route.path}) unauthenticated → /login`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/\/login/);
      await expect(page.locator('body')).toBeVisible();
      await expect(page.getByRole('heading').first()).toBeVisible();
    });
  }
});

test.describe('Services — scholarships/workflows write validation (ungated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupTenantSession(page);
  });

  test('/scholarships/programs/new validates required fields client-side', async ({ page }) => {
    const response = await page.goto('/scholarships/programs/new', {
      waitUntil: 'domcontentloaded',
    });
    expect(response?.status() ?? 500).toBeLessThan(400);
    await expect(page.getByTestId('scholarship-program-form')).toBeVisible();
    await expect(page.getByTestId('scholarship-program-form')).toHaveAttribute(
      'data-hydrated',
      'true',
    );

    await page.getByRole('button', { name: /create program/i }).click();
    await expect(page.getByTestId('scholarship-program-error')).toContainText(/name is required/i);
  });

  test('/workflows/definitions/new validates name/module/steps client-side', async ({ page }) => {
    const response = await page.goto('/workflows/definitions/new', {
      waitUntil: 'domcontentloaded',
    });
    expect(response?.status() ?? 500).toBeLessThan(400);
    await expect(page.getByTestId('workflow-definition-form')).toBeVisible();
    await expect(page.getByTestId('workflow-definition-form')).toHaveAttribute(
      'data-hydrated',
      'true',
    );

    await page.getByRole('button', { name: /create definition/i }).click();
    await expect(page.getByTestId('workflow-definition-error')).toContainText(
      /name, module, and at least one step/i,
    );
  });
});
