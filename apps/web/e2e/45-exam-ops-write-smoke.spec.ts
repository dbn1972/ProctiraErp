/**
 * Examination ops — invigilators, seating, double entry, re-evaluation (Wave 9 / G-908).
 *
 * Ungated: the list page renders with a heading.
 * Gated (E2E_BACKEND_READY): allocate → clash rejected → double-entry variance
 * → moderator resolve → re-evaluation request → complete; tenant B isolation.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { createSignedJwt, setupGatewayTenantSession } from './fixtures/fake-session';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:3000';
const TENANT_A = '00000000-0000-4000-8000-000000000001';
const TENANT_B = '00000000-0000-4000-8000-0000000000bb';
const INSTITUTION_A = 'a2e96cd1-0232-4cce-97e2-00ebbfb9a374';
/** Run-unique room: the room clash check is tenant-wide, so leftover sessions from earlier runs must not collide. */
const ROOM = `HALL-${Date.now().toString(36).toUpperCase()}`;

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
  sub = 'e2e-admin',
) {
  const res = await request.post(`${GATEWAY_URL}/api/v1${path}`, {
    headers: headers(tenantId, sub),
    data,
  });
  expect(res.status(), `${path}: ${await res.text()}`).toBe(expected);
  return res.json();
}

interface ExamFixture {
  examId: string;
  studentId: string;
  subjectId: string;
  centerId: string;
  candidateId: string;
}

async function buildExam(request: APIRequestContext): Promise<ExamFixture> {
  const stamp = Date.now().toString(36);
  const period = await postOk(
    request,
    '/academic-periods',
    {
      name: `Exam ops AY ${stamp}`,
      code: `EO-${stamp}`,
      startDate: isoDate(-30),
      endDate: isoDate(300),
    },
    201,
  );
  const grade = await postOk(
    request,
    '/grades',
    { name: `Ops Grade ${stamp}`, code: `OG${stamp.slice(-4).toUpperCase()}`, order: 10 },
    201,
  );
  const student = await postOk(
    request,
    '/students',
    {
      firstName: 'Ops',
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
      name: `E2E Ops Exam ${stamp}`,
      code: `E2O-${stamp.toUpperCase()}`,
      academicPeriodId: period.id,
      startDate: isoDate(10),
      endDate: isoDate(12),
      subjects: [{ name: 'Mathematics', code: 'MATH', maxScore: 100 }],
      centers: [{ name: 'Main Hall', code: 'HALL', institutionId: INSTITUTION_A, capacity: 200 }],
      gradingSchemes: [
        {
          name: 'Standard',
          minScore: 0,
          maxScore: 100,
          passThreshold: 40,
          thresholds: [
            { grade: 'A', minScore: 80, maxScore: 100 },
            { grade: 'B', minScore: 40, maxScore: 79 },
            { grade: 'F', minScore: 0, maxScore: 39 },
          ],
        },
      ],
    },
    201,
  );
  const candidate = await postOk(
    request,
    `/examinations/${exam.id}/candidates`,
    {
      studentId: student.id,
      centerId: exam.centers[0].id,
      subjectIds: [exam.subjects[0].id],
    },
    201,
  );

  return {
    examId: exam.id as string,
    studentId: student.id as string,
    subjectId: exam.subjects[0].id as string,
    centerId: exam.centers[0].id as string,
    candidateId: candidate.id as string,
  };
}

async function hydrated(page: Page, testId: string) {
  const el = page.getByTestId(testId);
  await expect(el).toHaveAttribute('data-hydrated', 'true', { timeout: 20_000 });
  return el;
}

test.describe('Exam ops — pages render (ungated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('/examinations lists with a heading', async ({ page }) => {
    await page.goto('/examinations', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});

test.describe('Exam ops — live chain (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1 and a live gateway + Postgres');

  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('allocate → clash rejected → double entry variance → resolve → re-eval complete', async ({
    page,
    request,
  }) => {
    const fx = await buildExam(request);
    const staffId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
    const sessionA = await postOk(
      request,
      `/examinations/${fx.examId}/sessions`,
      {
        subjectId: fx.subjectId,
        date: isoDate(11),
        startTime: '09:00',
        endTime: '11:00',
        roomId: ROOM,
        centerId: fx.centerId,
      },
      201,
    );
    const sessionB = await postOk(
      request,
      `/examinations/${fx.examId}/sessions`,
      {
        subjectId: fx.subjectId,
        date: isoDate(11),
        startTime: '10:00',
        endTime: '12:00',
        roomId: `${ROOM}-B`,
        centerId: fx.centerId,
      },
      201,
    );

    await postOk(
      request,
      `/examinations/${fx.examId}/sessions/${sessionA.id}/invigilators`,
      { staffId },
      201,
    );
    const clash = await request.post(
      `${GATEWAY_URL}/api/v1/examinations/${fx.examId}/sessions/${sessionB.id}/invigilators`,
      { headers: headers(), data: { staffId } },
    );
    expect(clash.status(), await clash.text()).toBe(409);
    expect((await clash.json()).conflicts[0].kind).toBe('staff_overlap');

    const roomClash = await request.post(
      `${GATEWAY_URL}/api/v1/examinations/${fx.examId}/sessions`,
      {
        headers: headers(),
        data: {
          subjectId: fx.subjectId,
          date: isoDate(11),
          startTime: '09:30',
          endTime: '10:30',
          roomId: ROOM,
          centerId: fx.centerId,
        },
      },
    );
    expect(roomClash.status()).toBe(409);

    const seating = await postOk(request, `/examinations/${fx.examId}/seating/generate`, {}, 200);
    expect(seating.data).toHaveLength(1);

    await postOk(
      request,
      `/examinations/${fx.examId}/marks/entries`,
      { candidateId: fx.candidateId, subjectId: fx.subjectId, entryNo: 1, marks: 70 },
      201,
      TENANT_A,
      'e2e-admin',
    );
    const second = await postOk(
      request,
      `/examinations/${fx.examId}/marks/entries`,
      {
        candidateId: fx.candidateId,
        subjectId: fx.subjectId,
        entryNo: 2,
        marks: 80,
        tolerance: 2,
      },
      201,
      TENANT_A,
      'e2e-marker-2',
    );
    expect(second.varianceFlag).toBe(true);

    const resolved = await postOk(
      request,
      `/examinations/${fx.examId}/marks/resolve`,
      { candidateId: fx.candidateId, subjectId: fx.subjectId, finalMarks: 75 },
      200,
    );
    expect(resolved.finalMarks).toBe(75);

    const reeval = await postOk(
      request,
      `/examinations/${fx.examId}/reevaluations`,
      { candidateId: fx.candidateId, subjectId: fx.subjectId, originalMarks: 75 },
      201,
    );
    await postOk(
      request,
      `/examinations/${fx.examId}/reevaluations/${reeval.id}/assign`,
      { evaluatorId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2' },
      200,
    );
    const completed = await postOk(
      request,
      `/examinations/${fx.examId}/reevaluations/${reeval.id}/complete`,
      { revisedMarks: 78, notes: 'Totalling error' },
      200,
    );
    expect(completed.status).toBe('completed');
    expect(completed.revisedMarks).toBe(78);

    await page.goto(`/examinations/${fx.examId}/ops`, { waitUntil: 'domcontentloaded' });
    await hydrated(page, 'exam-ops-panel');
    await expect(page.getByTestId('variance-badge')).toBeVisible();
    await expect(page.getByText('completed').first()).toBeVisible();
    await expect(page.getByTestId('exam-seat-row')).toBeVisible();
  });

  test('cross-tenant: tenant B cannot read tenant A exam ops', async ({ request }) => {
    const fx = await buildExam(request);
    for (const path of [
      `/examinations/${fx.examId}`,
      `/examinations/${fx.examId}/sessions`,
      `/examinations/${fx.examId}/seating`,
      `/examinations/${fx.examId}/marks/entries`,
      `/examinations/${fx.examId}/reevaluations`,
    ]) {
      const res = await request.get(`${GATEWAY_URL}/api/v1${path}`, { headers: headers(TENANT_B) });
      expect([403, 404], `${path} → ${res.status()}`).toContain(res.status());
    }
  });
});
