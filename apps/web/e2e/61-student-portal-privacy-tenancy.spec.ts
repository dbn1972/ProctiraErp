/**
 * Student portal — privacy and tenancy negatives (child data and PII).
 *
 * A signed-in student must not see another student's records or another
 * tenant's data, on the student screens or through the gateway routes those
 * screens call. Every negative has a positive control: the owning student (or
 * the other tenant's JWT) sees the same rows, and the student under test sees
 * their own rows on the same screens, so an empty or broken page cannot pass a
 * negative by accident.
 *
 * One test per protection layer, so each failing-first mutation fails its own
 * test: the store's per-student SQL predicate, the `/student-portal/me` actor
 * binding, the library patron pin, tenant isolation, and the middleware portal
 * bounce. Failing-first evidence was produced with local-only mutations that
 * are not part of the repository.
 *
 * Code facts asserted here: `/student-portal/me/*` binds the student from the
 * verified JWT `sub` only (routes.ts `requireActorId`) and answers 404 for an
 * unbound sub (`resolveStudentSelfId`); the library pins a student to the JWT
 * sub and answers 403 for any other `studentId` (`bindPatronStudent`); the
 * gateway strips client actor and tenant headers and takes the tenant from the
 * JWT; middleware `portalRoleRedirect` sends guardian-only sessions to /parent.
 *
 * Students and rows are created per run with unique tags
 * (fixtures/student-portal-self.ts), so re-runs on the same database are
 * deterministic.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import {
  INSTITUTION_A,
  TENANT_A,
  TENANT_B,
  adminHeaders,
  call,
  checkoutItem,
  createHomework,
  createLibraryItem,
  createStudent,
  createTimetableMeeting,
  enrolInSharedYear,
  getOk,
  homeworkDueAt,
  markAttendance,
  newTag,
  openAsGuardianOnly,
  openAsStudent,
  pastWeekdays,
  placeHold,
  practiseSkill,
  publishGrade,
  seedCompletedReportCard,
  sendBroadcastCampaign,
  studentHeaders,
  type Json,
} from './fixtures/student-portal-self';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

/** The other tenant for N4; the failing-first M4 mutation points it at tenant A. */
const OTHER_TENANT = TENANT_B;

/** Student self views (packages/backend/parent-portal/src/routes.ts childViews). */
const SELF_VIEWS = [
  'attendance',
  'grades',
  'timetable',
  'homework',
  'lms',
  'report-cards',
  'calendar',
  'notices',
  'pal',
] as const;

const NOT_FOUND_TEXT = 'No record was found. It may not be set up yet for your school.';

/** Records the actual status in the report (annotation) and asserts it is one of `allowed`. */
function expectDenied(
  label: string,
  res: { status: number; text: string },
  allowed: number[],
): void {
  test.info().annotations.push({ type: 'denied-status', description: `${label} -> ${res.status}` });
  expect(allowed, `${label} returned ${res.status}: ${res.text}`).toContain(res.status);
}

function ids(rows: Json[], key: string): unknown[] {
  return rows.map((row) => row[key]);
}

async function openScreen(page: Page, path: string, testId: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  const screen = page.getByTestId(testId);
  await expect(screen).toBeVisible();
  await expect(screen.getByText('Something went wrong loading this page.')).toHaveCount(0);
  return screen;
}

async function selfGet(request: APIRequestContext, studentId: string, view: string) {
  return getOk(request, `/student-portal/me/${view}`, studentHeaders(studentId));
}

test.describe('Student portal — privacy and tenancy negatives (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1 and a live gateway + Postgres');

  test('another student’s records in the same tenant never appear on the student’s screens', async ({
    page,
    request,
  }) => {
    test.slow();
    const tag = newTag();
    const s1 = await createStudent(request, { tag, n: 1 });
    const s2 = await createStudent(request, { tag, n: 2 });
    const cls = await enrolInSharedYear(request, tag, [s1.id, s2.id]);
    const [d1, d2] = pastWeekdays(2) as [string, string];
    await markAttendance(request, cls, [
      [s1.id, d1, 'PRESENT'],
      [s2.id, d2, 'ABSENT'],
    ]);
    const ownGrade = `SP-${tag}`;
    const hiddenGrade = `SPX-${tag}`;
    await publishGrade(request, s1.id, ownGrade);
    await publishGrade(request, s2.id, hiddenGrade);
    const jobId = seedCompletedReportCard({
      tenantId: TENANT_A,
      studentId: s2.id,
      academicPeriodId: cls.periodId,
      institutionId: INSTITUTION_A,
      tag,
    });
    const hiddenSkill = `SP skill X ${tag}`;
    const skillId = await practiseSkill(request, { tag, name: hiddenSkill, studentId: s2.id });
    const hiddenSection = `SP Sec X ${tag}`;
    const { sectionId } = await createTimetableMeeting(request, {
      tag,
      sectionName: hiddenSection,
      periodName: `SP P X ${tag}`,
      studentIds: [s2.id],
    });
    // Both sort ahead of every published row already in the tenant (LIMIT 50).
    const hiddenDue = homeworkDueAt();
    const hiddenHomework = `SP HW X ${tag}`;
    const hiddenHomeworkId = await createHomework(request, {
      title: hiddenHomework,
      dueAt: hiddenDue,
      sectionId,
    });
    const ownHomework = `SP HW A ${tag}`;
    const ownHomeworkId = await createHomework(request, {
      title: ownHomework,
      dueAt: new Date(Date.parse(hiddenDue) - 60_000).toISOString(),
    });

    // Positive control: S2's own JWT sees every row this test hides from S1. (toContain,
    // not exact lists, so a broken per-student filter fails at the screen assertions below.)
    const s2Grades = await selfGet(request, s2.id, 'grades');
    expect(ids(s2Grades.data, 'assessmentCode')).toContain(hiddenGrade);
    expect(ids(s2Grades.reportCards as Json[], 'id')).toContain(jobId);
    expect(ids((await selfGet(request, s2.id, 'attendance')).data, 'date')).toContain(d2);
    expect(ids((await selfGet(request, s2.id, 'pal')).data, 'skillId')).toContain(skillId);
    expect(ids((await selfGet(request, s2.id, 'timetable')).data, 'sectionName')).toContain(
      hiddenSection,
    );
    expect(ids((await selfGet(request, s2.id, 'homework')).data, 'id')).toContain(hiddenHomeworkId);
    // S1's own API view has its own rows and none of S2's.
    expect(ids((await selfGet(request, s1.id, 'homework')).data, 'id')).toContain(ownHomeworkId);

    await openAsStudent(page, s1);

    const grades = await openScreen(page, '/student/grades', 'student-grades');
    await expect(grades).not.toContainText(hiddenGrade);
    await expect(grades.getByRole('listitem')).toHaveCount(1);
    await expect(grades.getByRole('listitem')).toHaveText(`${ownGrade} · 88`);
    await expect(grades.getByText('Report card', { exact: true })).toHaveCount(0);

    const attendance = await openScreen(page, '/student/attendance', 'student-attendance');
    await expect(attendance.getByRole('listitem')).toHaveCount(1);
    await expect(attendance.getByRole('listitem')).toContainText(d1);
    await expect(attendance).not.toContainText(d2);
    await expect(attendance.getByText('100% present · 1 present · 0 absent')).toBeVisible();

    const pal = await openScreen(page, '/student/pal', 'student-pal');
    await expect(pal.getByRole('status')).toHaveText(
      'No practice plan yet. Skills appear here after quizzes and practice.',
    );
    await expect(pal).not.toContainText(hiddenSkill);

    const timetable = await openScreen(page, '/student/timetable', 'student-timetable');
    await expect(timetable).not.toContainText(hiddenSection);

    const homework = await openScreen(page, '/student/homework', 'student-homework');
    await expect(homework.getByRole('listitem').filter({ hasText: ownHomework })).toHaveCount(1);
    await expect(homework).not.toContainText(hiddenHomework);
  });

  test('student-portal APIs bind to the signed-in student and ignore client-supplied ids', async ({
    request,
  }) => {
    test.slow();
    const tag = newTag();
    const s1 = await createStudent(request, { tag, n: 1 });
    const s2 = await createStudent(request, { tag, n: 2 });
    const cls = await enrolInSharedYear(request, tag, [s2.id]);
    const [d2] = pastWeekdays(1) as [string];
    await markAttendance(request, cls, [[s2.id, d2, 'ABSENT']]);
    const hiddenGrade = `SPX-${tag}`;
    await publishGrade(request, s2.id, hiddenGrade);

    // Positive control: S2's own JWT sees the grade and the day.
    expect(ids((await selfGet(request, s2.id, 'grades')).data, 'assessmentCode')).toEqual([
      hiddenGrade,
    ]);
    expect(ids((await selfGet(request, s2.id, 'attendance')).data, 'date')).toEqual([d2]);

    const leaks = (text: string) => text.includes(s2.id) || text.includes(hiddenGrade);

    // A client-supplied studentId query is ignored: S1 still reads S1.
    for (const view of ['grades', 'attendance'] as const) {
      const res = await call(
        request,
        `/student-portal/me/${view}?studentId=${s2.id}`,
        studentHeaders(s1.id),
      );
      expect(res.status, `me/${view}?studentId=<S2>: ${res.text}`).toBe(200);
      expect(leaks(res.text), `me/${view}?studentId=<S2> leaked S2: ${res.text}`).toBe(false);
      expect((JSON.parse(res.text) as { data: Json[] }).data).toEqual([]);
    }

    // Forged actor headers are stripped by the gateway: S1 still reads S1.
    const forged = studentHeaders(s1.id, TENANT_A, {
      'X-User-Id': s2.id,
      'X-Actor-Id': s2.id,
      'X-Actor': s2.id,
      'X-UserId': s2.id,
    });
    for (const view of ['grades', 'attendance'] as const) {
      const res = await call(request, `/student-portal/me/${view}`, forged);
      expect(res.status, `me/${view} + forged actor headers: ${res.text}`).toBe(200);
      expect(leaks(res.text), `me/${view} + forged actor headers leaked S2`).toBe(false);
    }

    // Every self view S1 can call answers for S1 only.
    for (const view of SELF_VIEWS) {
      const res = await call(request, `/student-portal/me/${view}`, studentHeaders(s1.id));
      expect(res.status, `me/${view}: ${res.text}`).toBe(200);
      expect(leaks(res.text), `me/${view} leaked S2: ${res.text}`).toBe(false);
    }

    // The parent child-view routes do not open S2 to a student principal.
    for (const view of SELF_VIEWS) {
      const res = await call(
        request,
        `/parent-portal/children/${s2.id}/${view}`,
        studentHeaders(s1.id),
      );
      expectDenied(`GET /parent-portal/children/<S2>/${view} as S1`, res, [404]);
      expect(res.text, `children/<S2>/${view} leaked S2's grade`).not.toContain(hiddenGrade);
    }

    // Students route: a portal caller gets 404 for a student it is not bound to, so ids
    // cannot be probed (PRC-C010). The gateway binds portal readers through guardian links
    // only (a student's own-record read is served by /student-portal), so the positive
    // control is the tenant admin reading the same, existing record.
    expect((await call(request, `/students/${s2.id}`, adminHeaders())).status).toBe(200);
    expectDenied(
      'GET /students/<S2> as S1',
      await call(request, `/students/${s2.id}`, studentHeaders(s1.id)),
      [404],
    );
  });

  test('library loans and holds are pinned to the signed-in student', async ({ page, request }) => {
    test.slow();
    const tag = newTag();
    const s1 = await createStudent(request, { tag, n: 1 });
    const s2 = await createStudent(request, { tag, n: 2 });
    const query = `SP Book L ${tag}`;
    const itemA = await createLibraryItem(request, `${query} A`);
    const itemB = await createLibraryItem(request, `${query} B`);
    const itemC = await createLibraryItem(request, `${query} C`);
    const ownLoan = await checkoutItem(request, itemA, s1.id);
    const loanB = await checkoutItem(request, itemB, s2.id);
    const loanC = await checkoutItem(request, itemC, s2.id);
    // A is on loan to S1, so S2's hold on it queues at position 1.
    const hold = await placeHold(request, itemA, s2.id);

    // Positive control: S2's own JWT sees both loans and the hold.
    const s2Headers = studentHeaders(s2.id);
    expect(ids((await getOk(request, '/library/loans', s2Headers)).data, 'id').sort()).toEqual(
      [loanB.id, loanC.id].sort(),
    );
    expect((await getOk(request, '/library/holds', s2Headers)).data).toEqual([
      expect.objectContaining({ id: hold.id, position: 1 }),
    ]);

    const s1Headers = studentHeaders(s1.id);
    expectDenied(
      'GET /library/loans?studentId=<S2> as S1',
      await call(request, `/library/loans?studentId=${s2.id}`, s1Headers),
      [403],
    );
    expectDenied(
      'GET /library/holds?studentId=<S2> as S1',
      await call(request, `/library/holds?studentId=${s2.id}`, s1Headers),
      [403],
    );
    expect(ids((await getOk(request, '/library/loans', s1Headers)).data, 'id')).toEqual([
      ownLoan.id,
    ]);
    expect((await getOk(request, '/library/holds', s1Headers)).data).toEqual([]);

    // The screen ignores a studentId in the URL and shows S1's own loan only.
    await openAsStudent(page, s1);
    const screen = await openScreen(
      page,
      `/student/library?studentId=${s2.id}&q=${encodeURIComponent(query)}`,
      'student-library',
    );
    const loansList = screen.getByRole('heading', { name: 'My loans' }).locator('xpath=..');
    await expect(loansList.getByRole('listitem')).toHaveCount(1);
    await expect(loansList.getByRole('listitem')).toContainText(
      `due ${String(ownLoan.dueAt).slice(0, 10)}`,
    );
    const holdsList = screen.getByRole('heading', { name: 'My holds' }).locator('xpath=..');
    await expect(holdsList.getByRole('status')).toHaveText('No holds on this account.');
    await expect(holdsList.getByRole('listitem')).toHaveCount(0);
  });

  test('another tenant’s student and data never appear on screen or via API', async ({
    page,
    request,
  }) => {
    test.slow();
    const tag = newTag();
    const s1 = await createStudent(request, { tag, n: 1 });
    const sb = await createStudent(request, { tag, n: 2, tenantId: OTHER_TENANT });
    const noticeB = `SP Notice B ${tag}`;
    const campaignB = await sendBroadcastCampaign(request, {
      name: noticeB,
      body: `SP body B ${tag}`,
      tenantId: OTHER_TENANT,
    });
    const bookB = `SP Book B ${tag}`;
    const itemB = await createLibraryItem(request, bookB, OTHER_TENANT);
    const loanB = await checkoutItem(request, itemB, sb.id, OTHER_TENANT);

    // Positive control: SB with the other tenant's JWT sees the notice, loan and title.
    const sbB = studentHeaders(sb.id, OTHER_TENANT);
    expect(ids((await getOk(request, '/student-portal/me/notices', sbB)).data, 'id')).toContain(
      campaignB,
    );
    expect(ids((await getOk(request, '/library/loans', sbB)).data, 'id')).toEqual([loanB.id]);
    expect(
      ids(
        (await getOk(request, `/library/opac/search?q=${encodeURIComponent(bookB)}`, sbB)).data,
        'title',
      ),
    ).toEqual([bookB]);

    // (a) Screens as the tenant-A student.
    await openAsStudent(page, s1);
    const notices = await openScreen(page, '/student/notices', 'student-notices');
    await expect(notices).not.toContainText(noticeB);
    const library = await openScreen(
      page,
      `/student/library?q=${encodeURIComponent(bookB)}`,
      'student-library',
    );
    await expect(library.getByText('No titles match this search.')).toBeVisible();
    await expect(library.getByRole('listitem').filter({ hasText: bookB })).toHaveCount(0);

    // (b) The other tenant's student id is unbound in tenant A: 404 on every self view.
    const sbInA = studentHeaders(sb.id, TENANT_A);
    for (const view of SELF_VIEWS) {
      expectDenied(
        `GET /student-portal/me/${view} as SB in tenant A`,
        await call(request, `/student-portal/me/${view}`, sbInA),
        [404],
      );
    }
    await page.context().clearCookies();
    await openAsStudent(page, { id: sb.id, tenantId: TENANT_A });
    for (const [path, testId] of [
      ['/student/grades', 'student-grades'],
      ['/student/attendance', 'student-attendance'],
      ['/student/notices', 'student-notices'],
    ] as const) {
      const screen = await openScreen(page, path, testId);
      await expect(screen.getByRole('status')).toHaveText(NOT_FOUND_TEXT);
      await expect(screen).not.toContainText(noticeB);
      await expect(screen).not.toContainText(sb.firstName);
    }

    // (c) A forged X-Tenant-ID is ignored: the tenant comes from the verified JWT.
    const s1Forged = studentHeaders(s1.id, TENANT_A, { 'X-Tenant-ID': OTHER_TENANT });
    const forgedNotices = await getOk(request, '/student-portal/me/notices', s1Forged);
    expect(ids(forgedNotices.data, 'id')).not.toContain(campaignB);
    expect(ids(forgedNotices.data, 'title')).not.toContain(noticeB);
    expectDenied(
      'GET /student-portal/me/grades as SB in tenant A + forged X-Tenant-ID',
      await call(
        request,
        '/student-portal/me/grades',
        studentHeaders(sb.id, TENANT_A, { 'X-Tenant-ID': OTHER_TENANT }),
      ),
      [404],
    );
  });

  test('a guardian-only session is bounced off the student portal', async ({ page }) => {
    const sub = `sp-g-${newTag().toLowerCase()}`;
    await openAsGuardianOnly(page, sub);
    await page.goto('/student/grades', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/parent(?:[/?#]|$)/);
    await expect(page.getByTestId('student-grades')).toHaveCount(0);
  });
});
