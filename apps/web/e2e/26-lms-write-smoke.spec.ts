/**
 * LMS — assignments · homework · quizzes · Spiral PAL (Wave 8 / G-803, G-804, G-805).
 *
 * Ungated: client-side validation on the assignment builder and PAL lookup.
 * Gated (E2E_BACKEND_READY): live quiz authoring → publish → learner submit →
 * auto-grade → mastery plan, plus cross-tenant and cross-school isolation.
 * Uses HS256 cookies (`setupGatewayTenantSession`) — production auth is not relaxed.
 */
import { expect, test, type APIRequestContext } from '@playwright/test';

import { createSignedJwt, setupGatewayTenantSession } from './fixtures/fake-session';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:3000';
const TENANT_A = '00000000-0000-4000-8000-000000000001';
const TENANT_B = '00000000-0000-4000-8000-0000000000bb';
/** Seeded by tools/e2e/seed-e2e-tenants.sql. */
const INSTITUTION_A = 'a2e96cd1-0232-4cce-97e2-00ebbfb9a374';
const OTHER_SCHOOL = 'b3f07de2-1343-4ddf-a8f3-11fccfc0b485';
const STUDENT_ID = 'c4018ef3-2454-4ee0-b904-22add0d1c596';

type Role = 'admin' | 'teacher' | 'student';

function headers(sub: string, role: Role, tenantId = TENANT_A, institutions: string[] = []) {
  const token = createSignedJwt({
    sub,
    email: `${sub}@tenant.test`,
    displayName: sub,
    tenantId,
    roles: [{ roleId: role, roleName: role, areaId: null }],
    institutions,
  });
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Tenant-ID': tenantId,
  };
}

async function createQuiz(request: APIRequestContext, title: string) {
  const res = await request.post(`${GATEWAY_URL}/api/v1/lms/assignments`, {
    headers: headers('e2e-teacher', 'teacher', TENANT_A, [INSTITUTION_A]),
    data: {
      scope: 'school',
      institutionId: INSTITUTION_A,
      kind: 'quiz',
      title,
      subject: 'Mathematics',
      gradeLevel: '7',
      maxScore: 2,
      publish: true,
      questions: [
        {
          prompt: '1/2 + 1/4 = ?',
          options: ['3/4', '2/6', '1/8'],
          correctOptionIndex: 0,
          points: 1,
        },
        { prompt: '3/4 − 1/4 = ?', options: ['1/2', '2/8', '1'], correctOptionIndex: 0, points: 1 },
      ],
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { id: string; status: string; questions: Array<{ id: string }> };
}

test.describe('LMS — client validation (ungated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('/lms/assignments/new rejects an empty form client-side', async ({ page }) => {
    await page.goto('/lms/assignments/new', { waitUntil: 'domcontentloaded' });
    const form = page.getByTestId('lms-assignment-form');
    await expect(form).toHaveAttribute('data-hydrated', 'true');
    await page.getByRole('button', { name: /save draft/i }).click();
    await expect(page.getByText(/this field is required/i).first()).toBeVisible();
  });

  test('quiz kind reveals the question builder and enforces two options', async ({ page }) => {
    await page.goto('/lms/assignments/new?kind=quiz', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('lms-assignment-form')).toHaveAttribute('data-hydrated', 'true');
    await expect(page.getByTestId('quiz-question')).toHaveCount(1);
    await page.getByRole('button', { name: /add question/i }).click();
    await expect(page.getByTestId('quiz-question')).toHaveCount(2);
    await page.getByLabel(/^title/i).fill('Fractions check');
    await page.getByLabel(/^subject/i).fill('Mathematics');
    // G-915: blank question rows are ignored (bank picks may stand in for them), so
    // the two-options rule is asserted on a question that has a prompt but no options.
    await page
      .getByTestId('quiz-question')
      .first()
      .getByRole('textbox', { name: /prompt/i })
      .fill('What is 1/2 + 1/4?');
    await page.getByRole('button', { name: /save draft/i }).click();
    await expect(page.getByText(/at least two answer options/i).first()).toBeVisible();
  });

  test('/lms/pal rejects an invalid learner id client-side', async ({ page }) => {
    await page.goto('/lms/pal', { waitUntil: 'domcontentloaded' });
    const form = page.getByTestId('pal-lookup-form');
    await expect(form).toHaveAttribute('data-hydrated', 'true');
    const input = form.locator('input');
    if ((await input.count()) > 0) {
      await input.fill('not-a-uuid');
      await page.getByRole('button', { name: /load plan/i }).click();
      await expect(page.getByText(/valid student id/i)).toBeVisible();
    } else {
      // A seeded roster renders a <select>; invalid ids cannot be typed.
      await expect(form.locator('select')).toBeVisible();
    }
  });
});

test.describe('LMS — live authoring, grading and Spiral PAL (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1 and a live gateway + Postgres');

  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('hub lists a published quiz with Board/School scope badge', async ({ page, request }) => {
    const quiz = await createQuiz(request, `E2E hub quiz ${Date.now()}`);
    await page.goto('/lms', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const row = page
      .getByTestId('lms-row')
      .filter({ hasText: quiz.id.slice(0, 0) || 'E2E hub quiz' });
    await expect(row.first()).toBeVisible();
    await expect(row.first().getByText(/^school$/i)).toBeVisible();
    await page.goto(`/lms?kind=quiz&status=published`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('lms-row').first()).toBeVisible();
  });

  test('detail page shows questions with the answer key for authors', async ({ page, request }) => {
    const quiz = await createQuiz(request, `E2E detail quiz ${Date.now()}`);
    await page.goto(`/lms/assignments/${quiz.id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toContainText('E2E detail quiz');
    await expect(page.getByTestId('quiz-question')).toHaveCount(2);
    await expect(page.getByText(/correct answer/).first()).toBeAttached();
    await expect(page.getByText(/no submissions yet/i)).toBeVisible();
  });

  test('draft → publish → close lifecycle from the detail page', async ({ page, request }) => {
    const res = await request.post(`${GATEWAY_URL}/api/v1/lms/assignments`, {
      headers: headers('e2e-teacher', 'teacher', TENANT_A, [INSTITUTION_A]),
      data: {
        scope: 'school',
        institutionId: INSTITUTION_A,
        kind: 'homework',
        title: `E2E lifecycle ${Date.now()}`,
        subject: 'Science',
        maxScore: 10,
      },
    });
    expect(res.status()).toBe(201);
    const { id } = (await res.json()) as { id: string };

    await page.goto(`/lms/assignments/${id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/^draft$/i).first()).toBeVisible();
    await expect(page.getByTestId('lms-lifecycle')).toHaveAttribute('data-hydrated', 'true');
    await page.getByRole('button', { name: /^publish$/i }).click();
    await expect(page.getByText(/^published$/i).first()).toBeVisible({ timeout: 15_000 });

    await expect(page.getByTestId('lms-lifecycle')).toHaveAttribute('data-hydrated', 'true');
    await page.getByRole('button', { name: /^close$/i }).click();
    await page.getByRole('button', { name: /close now/i }).click();
    await expect(page.getByText(/^closed$/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test('learner submits a quiz → auto-graded → teacher sees the score', async ({
    page,
    request,
  }) => {
    const quiz = await createQuiz(request, `E2E grading quiz ${Date.now()}`);
    const submit = await request.post(
      `${GATEWAY_URL}/api/v1/lms/assignments/${quiz.id}/submissions`,
      {
        headers: headers(STUDENT_ID, 'student', TENANT_A, [INSTITUTION_A]),
        data: {
          studentId: STUDENT_ID,
          answers: [
            { questionId: quiz.questions[0]!.id, selectedOptionIndex: 0 },
            { questionId: quiz.questions[1]!.id, selectedOptionIndex: 2 },
          ],
        },
      },
    );
    expect(submit.status(), await submit.text()).toBe(201);
    const graded = (await submit.json()) as { score: number; autoGraded: boolean; status: string };
    expect(graded.autoGraded).toBe(true);
    expect(graded.score).toBe(1);

    await page.goto(`/lms/assignments/${quiz.id}`, { waitUntil: 'domcontentloaded' });
    const row = page.getByTestId('submission-row').first();
    await expect(row).toBeVisible();
    await expect(row).toContainText('1 / 2');
    await expect(row.getByText(/graded/i).first()).toBeVisible();

    // Teacher override via the inline grade form (FR-LMS-013).
    const gradeForm = row.getByTestId('lms-grade-form');
    await expect(gradeForm).toHaveAttribute('data-hydrated', 'true');
    await gradeForm.getByLabel(/^score$/i).fill('2');
    await gradeForm.getByLabel(/feedback/i).fill('Reviewed by teacher');
    await gradeForm.getByRole('button', { name: /save grade/i }).click();
    await expect(gradeForm.getByRole('status')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('submission-row').first()).toContainText('2 / 2', {
      timeout: 15_000,
    });
  });

  test('learners never receive the answer key', async ({ request }) => {
    const quiz = await createQuiz(request, `E2E answer-key ${Date.now()}`);
    const res = await request.get(`${GATEWAY_URL}/api/v1/lms/assignments/${quiz.id}`, {
      headers: headers(STUDENT_ID, 'student', TENANT_A, [INSTITUTION_A]),
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { questions: Array<{ correctOptionIndex: number }> };
    for (const q of body.questions) expect(q.correctOptionIndex).toBe(-1);
  });

  test('cross-school teacher and cross-tenant admin are denied (IDOR)', async ({ request }) => {
    const quiz = await createQuiz(request, `E2E isolation ${Date.now()}`);

    const otherSchool = await request.get(`${GATEWAY_URL}/api/v1/lms/assignments/${quiz.id}`, {
      headers: headers('e2e-other-teacher', 'teacher', TENANT_A, [OTHER_SCHOOL]),
    });
    expect([403, 404]).toContain(otherSchool.status());

    const otherTenant = await request.get(`${GATEWAY_URL}/api/v1/lms/assignments/${quiz.id}`, {
      headers: headers('e2e-b-admin', 'admin', TENANT_B),
    });
    expect([403, 404]).toContain(otherTenant.status());

    const list = await request.get(`${GATEWAY_URL}/api/v1/lms/assignments?pageSize=100`, {
      headers: headers('e2e-b-admin', 'admin', TENANT_B),
    });
    expect(list.status()).toBe(200);
    const rows = ((await list.json()) as { data: Array<{ id: string }> }).data;
    expect(rows.some((r) => r.id === quiz.id)).toBe(false);
  });

  test('Spiral PAL: skill create → practice attempt → plan renders in UI', async ({
    page,
    request,
  }) => {
    const code = `E2E-${Date.now().toString(36).toUpperCase()}`;
    const skillRes = await request.post(`${GATEWAY_URL}/api/v1/lms/skills`, {
      headers: headers('e2e-admin', 'admin'),
      data: {
        scope: 'school',
        institutionId: INSTITUTION_A,
        code,
        name: `E2E skill ${code}`,
        subject: 'Mathematics',
      },
    });
    expect(skillRes.status(), await skillRes.text()).toBe(201);
    const skill = (await skillRes.json()) as { id: string };

    const attempt = await request.post(
      `${GATEWAY_URL}/api/v1/lms/pal/students/${STUDENT_ID}/attempts`,
      {
        headers: headers(STUDENT_ID, 'student', TENANT_A, [INSTITUTION_A]),
        data: { skillId: skill.id, correct: true },
      },
    );
    expect(attempt.status(), await attempt.text()).toBe(201);
    const mastery = (await attempt.json()) as {
      mastery: number;
      streak: number;
      intervalDays: number;
    };
    expect(mastery.streak).toBe(1);
    expect(mastery.intervalDays).toBe(1);
    expect(mastery.mastery).toBeGreaterThan(0);

    const plan = await request.get(`${GATEWAY_URL}/api/v1/lms/pal/students/${STUDENT_ID}/plan`, {
      headers: headers('e2e-teacher', 'teacher', TENANT_A, [INSTITUTION_A]),
    });
    expect(plan.status()).toBe(200);
    const planBody = (await plan.json()) as { items: Array<{ skillId: string }> };
    expect(planBody.items.some((i) => i.skillId === skill.id)).toBe(true);

    await page.goto('/lms/pal', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('skill-list')).toContainText(code);
    const form = page.getByTestId('pal-lookup-form');
    await expect(form).toHaveAttribute('data-hydrated', 'true');
    const input = form.locator('input');
    if ((await input.count()) > 0) {
      await input.fill(STUDENT_ID);
      await page.getByRole('button', { name: /load plan/i }).click();
      await expect(page.getByTestId('pal-plan')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('pal-plan-item').first()).toBeVisible();
    }
  });

  test('learner cannot record attempts for another student', async ({ request }) => {
    const res = await request.post(
      `${GATEWAY_URL}/api/v1/lms/pal/students/00000000-0000-4000-8000-0000000000ee/attempts`,
      {
        headers: headers(STUDENT_ID, 'student', TENANT_A, [INSTITUTION_A]),
        data: { skillId: '00000000-0000-4000-8000-0000000000aa', correct: true },
      },
    );
    expect([403, 404]).toContain(res.status());
  });
});
