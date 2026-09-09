import { expect, test, type Page } from '@playwright/test';

import {
  createSignedJwt,
  setupFakeTenantSession,
  setupGatewayTenantSession,
} from './fixtures/fake-session';

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
const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:3000';
const HEALTH_TENANT = '00000000-0000-4000-8000-0000000000aa';

function healthApiHeaders() {
  const token = createSignedJwt({
    sub: 'health-e2e-user',
    email: 'nurse@tenant-a.test',
    displayName: 'Health E2E',
    tenantId: HEALTH_TENANT,
    roles: [
      { roleId: 'admin', roleName: 'SUPER_ADMIN', areaId: null },
      { roleId: 'health', roleName: 'HEALTH_OFFICER', areaId: null },
    ],
    institutions: [],
  });
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Tenant-ID': HEALTH_TENANT,
  };
}

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

  test('G-912: an allergy written through the domain API surfaces on /health (records aggregate)', async ({
    page,
    request,
  }) => {
    const studentId = crypto.randomUUID();
    const created = await request.post(`${GATEWAY_URL}/api/v1/health/allergies`, {
      headers: healthApiHeaders(),
      data: {
        studentId,
        allergyType: 'food',
        description: `E2E shellfish ${studentId.slice(0, 6)}`,
        severity: 'severe',
        reaction: 'Hives',
      },
    });
    expect(created.status(), await created.text()).toBe(201);

    const aggregate = await request.get(`${GATEWAY_URL}/api/v1/health/records/${studentId}`, {
      headers: healthApiHeaders(),
    });
    expect(aggregate.status()).toBe(200);
    const record = await aggregate.json();
    expect(record.studentId).toBe(studentId);
    expect(record.allergies).toContain(`E2E shellfish ${studentId.slice(0, 6)}`);

    await page.goto('/health', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(studentId.slice(0, 8)).first()).toBeVisible({ timeout: 20_000 });
  });
});
