/**
 * LMS depth — question bank, essay rubric grade, class analytics (Wave 9 / G-915).
 *
 * Ungated: hub, bank, rubrics, discussions, lessons, content and analytics pages render.
 * Gated (E2E_BACKEND_READY): bank → quiz from bank → essay rubric grade → item difficulty;
 * discussion post; tenant B isolation.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { createSignedJwt, setupGatewayTenantSession } from './fixtures/fake-session';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:3000';
const TENANT_A = '00000000-0000-4000-8000-000000000001';
const TENANT_B = '00000000-0000-4000-8000-0000000000bb';
const INSTITUTION_A = 'a2e96cd1-0232-4cce-97e2-00ebbfb9a374';

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

async function hydrated(page: Page, testId: string) {
  const el = page.getByTestId(testId);
  await expect(el).toHaveAttribute('data-hydrated', 'true', { timeout: 20_000 });
  return el;
}

test.describe('LMS depth — pages render (ungated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('/lms lists with a heading', async ({ page }) => {
    await page.goto('/lms', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('/lms/bank lists with a heading', async ({ page }) => {
    await page.goto('/lms/bank', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('/lms/rubrics lists with a heading', async ({ page }) => {
    await page.goto('/lms/rubrics', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('/lms/discussions lists with a heading', async ({ page }) => {
    await page.goto('/lms/discussions', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('/lms/lessons lists with a heading', async ({ page }) => {
    await page.goto('/lms/lessons', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('/lms/content lists with a heading', async ({ page }) => {
    await page.goto('/lms/content', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('/lms/analytics lists with a heading', async ({ page }) => {
    await page.goto('/lms/analytics', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});

test.describe('LMS depth — live chain (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1 and a live gateway + Postgres');

  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('bank → quiz → essay rubric grade → analytics', async ({ page, request }) => {
    const studentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
    const rubric = await postOk(
      request,
      '/lms/rubrics',
      {
        scope: 'school',
        institutionId: INSTITUTION_A,
        name: 'Essay rubric',
        criteria: [
          {
            name: 'Argument',
            maxPoints: 4,
            levels: [
              { label: 'Weak', points: 1 },
              { label: 'Strong', points: 4 },
            ],
          },
        ],
      },
      201,
    );
    const mcq = await postOk(
      request,
      '/lms/bank',
      {
        scope: 'school',
        institutionId: INSTITUTION_A,
        subject: 'Maths',
        tags: ['fractions'],
        questionType: 'mcq',
        prompt: '1/2 + 1/2',
        payload: { options: ['1', '2'], correctOptionIndex: 0 },
        points: 1,
      },
      201,
    );
    const essay = await postOk(
      request,
      '/lms/bank',
      {
        scope: 'school',
        institutionId: INSTITUTION_A,
        subject: 'Maths',
        tags: ['fractions'],
        questionType: 'essay',
        prompt: 'Explain equivalent fractions',
        payload: { rubricId: rubric.id },
        points: 4,
        rubricId: rubric.id,
      },
      201,
    );
    const quiz = await postOk(
      request,
      '/lms/assignments',
      {
        scope: 'school',
        institutionId: INSTITUTION_A,
        kind: 'quiz',
        title: 'G-915 quiz',
        subject: 'Maths',
        gradeLevel: '7A',
        publish: true,
        bankQuestionIds: [mcq.id, essay.id],
      },
      201,
    );
    const submission = await postOk(
      request,
      `/lms/assignments/${quiz.id}/submissions`,
      {
        studentId,
        institutionId: INSTITUTION_A,
        answers: [
          { questionId: quiz.questions[0].id, selectedOptionIndex: 0 },
          { questionId: quiz.questions[1].id, essayText: 'Same amount, different names.' },
        ],
      },
      201,
      TENANT_A,
      studentId,
    );
    expect(submission.status).toBe('submitted');

    const graded = await postOk(
      request,
      `/lms/submissions/${submission.id}/rubric-grade`,
      {
        questionId: quiz.questions[1].id,
        scores: [
          {
            criterionId: rubric.criteria[0].id,
            questionId: quiz.questions[1].id,
            levelIndex: 1,
            points: 4,
          },
        ],
      },
      200,
    );
    expect(graded.status).toBe('graded');

    const quizAnalyticsRes = await request.get(
      `${GATEWAY_URL}/api/v1/lms/assignments/${quiz.id}/analytics`,
      { headers: headers() },
    );
    expect(quizAnalyticsRes.status(), await quizAnalyticsRes.text()).toBe(200);
    const quizAnalytics = (await quizAnalyticsRes.json()) as {
      items: Array<{ difficulty: number | null }>;
    };
    expect(quizAnalytics.items.length).toBeGreaterThan(0);
    expect(quizAnalytics.items[0]?.difficulty).toBe(1);

    const analytics = await request.get(
      `${GATEWAY_URL}/api/v1/lms/analytics?classKey=7A&institutionId=${INSTITUTION_A}`,
      { headers: headers() },
    );
    expect(analytics.status(), await analytics.text()).toBe(200);
    const body = (await analytics.json()) as { assignmentCount: number; submissionCount: number };
    expect(body.assignmentCount).toBeGreaterThan(0);
    expect(body.submissionCount).toBeGreaterThan(0);

    await page.goto('/lms/analytics?classKey=7A', { waitUntil: 'domcontentloaded' });
    await hydrated(page, 'lms-analytics-panel');
    await expect(page.getByTestId('lms-analytics-panel')).toBeVisible();
    await expect(page.getByTestId('lms-item-difficulty').first()).toBeVisible();
  });

  test('teacher can open a class discussion and post', async ({ request }) => {
    const thread = await postOk(
      request,
      '/lms/discussions',
      { classKey: '7A', title: 'G-915 thread', institutionId: INSTITUTION_A },
      201,
    );
    const post = await postOk(
      request,
      `/lms/discussions/${thread.id}/posts`,
      { body: 'Welcome to fractions.' },
      201,
    );
    expect(post.id).toBeTruthy();
  });

  test('cross-tenant: tenant B cannot read tenant A bank items', async ({ request }) => {
    const created = await postOk(
      request,
      '/lms/bank',
      {
        scope: 'school',
        institutionId: INSTITUTION_A,
        subject: 'Maths',
        questionType: 'numeric',
        prompt: 'Isolation probe',
        payload: { correctValue: 1, tolerance: 0 },
      },
      201,
    );
    const res = await request.get(`${GATEWAY_URL}/api/v1/lms/bank/${created.id}`, {
      headers: headers(TENANT_B),
    });
    expect([403, 404], `bank → ${res.status()}`).toContain(res.status());
  });
});
