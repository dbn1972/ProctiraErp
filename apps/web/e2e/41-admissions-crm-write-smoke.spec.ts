/**
 * Admissions CRM — enquiry → application → merit → offer → accept → enrol
 * (Wave 9 / G-906).
 *
 * Ungated: CRM pages render and an unknown application id shows not-found
 * (no crash).
 * Gated (E2E_BACKEND_READY): live API chain with TENANT_A / INSTITUTION_A,
 * UI enrolled badge, and tenant B isolation.
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

async function jsonStatus(
  res: { status: () => number; text: () => Promise<string>; json: () => Promise<unknown> },
  expected: number,
): Promise<unknown> {
  expect(res.status(), await res.text()).toBe(expected);
  return res.json();
}

async function createPeriodAndGrade(request: APIRequestContext): Promise<{
  periodId: string;
  gradeId: string;
  periodName: string;
  gradeName: string;
}> {
  const tag = stamp();
  const periodRes = await request.post(`${GATEWAY_URL}/api/v1/academic-periods`, {
    headers: headers(),
    data: {
      name: `E2E Adm Year ${tag}`,
      code: `AY-ADM-${tag}`,
      startDate: '2038-04-01',
      endDate: '2039-03-31',
      status: 'inactive',
    },
  });
  const period = (await jsonStatus(periodRes, 201)) as { id: string; name: string };

  const gradeCode = `AG${tag}`;
  const gradeRes = await request.post(`${GATEWAY_URL}/api/v1/grades`, {
    headers: headers(),
    data: { name: `Grade ${gradeCode}`, code: gradeCode, order: 4 },
  });
  const grade = (await jsonStatus(gradeRes, 201)) as { id: string; name: string };

  return {
    periodId: period.id,
    gradeId: grade.id,
    periodName: period.name,
    gradeName: grade.name,
  };
}

test.describe('Admissions CRM — pages render (ungated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('/admissions/enquiries renders the new enquiry action', async ({ page }) => {
    await page.goto('/admissions/enquiries', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('new-enquiry')).toBeVisible();
  });

  test('/admissions/seat-matrix renders the save control', async ({ page }) => {
    await page.goto('/admissions/seat-matrix', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('save-seat')).toBeVisible();
  });

  test('/admissions/merit renders the generate control', async ({ page }) => {
    await page.goto('/admissions/merit', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('generate-merit')).toBeVisible();
  });

  test('/admissions/[id] shows not-found for an unknown application', async ({ page }) => {
    await page.goto('/admissions/00000000-0000-4000-8000-00000000dead', {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByRole('heading', { name: /page not found/i })).toBeVisible();
    await expect(page.getByTestId('enrolled-badge')).toHaveCount(0);
  });
});

test.describe('Admissions CRM — live chain (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1 and a live gateway + Postgres');

  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('enquiry → application → merit → offer → accept enrols the student', async ({
    page,
    request,
  }) => {
    const { periodId, gradeId } = await createPeriodAndGrade(request);
    const tag = stamp();
    const firstName = `Ada${tag}`;
    const lastName = 'Lovelace';

    const enquiryRes = await request.post(`${GATEWAY_URL}/api/v1/admissions/enquiries`, {
      headers: headers(),
      data: {
        institutionId: INSTITUTION_A,
        academicPeriodId: periodId,
        gradeId,
        quota: 'general',
        source: 'website',
        firstName,
        lastName,
        dateOfBirth: '2012-06-15',
        gender: 'female',
        guardianName: 'Annabella Byron',
        guardianPhone: '+15550001',
        interviewScore: 88,
        testScore: 92,
      },
    });
    const enquiry = (await jsonStatus(enquiryRes, 201)) as { id: string };

    const followRes = await request.post(
      `${GATEWAY_URL}/api/v1/admissions/enquiries/${enquiry.id}/follow-ups`,
      {
        headers: headers(),
        data: {
          dueAt: '2038-05-01T10:00:00.000Z',
          ownerId: 'e2e-admin',
          notes: 'Call guardian',
        },
      },
    );
    expect(followRes.status(), await followRes.text()).toBe(201);

    const stageRes = await request.patch(
      `${GATEWAY_URL}/api/v1/admissions/enquiries/${enquiry.id}`,
      { headers: headers(), data: { stage: 'qualified' } },
    );
    expect(stageRes.status(), await stageRes.text()).toBe(200);

    const convertRes = await request.post(
      `${GATEWAY_URL}/api/v1/admissions/enquiries/${enquiry.id}/convert`,
      { headers: headers() },
    );
    const converted = (await jsonStatus(convertRes, 201)) as {
      application: { id: string; trackingNumber: string };
    };
    const applicationId = converted.application.id;

    const seatRes = await request.put(`${GATEWAY_URL}/api/v1/admissions/seat-matrix`, {
      headers: headers(),
      data: {
        institutionId: INSTITUTION_A,
        academicPeriodId: periodId,
        gradeId,
        quota: 'general',
        seats: 5,
      },
    });
    const seat = (await jsonStatus(seatRes, 200)) as { available: number };
    expect(seat.available).toBeGreaterThan(0);

    const meritRes = await request.post(`${GATEWAY_URL}/api/v1/admissions/merit-lists`, {
      headers: headers(),
      data: {
        institutionId: INSTITUTION_A,
        academicPeriodId: periodId,
        gradeId,
        interviewWeight: 0.4,
        testWeight: 0.6,
      },
    });
    const merit = (await jsonStatus(meritRes, 201)) as {
      entries: Array<{ applicationId: string; rank: number }>;
    };
    expect(merit.entries.some((row) => row.applicationId === applicationId)).toBe(true);

    const offerRes = await request.post(`${GATEWAY_URL}/api/v1/admissions/offers`, {
      headers: headers(),
      data: { applicationId, feeAmount: 25000 },
    });
    const offer = (await jsonStatus(offerRes, 201)) as { id: string; status: string };
    expect(offer.status).toBe('draft');

    const sendRes = await request.post(`${GATEWAY_URL}/api/v1/admissions/offers/${offer.id}/send`, {
      headers: headers(),
    });
    expect((await jsonStatus(sendRes, 200)) as { status: string }).toMatchObject({
      status: 'sent',
    });

    const acceptRes = await request.post(
      `${GATEWAY_URL}/api/v1/admissions/offers/${offer.id}/accept`,
      { headers: headers(), data: { paymentRef: 'SANDBOX-PAY' } },
    );
    const accepted = (await jsonStatus(acceptRes, 200)) as {
      status: string;
      paymentRef: string;
      enrolledStudentId: string | null;
    };
    expect(accepted.status).toBe('accepted');
    expect(accepted.paymentRef).toBe('SANDBOX-PAY');
    expect(accepted.enrolledStudentId).toBeTruthy();

    const again = await request.post(`${GATEWAY_URL}/api/v1/admissions/offers/${offer.id}/accept`, {
      headers: headers(),
      data: { paymentRef: 'SANDBOX-PAY' },
    });
    const idempotent = (await jsonStatus(again, 200)) as { enrolledStudentId: string | null };
    expect(idempotent.enrolledStudentId).toBe(accepted.enrolledStudentId);

    const studentRes = await request.get(
      `${GATEWAY_URL}/api/v1/students/${accepted.enrolledStudentId}`,
      { headers: headers() },
    );
    const student = (await jsonStatus(studentRes, 200)) as {
      id: string;
      firstName: string;
      lastName: string;
    };
    expect(student).toMatchObject({ firstName, lastName });

    await page.goto(`/admissions/${applicationId}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('enrolled-badge')).toBeVisible();
    await expect(page.getByTestId('enrolled-student-link')).toHaveAttribute(
      'href',
      `/students/${accepted.enrolledStudentId}`,
    );
  });

  test('CRM pages hydrate and persist an enquiry plus a seat row', async ({ page, request }) => {
    const { periodId, gradeId } = await createPeriodAndGrade(request);
    const tag = stamp();

    await page.goto('/admissions/enquiries', { waitUntil: 'domcontentloaded' });
    await hydrated(page, 'enquiry-form');
    await page.getByTestId('enquiry-institution').selectOption(INSTITUTION_A);
    await page.getByTestId('enquiry-period').selectOption(periodId);
    await page.getByTestId('enquiry-grade').selectOption(gradeId);
    await page.getByTestId('enquiry-source').selectOption('walk_in');
    await page.getByTestId('enquiry-first-name').fill(`Lee${tag}`);
    await page.getByTestId('enquiry-last-name').fill('Yuan');
    await page.getByTestId('enquiry-dob').fill('2013-03-21');
    await page.getByTestId('enquiry-guardian').fill('Pat Yuan');
    await page.getByTestId('enquiry-phone').fill('+15550002');
    await page.getByTestId('enquiry-interview-score').fill('70');
    await page.getByTestId('enquiry-test-score').fill('75');
    await page.getByTestId('new-enquiry').click();
    await expect(page.getByTestId('enquiry-row').filter({ hasText: `Lee${tag}` })).toBeVisible({
      timeout: 20_000,
    });

    await page.goto('/admissions/seat-matrix', { waitUntil: 'domcontentloaded' });
    await hydrated(page, 'seat-matrix-form');
    await page.getByTestId('seat-institution').selectOption(INSTITUTION_A);
    await page.getByTestId('seat-period').selectOption(periodId);
    await page.getByTestId('seat-grade').selectOption(gradeId);
    await page.getByTestId('seat-count').fill('12');
    await page.getByTestId('save-seat').click();
    // Earlier runs leave seat rows behind; assert the row saved by this run (12 seats).
    await expect(
      page
        .getByTestId('seat-row')
        .filter({ has: page.getByRole('cell', { name: '12', exact: true }) })
        .first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test('cross-tenant: tenant B cannot read tenant A admissions records', async ({ request }) => {
    const { periodId, gradeId } = await createPeriodAndGrade(request);
    const created = await request.post(`${GATEWAY_URL}/api/v1/admissions/enquiries`, {
      headers: headers(),
      data: {
        institutionId: INSTITUTION_A,
        academicPeriodId: periodId,
        gradeId,
        firstName: 'Secret',
        lastName: 'Lead',
        dateOfBirth: '2011-01-01',
        guardianName: 'Hidden Guardian',
        guardianPhone: '+15550999',
        interviewScore: 50,
        testScore: 50,
      },
    });
    const enquiry = (await jsonStatus(created, 201)) as { id: string };
    const converted = await request.post(
      `${GATEWAY_URL}/api/v1/admissions/enquiries/${enquiry.id}/convert`,
      { headers: headers() },
    );
    const applicationId = ((await jsonStatus(converted, 201)) as { application: { id: string } })
      .application.id;

    const foreignList = await request.get(`${GATEWAY_URL}/api/v1/admissions/enquiries`, {
      headers: headers(TENANT_B),
    });
    expect(foreignList.status()).toBe(200);
    const listed = (await foreignList.json()) as { data: Array<{ id: string }> };
    expect(listed.data.some((row) => row.id === enquiry.id)).toBe(false);

    const foreignApp = await request.get(
      `${GATEWAY_URL}/api/v1/admissions/applications/${applicationId}`,
      { headers: headers(TENANT_B) },
    );
    expect(foreignApp.status()).toBe(404);

    const foreignFollow = await request.post(
      `${GATEWAY_URL}/api/v1/admissions/enquiries/${enquiry.id}/follow-ups`,
      {
        headers: headers(TENANT_B),
        data: { dueAt: '2038-06-01T00:00:00.000Z', notes: 'Nope' },
      },
    );
    expect([403, 404]).toContain(foreignFollow.status());
  });
});
