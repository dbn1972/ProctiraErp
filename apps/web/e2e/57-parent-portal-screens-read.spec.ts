/**
 * Parent portal screens — read path, screen → API → database.
 *
 * Every read-only parent screen is opened as a seeded guardian and must show
 * data that this test wrote to the database through the staff APIs; the test
 * also calls the gateway route the screen uses with the guardian JWT and
 * checks the same seeded row comes back.
 *
 * Each test builds its own family (fixtures/parent-portal-family.ts): new
 * children via `POST /students` with unique names, then the guardian identity
 * rows (household, member, custody, link) by psql, because no HTTP route
 * writes households or custody. Per-run children make every per-child read
 * start empty, and assertions use per-run unique strings, so re-runs against
 * the same database are deterministic.
 *
 * Ungated: all 17 parent routes redirect an unauthenticated visitor to /login.
 */
import { expect, test, type APIRequestContext } from '@playwright/test';

import {
  GATEWAY_URL,
  INSTITUTION_A,
  TENANT_A,
  adminHeaders,
  createFamily,
  enrolInSharedYear,
  guardianHeaders,
  newTag,
  openAsGuardian,
  publishGrade,
  studentHeaders,
  type Family,
} from './fixtures/parent-portal-family';
import { createSignedJwt } from './fixtures/fake-session';
import { ensureSharedAcademicYear } from './fixtures/test-data';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

type Json = Record<string, unknown>;

async function send(
  request: APIRequestContext,
  method: 'post' | 'put',
  path: string,
  data: unknown,
  expected: number,
  headers: Record<string, string> = adminHeaders(),
): Promise<Json> {
  const res = await request[method](`${GATEWAY_URL}/api/v1${path}`, { headers, data });
  expect(res.status(), `${method.toUpperCase()} ${path}: ${await res.text()}`).toBe(expected);
  return (await res.json()) as Json;
}

async function guardianGet(request: APIRequestContext, family: Family, path: string) {
  const res = await request.get(`${GATEWAY_URL}/api/v1${path}`, {
    headers: guardianHeaders(family.guardianSub, family.tenantId),
  });
  const text = await res.text();
  expect(res.status(), `GET ${path}: ${text}`).toBe(200);
  return JSON.parse(text) as Json & { data: Json[] };
}

function teacherHeaders(): Record<string, string> {
  const token = createSignedJwt({
    sub: 'e2e-teacher',
    email: 'e2e-teacher@tenant.test',
    displayName: 'e2e-teacher',
    tenantId: TENANT_A,
    roles: [{ roleId: 'teacher', roleName: 'teacher', areaId: null }],
    institutions: [INSTITUTION_A],
  });
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Tenant-ID': TENANT_A,
  };
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The `count` most recent distinct weekdays strictly before today (UTC). */
function pastWeekdays(count: number): string[] {
  const days: string[] = [];
  const d = new Date();
  while (days.length < count) {
    d.setUTCDate(d.getUTCDate() - 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) days.push(isoDay(d));
  }
  return days;
}

/**
 * Homework/LMS reads are tenant-wide lists ordered by due date ascending with
 * a LIMIT, so a fixed due date would let rows from earlier runs sort ahead and
 * eventually push this run's row out. A due date that moves one second
 * earlier for every second of wall time sorts each new run first.
 */
function rerunSafeDueAt(): string {
  const anchor = Date.UTC(2026, 0, 1);
  return new Date(anchor - (Date.now() - anchor)).toISOString();
}

async function createAssignment(
  request: APIRequestContext,
  input: { kind: 'homework' | 'quiz'; title: string },
): Promise<{ id: string; questions: Array<{ id: string }> }> {
  const quiz =
    input.kind === 'quiz'
      ? {
          maxScore: 2,
          allowLate: true,
          questions: [
            { prompt: '1 + 1 = ?', options: ['2', '3'], correctOptionIndex: 0, points: 1 },
            { prompt: '2 + 2 = ?', options: ['4', '5'], correctOptionIndex: 0, points: 1 },
          ],
        }
      : { maxScore: 10 };
  const body = await send(
    request,
    'post',
    '/lms/assignments',
    {
      scope: 'school',
      institutionId: INSTITUTION_A,
      kind: input.kind,
      title: input.title,
      subject: 'Mathematics',
      dueAt: rerunSafeDueAt(),
      publish: true,
      ...quiz,
    },
    201,
    teacherHeaders(),
  );
  expect(body.status, `assignment ${input.title} published`).toBe('published');
  return body as unknown as { id: string; questions: Array<{ id: string }> };
}

test.describe('Parent portal screens — unauthenticated (ungated)', () => {
  test('all 17 parent routes redirect to /login', async ({ page }) => {
    test.slow();
    await page.goto('/parent', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading').first()).toBeVisible();
    await page.goto('/parent/attendance', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/parent/calendar', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/parent/consents', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/parent/fees', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/parent/grades', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/parent/homework', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/parent/library', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/parent/lms', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/parent/messages', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
    await page.goto(`/parent/messages/${'00000000-0000-4000-8000-0000000000e2'}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/parent/notices', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/parent/offers', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/parent/pal', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/parent/report-cards', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/parent/scholarships', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/parent/timetable', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('Parent portal screens — read path (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1 and a live gateway + Postgres');

  test('/parent lists both linked children by name', async ({ page, request }) => {
    const tag = newTag();
    const family = await createFamily(request, { childCount: 2, tag });
    const [c1, c2] = family.children as [Family['children'][0], Family['children'][0]];

    const api = await guardianGet(request, family, '/parent-portal/children');
    expect(api.data.map((link) => link.studentId).sort()).toEqual([c1.id, c2.id].sort());

    await openAsGuardian(page, family);
    await page.goto('/parent', { waitUntil: 'domcontentloaded' });
    const home = page.getByTestId('parent-home');
    await expect(home).toBeVisible();
    await expect(home.getByText('2 linked children.')).toBeVisible();
    // Labels are `<admission no> · First Last` (formatPersonLabel); the number is server-assigned.
    for (const child of [c1, c2]) {
      const row = home.getByRole('listitem').filter({ hasText: child.label });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText('Guardian · Active');
    }
  });

  test('/parent/attendance shows each child’s own days and summary', async ({ page, request }) => {
    test.slow();
    const tag = newTag();
    const family = await createFamily(request, { childCount: 2, tag });
    const [c1, c2] = family.children as [Family['children'][0], Family['children'][0]];
    const { periodId, classId } = await enrolInSharedYear(request, tag, [c1.id, c2.id]);
    const [d1, d2, d3] = pastWeekdays(3) as [string, string, string];
    const marks: Array<[string, string, string]> = [
      [c1.id, d1, 'PRESENT'],
      [c1.id, d2, 'LATE'],
      [c2.id, d3, 'ABSENT'],
    ];
    for (const [studentId, date, status] of marks) {
      await send(
        request,
        'post',
        '/attendance/student',
        {
          studentId,
          institutionId: INSTITUTION_A,
          classId,
          academicPeriodId: periodId,
          date,
          status,
        },
        201,
      );
    }

    const api = await guardianGet(request, family, `/parent-portal/children/${c1.id}/attendance`);
    expect(api.data.map((day) => [day.date, day.status])).toEqual([
      [d1, 'PRESENT'],
      [d2, 'LATE'],
    ]);
    expect(api.summary).toMatchObject({ present: 1, absent: 0, late: 1 });

    await openAsGuardian(page, family);
    await page.goto(`/parent/attendance?studentId=${c1.id}`, { waitUntil: 'domcontentloaded' });
    const screen = page.getByTestId('parent-attendance');
    await expect(screen).toBeVisible();
    await expect(screen.getByText('1 present · 0 absent · 1 late')).toBeVisible();
    await expect(screen.getByRole('listitem').filter({ hasText: d1 })).toContainText('PRESENT');
    await expect(screen.getByRole('listitem').filter({ hasText: d2 })).toContainText('LATE');
    await expect(screen.getByText(d3)).toHaveCount(0);

    // Child switcher: selecting the second child reloads the page for that child only.
    const select = page.getByLabel('Select child');
    await expect(select).toHaveValue(c1.id);
    await expect(async () => {
      await select.selectOption(c2.id);
      await expect(page).toHaveURL(new RegExp(`studentId=${c2.id}`), { timeout: 3_000 });
    }).toPass({ timeout: 20_000 });
    await expect(screen.getByRole('listitem').filter({ hasText: d3 })).toContainText('ABSENT');
    await expect(screen.getByText('0 present · 1 absent · 0 late')).toBeVisible();
    await expect(screen.getByText(d1)).toHaveCount(0);
    await expect(screen.getByText(d2)).toHaveCount(0);
  });

  test('/parent/calendar shows an event in the child’s enrolled year', async ({
    page,
    request,
  }) => {
    test.slow();
    const tag = newTag();
    const family = await createFamily(request, { childCount: 1, tag });
    const [c1] = family.children as [Family['children'][0]];
    const { periodId } = await enrolInSharedYear(request, tag, [c1.id]);
    const name = `PP Event ${tag}`;
    const day = isoDay(new Date());
    await send(
      request,
      'post',
      `/academic-periods/${periodId}/calendar`,
      { kind: 'event', name, startDate: day, endDate: day },
      201,
    );

    const api = await guardianGet(request, family, `/parent-portal/children/${c1.id}/calendar`);
    expect(api.data.find((event) => event.name === name)).toMatchObject({
      kind: 'event',
      startDate: day,
    });

    await openAsGuardian(page, family);
    await page.goto(`/parent/calendar?studentId=${c1.id}`, { waitUntil: 'domcontentloaded' });
    const row = page.getByTestId('parent-calendar').getByRole('listitem').filter({ hasText: name });
    await expect(row).toBeVisible();
    await expect(row).toContainText(`event · ${day}`);
  });

  test('/parent/grades shows a published grade', async ({ page, request }) => {
    test.slow();
    const tag = newTag();
    const family = await createFamily(request, { childCount: 1, tag });
    const [c1] = family.children as [Family['children'][0]];
    const code = `PP-${tag}`;
    const entryId = await publishGrade(request, c1.id, code);

    const api = await guardianGet(request, family, `/parent-portal/children/${c1.id}/grades`);
    expect(api.data.find((grade) => grade.id === entryId)).toMatchObject({
      assessmentCode: code,
      numericScore: 88,
    });

    await openAsGuardian(page, family);
    await page.goto(`/parent/grades?studentId=${c1.id}`, { waitUntil: 'domcontentloaded' });
    const row = page.getByTestId('parent-grades').getByRole('listitem').filter({ hasText: code });
    await expect(row).toContainText(`${code} · 88`);
    await expect(row).toContainText('Published');
  });

  test('/parent/homework shows a published homework', async ({ page, request }) => {
    test.slow();
    const tag = newTag();
    const family = await createFamily(request, { childCount: 1, tag });
    const [c1] = family.children as [Family['children'][0]];
    const title = `PP HW ${tag}`;
    const homework = await createAssignment(request, { kind: 'homework', title });

    const api = await guardianGet(request, family, `/parent-portal/children/${c1.id}/homework`);
    expect(api.data.find((item) => item.id === homework.id)).toMatchObject({
      title,
      kind: 'homework',
    });

    await openAsGuardian(page, family);
    await page.goto(`/parent/homework?studentId=${c1.id}`, { waitUntil: 'domcontentloaded' });
    const row = page
      .getByTestId('parent-homework')
      .getByRole('listitem')
      .filter({ hasText: title });
    await expect(row).toContainText('homework · Mathematics · due');
  });

  test('/parent/lms shows assignments with the child’s own submission and score', async ({
    page,
    request,
  }) => {
    test.slow();
    const tag = newTag();
    const family = await createFamily(request, { childCount: 1, tag });
    const [c1] = family.children as [Family['children'][0]];
    const hwTitle = `PP HW ${tag}`;
    const quizTitle = `PP Quiz ${tag}`;
    await createAssignment(request, { kind: 'homework', title: hwTitle });
    const quiz = await createAssignment(request, { kind: 'quiz', title: quizTitle });
    const submission = await send(
      request,
      'post',
      `/lms/assignments/${quiz.id}/submissions`,
      {
        studentId: c1.id,
        answers: quiz.questions.map((q) => ({ questionId: q.id, selectedOptionIndex: 0 })),
      },
      201,
      studentHeaders(c1.id),
    );
    expect(submission.score).toBe(2);

    const api = await guardianGet(request, family, `/parent-portal/children/${c1.id}/lms`);
    const apiQuiz = api.data.find((item) => item.id === quiz.id);
    expect(apiQuiz).toMatchObject({ title: quizTitle, score: 2, maxScore: 2 });
    expect(api.data.find((item) => item.title === hwTitle)).toMatchObject({
      submissionStatus: null,
    });
    expect(api.summary).toMatchObject({ submitted: 1, graded: 1 });

    await openAsGuardian(page, family);
    await page.goto(`/parent/lms?studentId=${c1.id}`, { waitUntil: 'domcontentloaded' });
    const screen = page.getByTestId('parent-lms');
    await expect(screen.getByTestId('parent-lms-summary')).toContainText(
      '· 1 submitted · 1 graded ·',
    );
    await expect(screen.getByRole('listitem').filter({ hasText: quizTitle })).toContainText(
      `quiz · Mathematics · ${String(apiQuiz?.submissionStatus)} · 2 / 2`,
    );
    await expect(screen.getByRole('listitem').filter({ hasText: hwTitle })).toContainText(
      'homework · Mathematics · not submitted',
    );
  });

  test('/parent/notices shows a sent school-wide campaign', async ({ page, request }) => {
    test.slow();
    const tag = newTag();
    const family = await createFamily(request, { childCount: 1, tag });
    const [c1] = family.children as [Family['children'][0]];
    const title = `PP Notice ${tag}`;
    const body = `PP body ${tag}`;
    const campaign = await send(
      request,
      'post',
      '/communication/campaigns',
      {
        name: title,
        body,
        channels: ['email'],
        audienceJson: { scope: 'all' },
        createdBy: 'e2e-admin',
      },
      201,
    );
    const sent = await send(
      request,
      'post',
      `/communication/campaigns/${campaign.id}/send`,
      {},
      200,
    );
    expect(sent.status).toBe('sent');

    const api = await guardianGet(request, family, `/parent-portal/children/${c1.id}/notices`);
    expect(api.data.find((notice) => notice.id === campaign.id)).toMatchObject({ title, body });

    await openAsGuardian(page, family);
    await page.goto(`/parent/notices?studentId=${c1.id}`, { waitUntil: 'domcontentloaded' });
    const row = page.getByTestId('parent-notices').getByRole('listitem').filter({ hasText: title });
    await expect(row).toContainText(body);
    await expect(row).toContainText('campaign');
  });

  test('/parent/pal shows the child’s practised skill', async ({ page, request }) => {
    test.slow();
    const tag = newTag();
    const family = await createFamily(request, { childCount: 1, tag });
    const [c1] = family.children as [Family['children'][0]];
    const skillName = `PP skill ${tag}`;
    const skill = await send(
      request,
      'post',
      '/lms/skills',
      {
        scope: 'school',
        institutionId: INSTITUTION_A,
        code: `PP-${tag}`,
        name: skillName,
        subject: 'Mathematics',
      },
      201,
    );
    await send(
      request,
      'post',
      `/lms/pal/students/${c1.id}/attempts`,
      { skillId: skill.id, correct: true },
      201,
      studentHeaders(c1.id),
    );

    const api = await guardianGet(request, family, `/parent-portal/children/${c1.id}/pal`);
    const item = api.data.find((row) => row.skillId === skill.id);
    expect(item).toMatchObject({ skillName, subject: 'Mathematics' });

    await openAsGuardian(page, family);
    await page.goto(`/parent/pal?studentId=${c1.id}`, { waitUntil: 'domcontentloaded' });
    const row = page.getByTestId('parent-pal').getByRole('listitem').filter({ hasText: skillName });
    await expect(row).toContainText(`${String(item?.bucket)} · Mathematics · mastery`);
  });

  // The completed-card case is defect D1 (500 once a completed report card
  // exists); it lives with the product fix PR. This covers the state that works
  // today: linked children and no completed card yet.
  test('/parent/report-cards loads for linked children with no completed card', async ({
    page,
    request,
  }) => {
    test.slow();
    const tag = newTag();
    const family = await createFamily(request, { childCount: 2, tag });
    const [c1, c2] = family.children as [Family['children'][0], Family['children'][0]];

    const api = await guardianGet(request, family, `/parent-portal/children/${c1.id}/report-cards`);
    expect(api.data).toEqual([]);

    await openAsGuardian(page, family);
    await page.goto(`/parent/report-cards?studentId=${c1.id}`, { waitUntil: 'domcontentloaded' });
    const screen = page.getByTestId('parent-report-cards');
    await expect(screen.getByRole('heading', { level: 1, name: 'Report cards' })).toBeVisible();
    await expect(screen.getByRole('status')).toHaveText('No completed report cards yet.');
    const select = page.getByLabel('Select child');
    await expect(select).toHaveValue(c1.id);
    await expect(select.locator('option')).toHaveCount(2);
    await expect(select.locator(`option[value="${c2.id}"]`)).toContainText(c2.label);
    await expect(screen.getByText('Something went wrong loading this page.')).toHaveCount(0);
    await expect(screen.getByText('This record is not available for your account.')).toHaveCount(0);
    await expect(screen.getByRole('region', { name: /^Report card / })).toHaveCount(0);
  });

  test('/parent/timetable shows the child’s published class meeting', async ({ page, request }) => {
    test.slow();
    const tag = newTag();
    const family = await createFamily(request, { childCount: 1, tag });
    const [c1] = family.children as [Family['children'][0]];
    const period = await ensureSharedAcademicYear(request, GATEWAY_URL, adminHeaders());
    const bell = await send(
      request,
      'post',
      '/timetable/bell-schedules',
      {
        institutionId: INSTITUTION_A,
        academicPeriodId: period.id,
        name: `PP Bell ${tag}`,
        code: `PB${tag.slice(0, 6)}`,
        dayPattern: '1,2,3,4,5',
      },
      201,
    );
    const periodName = `PP P ${tag}`;
    const bellPeriod = await send(
      request,
      'post',
      `/timetable/bell-schedules/${bell.id}/periods`,
      { name: periodName, periodOrder: 1, startTime: '08:00', endTime: '08:45' },
      201,
    );
    const staff = await send(
      request,
      'post',
      '/staff',
      {
        firstName: 'PP',
        lastName: `Teacher ${tag}`,
        dateOfBirth: '1984-03-12',
        identityNumber: `PP-${tag}`,
        contactPhone: '+10000000001',
        contactEmail: `pp-${tag.toLowerCase()}@tenant-a.test`,
        position: 'Teacher',
      },
      201,
    );
    // Meetings require the teacher to be assigned to the institution (as e2e/50).
    await send(
      request,
      'post',
      '/staff/assignments',
      {
        staffId: staff.id,
        institutionId: INSTITUTION_A,
        subjectId: '00000000-0000-4000-8000-0000000005b1',
        classId: '00000000-0000-4000-8000-0000000005c1',
        role: 'Teacher',
        allocationPercentage: 100,
        startDate: isoDay(new Date(Date.now() - 86_400_000)),
      },
      201,
    );
    const sectionName = `PP Sec ${tag}`;
    const section = await send(
      request,
      'post',
      '/timetable/sections',
      {
        institutionId: INSTITUTION_A,
        academicPeriodId: period.id,
        name: sectionName,
        code: `PS${tag.slice(0, 6)}`,
        capacity: 30,
      },
      201,
    );
    await send(
      request,
      'post',
      '/timetable/meetings',
      {
        institutionId: INSTITUTION_A,
        academicPeriodId: period.id,
        sectionId: section.id,
        staffId: staff.id,
        periodId: bellPeriod.id,
        roomId: null,
        dayOfWeek: 1,
        status: 'active',
      },
      201,
    );
    await send(request, 'post', `/timetable/sections/${section.id}/publish`, {}, 200);
    await send(
      request,
      'post',
      `/timetable/sections/${section.id}/enrollments`,
      { studentId: c1.id },
      201,
    );

    const api = await guardianGet(request, family, `/parent-portal/children/${c1.id}/timetable`);
    expect(api.data).toEqual([
      expect.objectContaining({ sectionId: section.id, sectionName, periodName, dayOfWeek: 1 }),
    ]);

    await openAsGuardian(page, family);
    await page.goto(`/parent/timetable?studentId=${c1.id}`, { waitUntil: 'domcontentloaded' });
    const grid = page.getByTestId('parent-timetable').getByTestId('timetable-weekly-grid');
    await expect(grid.getByText(sectionName, { exact: true })).toBeVisible();
    await expect(grid).toContainText(`${periodName} · 08:00`);
  });

  test('/parent/library shows catalogue results and the child’s loan and hold', async ({
    page,
    request,
  }) => {
    test.slow();
    const tag = newTag();
    const family = await createFamily(request, { childCount: 2, tag });
    const [c1, c2] = family.children as [Family['children'][0], Family['children'][0]];
    const titleA = `PP Book ${tag} A`;
    const titleB = `PP Book ${tag} B`;
    const itemA = await send(
      request,
      'post',
      '/library/items',
      { title: titleA, copies: 1, author: 'PP' },
      201,
    );
    const itemB = await send(
      request,
      'post',
      '/library/items',
      { title: titleB, copies: 1, author: 'PP' },
      201,
    );
    const loan = await send(
      request,
      'post',
      '/library/circulation/checkout',
      { itemId: itemA.id, studentId: c1.id },
      201,
    );
    // B is on loan to the sibling, so the child's hold on it queues at position 1.
    await send(
      request,
      'post',
      '/library/circulation/checkout',
      { itemId: itemB.id, studentId: c2.id },
      201,
    );
    const hold = await send(
      request,
      'post',
      '/library/holds',
      { itemId: itemB.id, studentId: c1.id },
      201,
    );

    const loans = await guardianGet(request, family, `/library/loans?studentId=${c1.id}`);
    expect(loans.data.map((row) => row.id)).toEqual([loan.id]);
    const holds = await guardianGet(request, family, `/library/holds?studentId=${c1.id}`);
    expect(holds.data).toEqual([expect.objectContaining({ id: hold.id, position: 1 })]);
    const search = await guardianGet(
      request,
      family,
      `/library/opac/search?q=${encodeURIComponent(`PP Book ${tag}`)}`,
    );
    expect(search.data.map((row) => row.title).sort()).toEqual([titleA, titleB]);

    await openAsGuardian(page, family);
    await page.goto(
      `/parent/library?studentId=${c1.id}&q=${encodeURIComponent(`PP Book ${tag}`)}`,
      { waitUntil: 'domcontentloaded' },
    );
    const screen = page.getByTestId('parent-library');
    await expect(screen.getByText(titleA, { exact: true })).toBeVisible();
    await expect(screen.getByText(titleB, { exact: true })).toBeVisible();
    const loansList = screen.getByRole('heading', { name: 'Loans' }).locator('xpath=..');
    await expect(loansList.getByRole('listitem')).toHaveCount(1);
    await expect(loansList.getByRole('listitem')).toContainText(String(loan.status));
    await expect(loansList.getByRole('listitem')).toContainText('due ');
    const holdsList = screen.getByRole('heading', { name: 'Holds' }).locator('xpath=..');
    await expect(holdsList.getByRole('listitem')).toHaveCount(1);
    await expect(holdsList.getByRole('listitem')).toContainText('· position 1');
  });
});
