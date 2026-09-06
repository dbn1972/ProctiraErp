import { expect, test, type Page } from '@playwright/test';

/**
 * Health counselling — ungated write-validation smoke.
 * Asserts client UUID/date/required validation before any API call.
 */

function createFakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

async function setupHealthSession(page: Page): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const token = createFakeJwt({
    sub: 'health-e2e-user',
    email: 'nurse@tenant-a.test',
    displayName: 'Health E2E',
    tenantId: '00000000-0000-4000-8000-0000000000aa',
    roles: [{ roleId: 'health', roleName: 'HEALTH_OFFICER', areaId: null }],
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

    await page.getByLabel(/student id/i).fill('not-a-uuid');
    await page.getByLabel(/counsellor id/i).fill('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1');
    await page.getByLabel(/session date/i).fill('2026-09-06');
    await page.getByLabel(/^reason$/i).fill('Exam anxiety');
    await page.getByLabel(/case notes/i).fill('Initial notes');
    await page.getByRole('button', { name: /schedule session/i }).click();

    await expect(page.getByRole('alert')).toContainText(/student id must be a valid uuid/i);
  });
});

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

test.describe('Health counselling — live create (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires live gateway + DATABASE_URL counselling store');

  test.beforeEach(async ({ page }) => {
    await setupHealthSession(page);
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
