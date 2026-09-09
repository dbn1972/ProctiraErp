/**
 * Curriculum coverage — lesson plan → mark taught → coverage % (Wave 9 / G-923).
 *
 * Ungated: institution curriculum page renders.
 * Gated (E2E_BACKEND_READY): live API unit + lesson plan + mark-taught + coverage,
 * UI hydrates mark-taught, tenant B cannot see tenant A units.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { createSignedJwt, setupGatewayTenantSession } from './fixtures/fake-session';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:3000';
const TENANT_A = '00000000-0000-4000-8000-000000000001';
const TENANT_B = '00000000-0000-4000-8000-0000000000bb';
/** Seeded by tools/e2e/seed-e2e-tenants.sql. */
const INSTITUTION_A = 'a2e96cd1-0232-4cce-97e2-00ebbfb9a374';

function headers(tenantId = TENANT_A) {
  const token = createSignedJwt({
    sub: 'e2e-admin',
    email: 'admin@tenant-a.test',
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

async function hydrated(page: Page, testId: string) {
  const el = page.getByTestId(testId);
  await expect(el).toHaveAttribute('data-hydrated', 'true', { timeout: 20_000 });
  return el;
}

async function createSubject(request: APIRequestContext) {
  const code = `CUR-${stamp()}`;
  const res = await request.post(`${GATEWAY_URL}/api/v1/subjects`, {
    headers: headers(),
    data: { name: `Curriculum ${code}`, code },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { id: string; name: string; code: string };
}

async function createGrade(request: APIRequestContext) {
  const code = `G${stamp()}`;
  const res = await request.post(`${GATEWAY_URL}/api/v1/grades`, {
    headers: headers(),
    data: { name: `Grade ${code}`, code, order: 6 },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { id: string };
}

async function createYear(request: APIRequestContext) {
  const code = `AY-C-${stamp()}`;
  const res = await request.post(`${GATEWAY_URL}/api/v1/academic-periods`, {
    headers: headers(),
    data: {
      name: `E2E Year ${code}`,
      code,
      startDate: '2038-04-01',
      endDate: '2039-03-31',
      status: 'inactive',
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { id: string };
}

test.describe('Curriculum — pages render (ungated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('/institutions/[id]/curriculum renders the Curriculum heading', async ({ page }) => {
    await page.goto(`/institutions/${INSTITUTION_A}/curriculum`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Curriculum' })).toBeVisible();
    await expect(page.getByTestId('curriculum-panel')).toBeVisible();
  });
});

test.describe('Curriculum — live chain (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1 and a live gateway + Postgres');

  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('lesson plan → mark taught → coverage %', async ({ page, request }) => {
    const subject = await createSubject(request);
    const grade = await createGrade(request);
    const year = await createYear(request);
    const unitCode = `U-${stamp()}`;

    const created = await request.post(`${GATEWAY_URL}/api/v1/curriculum/units`, {
      headers: headers(),
      data: {
        institutionId: INSTITUTION_A,
        subjectId: subject.id,
        gradeId: grade.id,
        academicPeriodId: year.id,
        code: unitCode,
        name: 'Number systems',
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const unit = (await created.json()) as { id: string };

    const plan = await request.post(
      `${GATEWAY_URL}/api/v1/curriculum/units/${unit.id}/lesson-plans`,
      { headers: headers(), data: { title: 'Counting', plannedDate: '2038-06-02' } },
    );
    expect(plan.status(), await plan.text()).toBe(201);

    const before = await request.get(
      `${GATEWAY_URL}/api/v1/curriculum/coverage?subjectId=${subject.id}&gradeId=${grade.id}&academicPeriodId=${year.id}&institutionId=${INSTITUTION_A}`,
      { headers: headers() },
    );
    expect(before.status()).toBe(200);
    expect(await before.json()).toMatchObject({ planned: 1, taught: 0, percent: 0 });

    await page.goto(
      `/institutions/${INSTITUTION_A}/curriculum?subjectId=${subject.id}&gradeId=${grade.id}&academicPeriodId=${year.id}`,
      { waitUntil: 'domcontentloaded' },
    );
    await hydrated(page, 'curriculum-panel');
    const row = page.locator(`[data-testid="syllabus-unit-row"][data-unit-code="${unitCode}"]`);
    await expect(row).toBeVisible();
    await page.getByTestId(`mark-taught-${unit.id}`).click();
    await expect(row).toHaveAttribute('data-taught', 'true', { timeout: 15_000 });
    await expect(page.getByTestId('coverage-percent')).toContainText('100%');

    const after = await request.get(
      `${GATEWAY_URL}/api/v1/curriculum/coverage?subjectId=${subject.id}&gradeId=${grade.id}&academicPeriodId=${year.id}&institutionId=${INSTITUTION_A}`,
      { headers: headers() },
    );
    expect(after.status()).toBe(200);
    expect(await after.json()).toMatchObject({ planned: 1, taught: 1, percent: 100 });
  });

  test('cross-tenant: tenant B cannot list tenant A units', async ({ request }) => {
    const subject = await createSubject(request);
    const grade = await createGrade(request);
    const year = await createYear(request);
    const created = await request.post(`${GATEWAY_URL}/api/v1/curriculum/units`, {
      headers: headers(),
      data: {
        institutionId: INSTITUTION_A,
        subjectId: subject.id,
        gradeId: grade.id,
        academicPeriodId: year.id,
        code: `XB-${stamp()}`,
        name: 'Hidden unit',
      },
    });
    expect(created.status(), await created.text()).toBe(201);

    const foreign = await request.get(
      `${GATEWAY_URL}/api/v1/curriculum/units?institutionId=${INSTITUTION_A}&subjectId=${subject.id}`,
      { headers: headers(TENANT_B) },
    );
    expect(foreign.status()).toBe(200);
    expect((await foreign.json()).data).toEqual([]);
  });
});
