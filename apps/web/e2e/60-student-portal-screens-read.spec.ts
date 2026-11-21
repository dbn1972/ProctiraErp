/**
 * Student portal screens — read path, screen → API → database.
 *
 * Every student screen is opened as a seeded student and must show data this
 * test wrote to the database through the staff APIs (one completed report
 * card is inserted by SQL because no API completes a job). The test also calls
 * the gateway route the screen uses with the student JWT and checks the same
 * seeded row comes back.
 *
 * No student screen saves through a form: the only form, the library
 * "Search titles" form, is `method="get"`, and Sign out is a session action.
 *
 * Each test creates its own students (fixtures/student-portal-self.ts) and
 * signs in with `sub = students.id`, so per-student reads start empty on every
 * run. Tenant-wide lists are made independent of leftover rows: homework gets
 * a due date before every published row in the tenant, the notice is sent last
 * (newest first), and library search uses a per-run tag. All API writes happen
 * before the first page visit.
 *
 * Ungated: all 9 student routes redirect an unauthenticated visitor to /login.
 */
import { expect, test, type Locator } from '@playwright/test';

import {
  INSTITUTION_A,
  TENANT_A,
  checkoutItem,
  createHomework,
  createLibraryItem,
  createStudent,
  createTimetableMeeting,
  enrolInSharedYear,
  getOk,
  homeworkDueAt,
  isoDay,
  markAttendance,
  newTag,
  openAsStudent,
  pastWeekdays,
  placeHold,
  practiseSkill,
  publishGrade,
  seedCompletedReportCard,
  send,
  sendBroadcastCampaign,
  studentHeaders,
} from './fixtures/student-portal-self';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

const ERROR_FRAME = 'Something went wrong loading this page.';

async function expectNoErrorFrame(screen: Locator): Promise<void> {
  await expect(screen).toBeVisible();
  await expect(screen.getByText(ERROR_FRAME)).toHaveCount(0);
  await expect(screen.getByText('This record could not be found.')).toHaveCount(0);
  await expect(screen.getByText('This record is not available for your account.')).toHaveCount(0);
}

test.describe('Student portal screens — unauthenticated (ungated)', () => {
  test('all 9 student routes redirect to /login', async ({ page }) => {
    test.slow();
    await page.goto('/student', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/student/attendance', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/student/calendar', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/student/grades', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/student/homework', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/student/library', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/student/notices', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/student/pal', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/student/timetable', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('Student portal screens — read path (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1 and a live gateway + Postgres');

  test('/student links every student screen, opens grades, and signs out', async ({
    page,
    request,
  }) => {
    test.slow();
    const tag = newTag();
    const s = await createStudent(request, { tag, n: 1 });
    const code = `SP-${tag}`;
    const entryId = await publishGrade(request, s.id, code);

    const api = await getOk(request, '/student-portal/me/grades', studentHeaders(s.id));
    expect(api.data.find((grade) => grade.id === entryId)).toMatchObject({
      assessmentCode: code,
      numericScore: 88,
    });

    await openAsStudent(page, s);
    await page.goto('/student', { waitUntil: 'domcontentloaded' });
    const home = page.getByTestId('student-home');
    await expect(home).toBeVisible();
    await expect(home.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
    const links: Array<[string, string]> = [
      ['Open attendance', '/student/attendance'],
      ['Open grades', '/student/grades'],
      ['Open timetable', '/student/timetable'],
      ['Open homework', '/student/homework'],
      ['Open library', '/student/library'],
      ['Open calendar', '/student/calendar'],
      ['Open notices', '/student/notices'],
      ['Open PAL plan', '/student/pal'],
    ];
    await expect(home.getByRole('link')).toHaveCount(links.length);
    for (const [name, href] of links) {
      await expect(home.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
    }

    await home.getByRole('link', { name: 'Open grades', exact: true }).click();
    await expect(page).toHaveURL(/\/student\/grades$/);
    const grades = page.getByTestId('student-grades');
    await expect(grades.getByRole('listitem').filter({ hasText: code })).toHaveText(`${code} · 88`);

    // Sign out clears the session. A click before the shell hydrates does nothing, so click
    // until the logout request is sent, then stop clicking: a second click while /login
    // loads would restart that navigation.
    const signOut = page.getByTestId('student-shell-signout');
    await expect(async () => {
      const logout = page.waitForResponse(
        (res) => res.url().endsWith('/api/auth/logout') && res.request().method() === 'POST',
        { timeout: 3_000 },
      );
      await signOut.click();
      expect((await logout).status()).toBe(200);
    }).toPass({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/login/, { timeout: 60_000 });
    await page.goto('/student', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
  });

  test('/student/attendance shows only the student’s own days and summary', async ({
    page,
    request,
  }) => {
    test.slow();
    const tag = newTag();
    const s = await createStudent(request, { tag, n: 1 });
    const other = await createStudent(request, { tag, n: 2 });
    const cls = await enrolInSharedYear(request, tag, [s.id, other.id]);
    const [d1, d2, d3, d4] = pastWeekdays(4) as [string, string, string, string];
    await markAttendance(request, cls, [
      [s.id, d1, 'PRESENT'],
      [s.id, d2, 'LATE'],
      [s.id, d3, 'ABSENT'],
      [other.id, d4, 'PRESENT'],
    ]);

    const api = await getOk(request, '/student-portal/me/attendance', studentHeaders(s.id));
    expect(api.data.map((day) => [day.date, day.status])).toEqual([
      [d1, 'PRESENT'],
      [d2, 'LATE'],
      [d3, 'ABSENT'],
    ]);
    expect(api.summary).toMatchObject({ present: 1, absent: 1, late: 1, percentage: 66.67 });

    await openAsStudent(page, s);
    await page.goto('/student/attendance', { waitUntil: 'domcontentloaded' });
    const screen = page.getByTestId('student-attendance');
    await expectNoErrorFrame(screen);
    await expect(screen.getByText('66.67% present · 1 present · 1 absent')).toBeVisible();
    const rows = screen.getByRole('listitem');
    await expect(rows).toHaveCount(3);
    await expect(rows.filter({ hasText: d1 })).toContainText('PRESENT');
    await expect(rows.filter({ hasText: d2 })).toContainText('LATE');
    await expect(rows.filter({ hasText: d3 })).toContainText('ABSENT');
    await expect(screen.getByText(d4)).toHaveCount(0);
  });

  test('/student/calendar shows an event in the student’s enrolled year', async ({
    page,
    request,
  }) => {
    test.slow();
    const tag = newTag();
    const s = await createStudent(request, { tag, n: 1 });
    const { periodId } = await enrolInSharedYear(request, tag, [s.id]);
    const name = `SP Event ${tag}`;
    const day = isoDay(new Date());
    const event = await send(
      request,
      'post',
      `/academic-periods/${periodId}/calendar`,
      { kind: 'event', name, startDate: day, endDate: day },
      201,
    );

    const api = await getOk(request, '/student-portal/me/calendar', studentHeaders(s.id));
    expect(api.data.find((row) => row.id === event.id)).toMatchObject({
      name,
      kind: 'event',
      startDate: day,
    });

    await openAsStudent(page, s);
    await page.goto('/student/calendar', { waitUntil: 'domcontentloaded' });
    const screen = page.getByTestId('student-calendar');
    await expectNoErrorFrame(screen);
    const row = screen.getByRole('listitem').filter({ hasText: name });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(`event · ${day}`);
  });

  test('/student/grades shows a published grade and a completed report card', async ({
    page,
    request,
  }) => {
    test.slow();
    const tag = newTag();
    const s = await createStudent(request, { tag, n: 1 });
    const code = `SP-${tag}`;
    const entryId = await publishGrade(request, s.id, code);
    const { periodId } = await enrolInSharedYear(request, tag, [s.id]);
    const jobId = seedCompletedReportCard({
      tenantId: TENANT_A,
      studentId: s.id,
      academicPeriodId: periodId,
      institutionId: INSTITUTION_A,
      tag,
    });

    const api = await getOk(request, '/student-portal/me/grades', studentHeaders(s.id));
    expect(api.data).toEqual([
      expect.objectContaining({ id: entryId, assessmentCode: code, numericScore: 88 }),
    ]);
    expect(api.reportCards).toEqual([
      expect.objectContaining({ id: jobId, status: 'completed', academicPeriodId: periodId }),
    ]);

    await openAsStudent(page, s);
    await page.goto('/student/grades', { waitUntil: 'domcontentloaded' });
    const screen = page.getByTestId('student-grades');
    await expectNoErrorFrame(screen);
    const rows = screen.getByRole('listitem');
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: code })).toHaveText(`${code} · 88`);
    await expect(rows.filter({ hasText: 'Report card' })).toContainText('Completed');
  });

  test('/student/homework shows a published homework', async ({ page, request }) => {
    test.slow();
    const tag = newTag();
    const s = await createStudent(request, { tag, n: 1 });
    const title = `SP HW ${tag}`;
    const homeworkId = await createHomework(request, { title, dueAt: homeworkDueAt() });

    const api = await getOk(request, '/student-portal/me/homework', studentHeaders(s.id));
    // SP-R6: the store returns the first 50 rows by due date. The row is dated
    // before every published row, but another worker's homework can land first,
    // so assert it is on that page rather than at index 0.
    const index = api.data.findIndex((row) => row.id === homeworkId);
    expect(index, 'this run’s homework is in the first 50 rows').toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThan(50);
    expect(api.data[index]).toMatchObject({ id: homeworkId, title, kind: 'homework' });

    await openAsStudent(page, s);
    await page.goto('/student/homework', { waitUntil: 'domcontentloaded' });
    const screen = page.getByTestId('student-homework');
    await expectNoErrorFrame(screen);
    const row = screen.getByRole('listitem').filter({ hasText: title });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('homework · due ');
  });

  test('/student/library shows catalogue results and the student’s own loan and hold', async ({
    page,
    request,
  }) => {
    test.slow();
    const tag = newTag();
    const s = await createStudent(request, { tag, n: 1 });
    const other = await createStudent(request, { tag, n: 2 });
    const titleA = `SP Book ${tag} A`;
    const titleB = `SP Book ${tag} B`;
    const itemA = await createLibraryItem(request, titleA);
    const itemB = await createLibraryItem(request, titleB);
    const loan = await checkoutItem(request, itemA, s.id);
    // B is on loan to the other student, so the hold on it queues at position 1.
    await checkoutItem(request, itemB, other.id);
    const hold = await placeHold(request, itemB, s.id);

    const headers = studentHeaders(s.id);
    const loans = await getOk(request, '/library/loans', headers);
    expect(loans.data.map((row) => row.id)).toEqual([loan.id]);
    const holds = await getOk(request, '/library/holds', headers);
    expect(holds.data).toEqual([expect.objectContaining({ id: hold.id, position: 1 })]);
    const query = `SP Book ${tag}`;
    const search = await getOk(
      request,
      `/library/opac/search?q=${encodeURIComponent(query)}`,
      headers,
    );
    expect(search.data.map((row) => row.title).sort()).toEqual([titleA, titleB]);

    await openAsStudent(page, s);
    await page.goto(`/student/library?q=${encodeURIComponent(query)}`, {
      waitUntil: 'domcontentloaded',
    });
    const screen = page.getByTestId('student-library');
    await expectNoErrorFrame(screen);
    await expect(screen.getByLabel('Search titles')).toHaveValue(query);
    for (const row of search.data) {
      const item = screen.getByRole('listitem').filter({ hasText: String(row.title) });
      await expect(item).toHaveCount(1);
      await expect(item).toContainText(
        `SP · ${String(row.available)}/${String(row.copies)} available`,
      );
    }
    const loansList = screen.getByRole('heading', { name: 'My loans' }).locator('xpath=..');
    await expect(loansList.getByRole('listitem')).toHaveCount(1);
    await expect(loansList.getByRole('listitem')).toContainText(String(loan.status));
    await expect(loansList.getByRole('listitem')).toContainText(
      `due ${String(loan.dueAt).slice(0, 10)}`,
    );
    const holdsList = screen.getByRole('heading', { name: 'My holds' }).locator('xpath=..');
    await expect(holdsList.getByRole('listitem')).toHaveCount(1);
    await expect(holdsList.getByRole('listitem')).toContainText('· position 1');
  });

  test('/student/notices shows a sent school-wide campaign', async ({ page, request }) => {
    test.slow();
    const tag = newTag();
    const s = await createStudent(request, { tag, n: 1 });
    const title = `SP Notice ${tag}`;
    const body = `SP body ${tag}`;
    // Sent last, right before the read: the list is newest first (LIMIT 30).
    const campaignId = await sendBroadcastCampaign(request, { name: title, body });

    const api = await getOk(request, '/student-portal/me/notices', studentHeaders(s.id));
    expect(api.data.find((notice) => notice.id === campaignId)).toMatchObject({ title, body });

    await openAsStudent(page, s);
    await page.goto('/student/notices', { waitUntil: 'domcontentloaded' });
    const screen = page.getByTestId('student-notices');
    await expectNoErrorFrame(screen);
    const row = screen.getByRole('listitem').filter({ hasText: title });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(body);
  });

  test('/student/pal shows the student’s practised skill', async ({ page, request }) => {
    test.slow();
    const tag = newTag();
    const s = await createStudent(request, { tag, n: 1 });
    const skillName = `SP skill ${tag}`;
    const skillId = await practiseSkill(request, { tag, name: skillName, studentId: s.id });

    const api = await getOk(request, '/student-portal/me/pal', studentHeaders(s.id));
    expect(api.data).toEqual([
      expect.objectContaining({ skillId, skillName, subject: 'Mathematics' }),
    ]);
    const item = api.data[0] as { bucket: string; mastery: number | null };

    await openAsStudent(page, s);
    await page.goto('/student/pal', { waitUntil: 'domcontentloaded' });
    const screen = page.getByTestId('student-pal');
    await expectNoErrorFrame(screen);
    const row = screen.getByRole('listitem').filter({ hasText: skillName });
    await expect(row).toHaveCount(1);
    const mastery = item.mastery == null ? '' : ` · mastery ${Math.round(item.mastery * 100)}%`;
    await expect(row).toContainText(`${item.bucket} · Mathematics${mastery}`);
  });

  test('/student/timetable shows the student’s published class meeting', async ({
    page,
    request,
  }) => {
    test.slow();
    const tag = newTag();
    const s = await createStudent(request, { tag, n: 1 });
    const sectionName = `SP Sec ${tag}`;
    const periodName = `SP P ${tag}`;
    const { sectionId } = await createTimetableMeeting(request, {
      tag,
      sectionName,
      periodName,
      studentIds: [s.id],
    });

    const api = await getOk(request, '/student-portal/me/timetable', studentHeaders(s.id));
    expect(api.data).toEqual([
      expect.objectContaining({ sectionId, sectionName, periodName, dayOfWeek: 1 }),
    ]);

    await openAsStudent(page, s);
    await page.goto('/student/timetable', { waitUntil: 'domcontentloaded' });
    const screen = page.getByTestId('student-timetable');
    await expectNoErrorFrame(screen);
    const grid = screen.getByTestId('timetable-weekly-grid');
    await expect(grid.getByText(sectionName, { exact: true })).toBeVisible();
    await expect(grid).toContainText(`${periodName} · 08:00`);
  });
});
