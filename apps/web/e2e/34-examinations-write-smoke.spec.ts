/**
 * Examinations operations — register candidate → marks → publish → documents
 * (Wave 9 / G-902).
 *
 * Before G-902 the Candidates / Results / Documents tabs read from routes that
 * did not exist (`GET /examinations/:id/candidates`, `/results/marks`,
 * `/documents/jobs`) and the action buttons were inert.
 *
 * Ungated: the list page renders with a heading.
 * Gated (E2E_BACKEND_READY): the full live chain through the gateway, with
 * the tabs reflecting the rows, download streaming a PDF, and cross-tenant
 * isolation on the exam.
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

function isoDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
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

interface ExamFixture {
  examId: string;
  studentId: string;
  subjectIds: string[];
  centerId: string;
}

/** period → grade → student → enrollment → examination (SCHEDULED). */
async function buildExam(request: APIRequestContext): Promise<ExamFixture> {
  const stamp = Date.now().toString(36);
  const period = await postOk(
    request,
    '/academic-periods',
    {
      name: `Exam AY ${stamp}`,
      code: `EX-${stamp}`,
      startDate: isoDate(-30),
      endDate: isoDate(300),
    },
    201,
  );
  const grade = await postOk(
    request,
    '/grades',
    { name: `Exam Grade ${stamp}`, code: `EG${stamp.slice(-4).toUpperCase()}`, order: 10 },
    201,
  );
  const student = await postOk(
    request,
    '/students',
    {
      firstName: 'Exam',
      lastName: `Candidate ${stamp}`,
      dateOfBirth: '2010-05-05',
      gender: 'female',
    },
    201,
  );
  await postOk(
    request,
    '/enrollments',
    {
      studentId: student.id,
      institutionId: INSTITUTION_A,
      gradeId: grade.id,
      academicPeriodId: period.id,
      enrolledAt: isoDate(-10),
    },
    201,
  );

  const exam = await postOk(
    request,
    '/examinations',
    {
      name: `E2E Exam ${stamp}`,
      code: `E2E-${stamp.toUpperCase()}`,
      academicPeriodId: period.id,
      startDate: isoDate(10),
      endDate: isoDate(12),
      subjects: [
        { name: 'Mathematics', code: 'MATH', maxScore: 100 },
        { name: 'Science', code: 'SCI', maxScore: 100 },
      ],
      centers: [{ name: 'Main Hall', code: 'HALL', institutionId: INSTITUTION_A, capacity: 200 }],
      gradingSchemes: [
        {
          name: 'Standard',
          minScore: 0,
          maxScore: 100,
          passThreshold: 40,
          thresholds: [
            { grade: 'A', minScore: 80, maxScore: 100 },
            { grade: 'B', minScore: 60, maxScore: 79 },
            { grade: 'C', minScore: 40, maxScore: 59 },
            { grade: 'F', minScore: 0, maxScore: 39 },
          ],
        },
      ],
    },
    201,
  );
  const scheduled = await request.put(`${GATEWAY_URL}/api/v1/examinations/${exam.id}`, {
    headers: headers(),
    data: { status: 'SCHEDULED' },
  });
  expect(scheduled.status(), await scheduled.text()).toBe(200);

  return {
    examId: exam.id as string,
    studentId: student.id as string,
    subjectIds: (exam.subjects as Array<{ id: string }>).map((s) => s.id),
    centerId: (exam.centers as Array<{ id: string }>)[0]!.id,
  };
}

async function hydrated(page: Page, testId: string) {
  const el = page.getByTestId(testId);
  await expect(el).toHaveAttribute('data-hydrated', 'true', { timeout: 20_000 });
  return el;
}

test.describe('Examinations ops — tabs render (ungated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('/examinations lists with a heading', async ({ page }) => {
    await page.goto('/examinations', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});

test.describe('Examinations ops — live chain (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1 and a live gateway + Postgres');

  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('register → marks → publish → certificate, reflected on the tabs', async ({
    page,
    request,
  }) => {
    const fx = await buildExam(request);

    // Candidates tab: empty, then the registration row.
    await page.goto(`/examinations/${fx.examId}/candidates`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('register-candidate')).toBeVisible();
    await expect(page.getByText(/no candidates registered yet/i)).toBeVisible();

    await postOk(
      request,
      `/examinations/${fx.examId}/candidates`,
      { studentId: fx.studentId, centerId: fx.centerId, subjectIds: fx.subjectIds },
      201,
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText(fx.studentId)).toBeVisible();
    await expect(page.getByText(/registered/i).first()).toBeVisible();

    // Admit cards while SCHEDULED (candidates resolved from registrations).
    const admit = await postOk(
      request,
      `/examinations/${fx.examId}/documents/generate`,
      { documentType: 'admit_card' },
      202,
    );
    expect(admit.totalCandidates).toBe(1);

    // Marks entry (pre-publication) shows pending rows on the Results tab.
    await postOk(
      request,
      `/examinations/${fx.examId}/results/marks`,
      {
        entries: [
          {
            studentId: fx.studentId,
            marks: [
              { subjectId: fx.subjectIds[0], score: 85 },
              { subjectId: fx.subjectIds[1], score: 55 },
            ],
          },
        ],
      },
      200,
    );
    await page.goto(`/examinations/${fx.examId}/results`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('publish-results')).toBeVisible();
    await expect(page.getByText(fx.studentId)).toBeVisible();
    await expect(page.getByText('PENDING').first()).toBeVisible();

    // Publish (IN_PROGRESS → publish) from the UI and verify grades render.
    const moved = await request.put(`${GATEWAY_URL}/api/v1/examinations/${fx.examId}`, {
      headers: headers(),
      data: { status: 'IN_PROGRESS' },
    });
    expect(moved.status(), await moved.text()).toBe(200);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await (await hydrated(page, 'publish-results')).click();
    await expect(page.getByText('PUBLISHED').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('A', { exact: true }).first()).toBeVisible();

    // Marks are locked after publication.
    const locked = await request.post(
      `${GATEWAY_URL}/api/v1/examinations/${fx.examId}/results/marks`,
      {
        headers: headers(),
        data: {
          entries: [
            { studentId: fx.studentId, marks: [{ subjectId: fx.subjectIds[0], score: 1 }] },
          ],
        },
      },
    );
    expect(locked.status()).toBe(422);

    // Documents tab: admit-card job listed; generate certificates from the UI
    // and download the PDF through the web proxy.
    await page.goto(`/examinations/${fx.examId}/documents`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/admit cards/i).first()).toBeVisible();
    await (await hydrated(page, 'generate-result_certificate')).click();
    await expect(page.getByText(/result certificates/i).first()).toBeVisible({ timeout: 15_000 });

    const jobs = await request.get(
      `${GATEWAY_URL}/api/v1/examinations/${fx.examId}/documents/jobs`,
      {
        headers: headers(),
      },
    );
    expect(jobs.status()).toBe(200);
    const jobList = (await jobs.json()).jobs as Array<{ id: string; status: string }>;
    expect(jobList).toHaveLength(2);
    const completed = jobList.find((j) => j.status === 'completed');
    expect(completed).toBeTruthy();

    const pdf = await page.request.get(
      `/api/examinations/${fx.examId}/documents/${completed!.id}/download`,
    );
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toContain('application/pdf');
    expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF');
  });

  test('cross-tenant: tenant B cannot read tenant A examination, candidates or jobs', async ({
    request,
  }) => {
    const fx = await buildExam(request);
    for (const path of [
      `/examinations/${fx.examId}`,
      `/examinations/${fx.examId}/candidates`,
      `/examinations/${fx.examId}/documents/jobs`,
    ]) {
      const res = await request.get(`${GATEWAY_URL}/api/v1${path}`, { headers: headers(TENANT_B) });
      expect([403, 404], `${path} → ${res.status()}`).toContain(res.status());
    }
  });
});
