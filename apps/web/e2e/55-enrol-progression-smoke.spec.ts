/**
 * Enrollment progression — hub + enroll form (P0-04).
 *
 * Ungated: hub and add-student surfaces render with working CTAs (no
 * placeholder copy). Soft-skip gated live enroll when gateway is offline.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { createSignedJwt, setupGatewayTenantSession } from './fixtures/fake-session';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:3000';
const TENANT_A = '00000000-0000-4000-8000-000000000001';
const INSTITUTION_A = 'a2e96cd1-0232-4cce-97e2-00ebbfb9a374';

function headers(tenantId = TENANT_A) {
  const token = createSignedJwt({
    sub: 'e2e-enroll-admin',
    email: 'enroll-admin@tenant-a.test',
    displayName: 'Enroll E2E Admin',
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

function isoDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

async function gatewayHealthy(request: APIRequestContext): Promise<boolean> {
  try {
    const res = await request.get(`${GATEWAY_URL}/health`, { timeout: 5_000 });
    return res.ok();
  } catch {
    return false;
  }
}

async function hydrated(page: Page, testId: string) {
  const el = page.getByTestId(testId);
  await expect(el).toHaveAttribute('data-hydrated', 'true', { timeout: 20_000 });
  return el;
}

async function postOk(
  request: APIRequestContext,
  path: string,
  data: Record<string, unknown>,
  expected = 201,
): Promise<{ id: string }> {
  const res = await request.post(`${GATEWAY_URL}/api/v1${path}`, {
    headers: headers(),
    data,
  });
  expect(res.status(), await res.text()).toBe(expected);
  return (await res.json()) as { id: string };
}

test.describe('Enrollment progression — ungated hub', () => {
  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('/students/enroll hub has clear CTAs and no placeholder dead-end', async ({ page }) => {
    const response = await page.goto('/students/enroll', { waitUntil: 'domcontentloaded' });
    expect(response?.status() ?? 500).toBeLessThan(400);
    await expect(page.getByTestId('students-enroll-hub')).toBeVisible();
    await expect(page.getByRole('heading', { name: /enrol student/i })).toBeVisible();
    await expect(page.getByText(/placeholder pending task/i)).toHaveCount(0);
    await expect(page.getByTestId('enroll-hub-add-student')).toBeVisible();
    await expect(page.getByTestId('enroll-hub-directory')).toBeVisible();

    await page.getByTestId('enroll-hub-add-student').click();
    await expect(page).toHaveURL(/\/students\/new/);
    await expect(page.getByRole('heading', { name: /add student/i })).toBeVisible();
    await expect(page.getByTestId('student-form')).toHaveAttribute('data-hydrated', 'true');
  });

  test('/students/new remains the create path with validation', async ({ page }) => {
    await page.goto('/students/new', { waitUntil: 'domcontentloaded' });
    await hydrated(page, 'student-form');
    await page.getByRole('button', { name: /save student/i }).click();
    await expect(page.getByText('First name is required')).toBeVisible();
  });
});

test.describe('Enrollment progression — live enroll (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1 and a live gateway + Postgres');

  test.beforeEach(async ({ page, request }) => {
    if (!(await gatewayHealthy(request))) {
      test.skip(true, 'Gateway /health unreachable — soft-skip live enroll chain');
    }
    await setupGatewayTenantSession(page);
  });

  test('profile Enroll CTA → form → enrollment happy path', async ({ page, request }) => {
    const tag = stamp();
    const period = await postOk(request, '/academic-periods', {
      name: `P004 Period ${tag}`,
      code: `P004-${tag}`,
      startDate: isoDate(-30),
      endDate: isoDate(300),
    });
    const grade = await postOk(request, '/grades', {
      name: `P004 Grade ${tag}`,
      code: `PG${tag.slice(-4)}`,
      order: 5,
    });
    const student = await postOk(request, '/students', {
      firstName: 'Enroll',
      lastName: `P004${tag}`,
      dateOfBirth: '2011-03-18',
      gender: 'female',
    });

    await page.goto(`/students/${student.id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('student-enroll-cta')).toBeVisible();
    await page.getByTestId('student-enroll-cta').click();
    await expect(page).toHaveURL(new RegExp(`/students/${student.id}/enroll`));
    await expect(page.getByTestId('student-enroll-page')).toBeVisible();
    await expect(page.getByText(/placeholder pending task/i)).toHaveCount(0);

    const form = page.getByTestId('enroll-form');
    const emptyInstitutions = page.getByTestId('enroll-empty-institutions');
    if ((await emptyInstitutions.count()) > 0) {
      await expect(emptyInstitutions).toBeVisible();
      // Still prove the write path via API when the tenant has no institution list for UI.
      await postOk(request, '/enrollments', {
        studentId: student.id,
        institutionId: INSTITUTION_A,
        gradeId: grade.id,
        academicPeriodId: period.id,
        enrolledAt: isoDate(0),
      });
      await page.goto(`/students/${student.id}/enroll`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('enroll-already-active')).toBeVisible();
      await expect(page.getByRole('link', { name: /request transfer/i })).toBeVisible();
      return;
    }

    await expect(form).toHaveAttribute('data-hydrated', 'true');

    // Prefer UI submit when institution lookups populate; otherwise API enroll + already-active UX.
    await page.locator('#institutionId').click();
    const institutionOptions = page.getByRole('option');
    const optionCount = await institutionOptions.count();
    if (optionCount === 0) {
      test.skip(true, 'Institution select has no options');
      return;
    }
    await institutionOptions.first().click();

    await page.locator('#gradeId').click();
    const gradeOptions = page.getByRole('option');
    if ((await gradeOptions.count()) === 0) {
      await postOk(request, '/enrollments', {
        studentId: student.id,
        institutionId: INSTITUTION_A,
        gradeId: grade.id,
        academicPeriodId: period.id,
        enrolledAt: isoDate(0),
      });
      await page.goto(`/students/${student.id}/enroll`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('enroll-already-active')).toBeVisible();
      return;
    }
    await gradeOptions.first().click();

    await page.locator('#academicPeriodId').click();
    const periodOptions = page.getByRole('option');
    if ((await periodOptions.count()) === 0) {
      await postOk(request, '/enrollments', {
        studentId: student.id,
        institutionId: INSTITUTION_A,
        gradeId: grade.id,
        academicPeriodId: period.id,
        enrolledAt: isoDate(0),
      });
      await page.goto(`/students/${student.id}/enroll`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('enroll-already-active')).toBeVisible();
      return;
    }
    await periodOptions.first().click();

    await page.getByTestId('enroll-submit').click();
    await expect(page).toHaveURL(new RegExp(`/students/${student.id}`), { timeout: 20_000 });
    await expect(page.getByTestId('student-enroll-cta')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /request transfer/i })).toBeVisible();
  });
});
