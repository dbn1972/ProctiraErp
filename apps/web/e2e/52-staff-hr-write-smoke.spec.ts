/**
 * Staff / HR — contracts, attendance, import, payroll (Wave 9 / G-918).
 *
 * Ungated: staff list and attendance pages render with a heading.
 * Gated (E2E_BACKEND_READY): import → contract → attendance → payroll export;
 * tenant B isolation.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { createSignedJwt, setupGatewayTenantSession } from './fixtures/fake-session';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:3000';
const TENANT_A = '00000000-0000-4000-8000-000000000001';
const TENANT_B = '00000000-0000-4000-8000-0000000000bb';

function headers(tenantId = TENANT_A, sub = 'e2e-admin') {
  const token = createSignedJwt({
    sub,
    email: `${sub}@tenant-a.test`,
    displayName: 'E2E Admin',
    tenantId,
    roles: [{ roleId: 'admin', roleName: 'SUPER_ADMIN', areaId: null }],
    institutions: [],
  });
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Tenant-ID': tenantId,
  };
}

function stamp() {
  return Date.now().toString(36).slice(-6).toUpperCase();
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthIso(): string {
  return todayIso().slice(0, 7);
}

async function postOk(
  request: APIRequestContext,
  path: string,
  data: unknown,
  expected: number,
  tenantId = TENANT_A,
) {
  const res = await request.post(`${GATEWAY_URL}/api/v1${path}`, {
    headers: headers(tenantId),
    data,
  });
  expect(res.status(), `${path}: ${await res.text()}`).toBe(expected);
  return res.json();
}

async function hydrated(page: Page, testId: string) {
  const el = page.getByTestId(testId);
  await expect(el).toHaveAttribute('data-hydrated', 'true', { timeout: 20_000 });
  return el;
}

test.describe('Staff HR — pages render (ungated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('/staff lists with a heading', async ({ page }) => {
    await page.goto('/staff', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('/staff/attendance renders the mark grid', async ({ page }) => {
    await page.goto('/staff/attendance', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await hydrated(page, 'staff-attendance-grid');
  });

  test('/staff/import renders the bulk import heading', async ({ page }) => {
    await page.goto('/staff/import', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: /bulk staff import/i })).toBeVisible();
  });
});

test.describe('Staff HR — live chain (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1 and a live gateway + Postgres');

  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('import → contract → attendance → payroll export', async ({ page, request }) => {
    const tag = stamp();
    const identity = `EMP-${tag}`;
    const csv = [
      'firstName,lastName,dateOfBirth,identityNumber,contactPhone,position,contractType,startDate,endDate,salaryBand',
      `Grace,Hopper,1906-12-09,${identity},+1555000${tag.slice(0, 3)},Teacher,permanent,2026-01-01,2027-12-31,L5`,
    ].join('\n');

    const dry = await postOk(request, '/staff/import/dry-run', { csv }, 200);
    expect(dry.valid).toBe(1);

    const committed = await postOk(request, '/staff/import/commit', { csv }, 200);
    expect(committed.created).toBe(1);
    const staffId = committed.staffIds[0] as string;

    const contract = await postOk(
      request,
      '/staff/contracts',
      {
        staffId,
        contractType: 'permanent',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        salaryBand: 'L5',
      },
      201,
    );
    expect(contract.salaryBand).toBe('L5');

    const attendance = await postOk(
      request,
      '/staff/attendance',
      { staffId, date: todayIso(), status: 'present' },
      201,
    );
    expect(attendance.status).toBe('present');

    const payroll = await request.get(
      `${GATEWAY_URL}/api/v1/staff/payroll/export?month=${monthIso()}`,
      { headers: headers() },
    );
    expect(payroll.status(), await payroll.text()).toBe(200);
    const body = await payroll.json();
    expect(body.csv).toMatch(/staffId,name,salaryBand/);
    const row = body.rows.find((r: { staffId: string }) => r.staffId === staffId);
    expect(row.daysPresent).toBeGreaterThanOrEqual(1);
    expect(row.deductionsPlaceholder).toBe(0);

    await page.goto('/staff/payroll', { waitUntil: 'domcontentloaded' });
    await hydrated(page, 'staff-payroll-panel');
    await expect(page.getByTestId('staff-payroll-row').first()).toBeVisible();
  });

  test('cross-tenant: tenant B cannot read tenant A contracts', async ({ request }) => {
    const staff = await postOk(
      request,
      '/staff',
      {
        firstName: 'Iso',
        lastName: `Late${stamp()}`,
        dateOfBirth: '1980-01-01',
        identityNumber: `ISO-${stamp()}`,
        contactPhone: '+1555999',
        position: 'Teacher',
      },
      201,
    );
    const contract = await postOk(
      request,
      '/staff/contracts',
      {
        staffId: staff.id,
        contractType: 'intern',
        startDate: '2026-09-01',
        salaryBand: 'L1',
      },
      201,
    );
    const res = await request.get(`${GATEWAY_URL}/api/v1/staff/contracts/${contract.id}`, {
      headers: headers(TENANT_B),
    });
    expect([403, 404], `contracts/${contract.id} → ${res.status()}`).toContain(res.status());
  });
});
