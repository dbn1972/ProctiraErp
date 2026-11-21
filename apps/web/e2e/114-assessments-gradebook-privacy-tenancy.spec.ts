import { expect, test, type Page } from '@playwright/test';

import {
  BACKEND_READY,
  BOARD_A,
  PERIOD_A,
  PERMISSION_DENIED_COPY,
  TENANT_A,
  TENANT_B,
  asAdmin,
  asParent,
  asStaff,
  asStudent,
  clickDom,
  createScheme,
  createSubject,
  createTeacher,
  defineItems,
  expectNotInPage,
  getJson,
  hydratedForm,
  linkParent,
  newTag,
  goto,
  openAs,
  pickStudent,
  probe,
  rank,
  screenUrls,
  seedReadSet,
  serverAction,
  type Persona,
  type Probe,
  type Row,
  type SeededReadSet,
} from './fixtures/assessments-gradebook-screens';

/**
 * Assessments + gradebook — privacy and tenancy negatives.
 *
 * Marks, grades, report cards and the students' national ids are child data. `beforeAll`
 * seeds one tenant-A data set (fixtures `seedReadSet(…, privacy)`): L1 has a published
 * `MATH` 88 and a draft `DRAFT` 50, L2 a published `MATH` 72; L1's guardian (a per-run
 * parent) is linked to L1 only. A second, smaller data set lives in tenant B.
 *
 * "Not shown" is checked against the page HTML (rendered text and the RSC payload), so
 * data that reaches the browser but is hidden also fails the test. Every negative has a
 * positive control (the tenant administrator does see the row).
 *
 * Known open defects are not asserted here (defects.md); their assertions live in
 * patches/ for the fix PRs: the national id in the gradebook pickers (P1), the `staff`
 * role seeing "Gradebook is unavailable" instead of the access-denied screen (R2), and
 * writes that reference another tenant's student or subject (P2, P3).
 */

const SCREENS_S1_TO_S7 = 7;

function rowsOf(r: Probe): Row[] {
  return (JSON.parse(r.body) as { data?: Row[] }).data ?? [];
}

test.describe('Assessments + gradebook privacy and tenancy — live (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires live gateway (E2E_BACKEND_READY)');

  const tag = newTag();
  const tagB = newTag();
  let a: SeededReadSet;
  const parent = asParent(`as-parent-${tag}`);
  const staff = asStaff(`as-staff-${tag}`);
  const adminB = asAdmin(TENANT_B);
  let student: Persona;
  let b: {
    scheme: { id: string; name: string };
    subject: { id: string; code: string; name: string };
    item: string;
  };

  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    a = await seedReadSet(request, tag, true);
    await linkParent(request, parent.sub, a.l1.id);
    student = asStudent(a.l1.id);
    const subjectB = await createSubject(request, adminB, `AS${tagB}B`, `AS ${tagB} B Maths`);
    const schemeB = await createScheme(request, adminB, `${rank()} AS ${tagB} B Scheme`);
    const itemsB = await defineItems(request, adminB, tagB, subjectB.id, schemeB.id);
    b = { scheme: schemeB, subject: subjectB, item: itemsB.midterm.id };
  });

  async function openFresh(page: Page, p: Persona) {
    await page.context().clearCookies();
    await openAs(page, p);
  }

  test('positive control: the administrator sees the seeded rows on S1, S8 and S9', async ({
    page,
  }) => {
    await openFresh(page, a.admin);
    await goto(page, `/assessments?search=${tag}`);
    await expect(page.getByRole('link', { name: a.scheme.name, exact: true })).toBeVisible();
    await goto(page, `/institutions/${a.institution.id}/gradebook?sectionId=${a.section.id}`);
    await expect(page.getByTestId('grade-entry-row')).toHaveCount(3);
    await expect(page.locator(`[data-entry-id="${a.l1Draft!.id}"]`)).toContainText(a.l1Draft!.code);
    await goto(page, `/institutions/${a.institution.id}/gradebook/report-cards/${a.job.id}`);
    await expect(page.getByTestId('report-card-preview')).toContainText(a.l1.name);
  });

  test('N1 student and parent get access denied and no seeded data on all nine screens; staff on S1–S7', async ({
    page,
  }) => {
    test.slow();
    const cases: Array<{ p: Persona; screens: number }> = [
      { p: student, screens: 9 },
      { p: parent, screens: 9 },
      { p: staff, screens: SCREENS_S1_TO_S7 },
    ];
    for (const { p, screens } of cases) {
      await openFresh(page, p);
      const role = p.roles[0]!.roleId;
      for (const { screen, url } of screenUrls(a).slice(0, screens)) {
        await goto(page, url);
        await expect
          .soft(page.getByTestId('route-access-denied'), `${role} ${screen}: access denied`)
          .toHaveCount(1, { timeout: 15_000 });
        await expect
          .soft(
            page.locator(
              '[data-testid="grading-scheme-form"], [data-testid="outcome-create-form"], [data-testid="grade-entry-form"], [data-testid="gradebook-workflow-panel"], [data-testid="report-card-preview"]',
            ),
            `${role} ${screen}: no domain forms`,
          )
          .toHaveCount(0);
        await expectNotInPage(page, `${role} ${screen}`, a.strings);
      }
    }
  });

  test('N1 staff on the gradebook screen gets no grade data and no grade forms', async ({
    page,
  }) => {
    await openFresh(page, staff);
    for (const { screen, url } of screenUrls(a).slice(SCREENS_S1_TO_S7)) {
      await goto(page, url);
      await expect
        .soft(page.getByTestId('grade-entry-form'), `staff ${screen}: no grade form`)
        .toHaveCount(0);
      await expect
        .soft(page.getByTestId('grade-entry-row'), `staff ${screen}: no grade rows`)
        .toHaveCount(0);
      await expectNotInPage(page, `staff ${screen}`, a.strings);
    }
  });

  test('N2 student, parent and staff are refused by the assessment and gradebook APIs the screens use', async ({
    request,
  }) => {
    const pair = `subjectId=${a.subject.id}&academicPeriodId=${PERIOD_A}`;
    const assessmentReads = [
      '/grading-schemes',
      `/grading-schemes/${a.scheme.id}`,
      `/assessment-items?${pair}`,
      `/outcomes?subjectId=${a.subject.id}`,
      `/results/grades?${pair}`,
      `/results/grades?${pair}&studentId=${a.l1.id}`,
    ];
    const gradebookStaffReads = [
      `/gradebook/sections?institutionId=${a.institution.id}`,
      '/gradebook/report-cards',
      `/gradebook/report-cards/${a.job.id}`,
      `/gradebook/rank?sectionId=${a.section.id}`,
    ];
    const writes: Array<['POST' | 'PUT' | 'DELETE', string, Row | undefined]> = [
      [
        'POST',
        '/grading-schemes',
        {
          name: `AS ${tag} N2`,
          type: 'numeric',
          minValue: 0,
          maxValue: 100,
          thresholds: [{ grade: 'A', minScore: 0, maxScore: 100 }],
        },
      ],
      ['PUT', `/grading-schemes/${a.scheme.id}`, { name: `AS ${tag} N2` }],
      ['DELETE', `/grading-schemes/${a.scheme.id}`, undefined],
      ['POST', '/outcomes', { subjectId: a.subject.id, code: `AS${tag}N2`, name: `AS ${tag} N2` }],
      [
        'POST',
        '/results/bulk',
        {
          subjectId: a.subject.id,
          academicPeriodId: PERIOD_A,
          results: [{ studentId: a.l1.id, assessmentItemId: a.items.final.id, score: 1 }],
        },
      ],
      [
        'PUT',
        '/gradebook/entries',
        {
          sectionId: a.section.id,
          studentId: a.l1.id,
          assessmentCode: a.l1Draft!.code,
          numericScore: 1,
        },
      ],
      ['POST', `/gradebook/entries/${a.l1Draft!.id}/transition`, { action: 'submit' }],
      ['POST', '/gradebook/report-cards', { studentId: a.l1.id, boardId: BOARD_A }],
    ];
    const cases: Array<{ p: Persona; paths: string[] }> = [
      { p: student, paths: [...assessmentReads, ...gradebookStaffReads] },
      { p: parent, paths: [...assessmentReads, ...gradebookStaffReads] },
      {
        p: staff,
        paths: [
          ...assessmentReads,
          ...gradebookStaffReads,
          `/gradebook/entries?sectionId=${a.section.id}`,
        ],
      },
    ];
    for (const { p, paths } of cases) {
      const role = p.roles[0]!.roleId;
      const results: Probe[] = [];
      for (const path of paths) results.push(await probe(request, p, 'GET', path));
      for (const [method, path, data] of writes) {
        results.push(await probe(request, p, method, path, data));
      }
      for (const r of results) {
        expect.soft(r.status, `${role} ${r.method} ${r.path}: ${r.body.slice(0, 200)}`).toBe(403);
        for (const s of a.strings) {
          expect.soft(r.body, `${role} ${r.method} ${r.path} body`).not.toContain(s);
        }
      }
    }
    // The refused writes changed nothing.
    const draft = (await getJson(request, a.admin, `/gradebook/entries?sectionId=${a.section.id}`))
      .data as Row[];
    expect(
      draft
        .map((e) => [e.assessmentCode, e.studentId, e.numericScore])
        .sort(
          (x, y) =>
            String(x[0]).localeCompare(String(y[0])) || String(x[1]).localeCompare(String(y[1])),
        ),
    ).toEqual(
      [
        [a.l1Draft!.code, a.l1.id, 50],
        [a.l1Math.code, a.l1.id, 88],
        [a.l2Math.code, a.l2.id, 72],
      ].sort(
        (x, y) =>
          String(x[0]).localeCompare(String(y[0])) || String(x[1]).localeCompare(String(y[1])),
      ),
    );
    const scheme = await getJson(request, a.admin, `/grading-schemes/${a.scheme.id}`);
    expect(scheme.name).toBe(a.scheme.name);
    const outcomes = (await getJson(request, a.admin, `/outcomes?subjectId=${a.subject.id}`))
      .data as Row[];
    expect(outcomes.map((o) => o.code)).toEqual([a.outcome.code]);
  });

  test("N3 a parent reads only the linked child's published grades; the student and parent never read another student's", async ({
    request,
  }) => {
    for (const p of [parent, student]) {
      const role = p.roles[0]!.roleId;
      for (const path of [
        `/gradebook/entries?studentId=${a.l2.id}`,
        `/gradebook/published?studentId=${a.l2.id}`,
        `/gradebook/gpa?studentId=${a.l2.id}`,
        '/gradebook/entries',
        '/gradebook/published',
        `/gradebook/entries?sectionId=${a.section.id}`,
      ]) {
        const r = await probe(request, p, 'GET', path);
        expect.soft(r.status, `${role} GET ${path}: ${r.body.slice(0, 200)}`).toBe(403);
        expect.soft(r.body, `${role} GET ${path} body`).not.toContain(a.l2Math.id);
      }
    }
    // The linked parent sees L1's published entry only: not L1's draft, not L2's entry.
    for (const path of [
      `/gradebook/entries?studentId=${a.l1.id}`,
      `/gradebook/published?studentId=${a.l1.id}`,
    ]) {
      const r = await probe(request, parent, 'GET', path);
      expect(r.status, `parent GET ${path}: ${r.body.slice(0, 200)}`).toBe(200);
      expect(rowsOf(r).map((e) => [e.id, e.numericScore])).toEqual([[a.l1Math.id, 88]]);
    }
    // Positive control: staff see all three entries of the section.
    const all = (await getJson(request, a.admin, `/gradebook/entries?sectionId=${a.section.id}`))
      .data as Row[];
    expect(all.map((e) => e.id).sort()).toEqual([a.l1Math.id, a.l2Math.id, a.l1Draft!.id].sort());
  });

  test("N4 tenant B sees none of tenant A's rows on screen or through the API, and cannot change them", async ({
    page,
    request,
  }) => {
    test.slow();
    const leaked = [...a.strings, a.scheme.id, a.l1.id, a.l2.id, a.section.id];
    await openFresh(page, adminB);
    // Positive control: tenant B's own scheme is listed.
    await goto(page, `/assessments?search=${tagB}`);
    await expect(page.getByRole('link', { name: b.scheme.name, exact: true })).toBeVisible();
    await goto(page, `/assessments?search=${tag}`);
    await expect(page.getByRole('link', { name: a.scheme.name, exact: true })).toHaveCount(0);
    await expectNotInPage(page, 'tenant B S1', leaked);
    const notFound = [
      `/assessments/schemes/${a.scheme.id}/edit`,
      `/institutions/${a.institution.id}/gradebook?sectionId=${a.section.id}`,
      `/institutions/${a.institution.id}/gradebook/report-cards/${a.job.id}`,
    ];
    for (const url of notFound) {
      await goto(page, url);
      await expect.soft(page.getByTestId('not-found-page'), `tenant B ${url}`).toHaveCount(1);
      await expectNotInPage(page, `tenant B ${url}`, a.strings);
    }
    // A's subject id in the URL falls back to tenant B's own subjects.
    await goto(page, `/assessments/outcomes?subjectId=${a.subject.id}`);
    await expect(page.getByTestId('outcome-row').filter({ hasText: a.outcome.code })).toHaveCount(
      0,
    );
    await expectNotInPage(page, 'tenant B S3', a.strings);
    for (const url of [
      `/assessments/items?subjectId=${a.subject.id}&academicPeriodId=${PERIOD_A}`,
      `/assessments/results?subjectId=${a.subject.id}&academicPeriodId=${PERIOD_A}`,
      `/assessments/report-cards?institutionId=${a.institution.id}`,
    ]) {
      await goto(page, url);
      await expectNotInPage(page, `tenant B ${url}`, a.strings);
    }

    const pair = `subjectId=${a.subject.id}&academicPeriodId=${PERIOD_A}`;
    const reads: Array<[string, number]> = [
      [`/grading-schemes/${a.scheme.id}`, 404],
      [`/gradebook/report-cards/${a.job.id}`, 404],
    ];
    for (const [path, status] of reads) {
      const r = await probe(request, adminB, 'GET', path);
      expect.soft(r.status, `tenant B GET ${path}`).toBe(status);
    }
    const emptyLists = [
      `/grading-schemes?search=${tag}`,
      `/assessment-items?${pair}`,
      `/outcomes?subjectId=${a.subject.id}`,
      `/gradebook/sections?institutionId=${a.institution.id}`,
      `/gradebook/entries?sectionId=${a.section.id}`,
      `/gradebook/published?studentId=${a.l1.id}`,
      `/gradebook/rank?sectionId=${a.section.id}`,
    ];
    for (const path of emptyLists) {
      const r = await probe(request, adminB, 'GET', path);
      expect.soft(r.status, `tenant B GET ${path}`).toBe(200);
      const body = JSON.parse(r.body) as { data?: Row[]; items?: Row[] };
      expect.soft(body.data ?? body.items, `tenant B GET ${path} is empty`).toEqual([]);
      for (const s of leaked) expect.soft(r.body, `tenant B GET ${path} body`).not.toContain(s);
    }
    const jobs = await probe(request, adminB, 'GET', '/gradebook/report-cards');
    expect.soft(jobs.body, 'tenant B job list').not.toContain(a.job.id);

    const writes: Array<['PUT' | 'DELETE' | 'POST', string, Row | undefined]> = [
      ['PUT', `/grading-schemes/${a.scheme.id}`, { name: `AS ${tagB} stolen` }],
      ['DELETE', `/grading-schemes/${a.scheme.id}`, undefined],
      [
        'PUT',
        '/gradebook/entries',
        { sectionId: a.section.id, studentId: a.l1.id, assessmentCode: 'X', numericScore: 1 },
      ],
      ['POST', `/gradebook/entries/${a.l1Draft!.id}/transition`, { action: 'submit' }],
      ['POST', `/gradebook/entries/${a.l1Math.id}/transition`, { action: 'reopen' }],
    ];
    for (const [method, path, data] of writes) {
      const r = await probe(request, adminB, method, path, data);
      expect.soft(r.status, `tenant B ${method} ${path}: ${r.body.slice(0, 200)}`).toBe(404);
      for (const s of a.strings) expect.soft(r.body, `tenant B ${method} ${path}`).not.toContain(s);
    }
    // A results write with A's student id against B's own item is a row error, not a save.
    const bulk = await probe(request, adminB, 'POST', '/results/bulk', {
      subjectId: b.subject.id,
      academicPeriodId: PERIOD_A,
      results: [{ studentId: a.l1.id, assessmentItemId: b.item, score: 10 }],
    });
    expect(bulk.status, bulk.body).toBe(200);
    const bulkBody = JSON.parse(bulk.body) as Row;
    expect([bulkBody.successCount, bulkBody.errorCount]).toEqual([0, 1]);

    // Tenant A's rows are unchanged.
    const scheme = await getJson(request, a.admin, `/grading-schemes/${a.scheme.id}`);
    expect(scheme.name).toBe(a.scheme.name);
    const entries = (
      await getJson(request, a.admin, `/gradebook/entries?sectionId=${a.section.id}`)
    ).data as Row[];
    expect(
      entries
        .map((e) => [e.id, e.numericScore, (e.metadata as Row).workflowStatus])
        .sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
    ).toEqual(
      [
        [a.l1Math.id, 88, 'PUBLISHED'],
        [a.l2Math.id, 72, 'PUBLISHED'],
        [a.l1Draft!.id, 50, 'DRAFT'],
      ].sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
    );
    const bResults = await probe(
      request,
      adminB,
      'GET',
      `/results/grades?subjectId=${b.subject.id}&academicPeriodId=${PERIOD_A}`,
    );
    expect(bResults.status).toBe(200);
    expect(rowsOf(bResults), 'tenant B recorded no result').toEqual([]);
  });

  test('N5 a forged X-Tenant-ID header is ignored in both directions', async ({ request }) => {
    const views: Array<[Persona, string, string, string, string]> = [
      [a.admin, TENANT_B, tag, a.scheme.id, b.scheme.id],
      [adminB, TENANT_A, tagB, b.scheme.id, a.scheme.id],
    ];
    for (const [viewer, forged, ownTag, ownId, otherId] of views) {
      const who = viewer.tenantId === TENANT_A ? 'tenant A' : 'tenant B';
      const extra = { 'X-Tenant-ID': forged };
      const own = await probe(
        request,
        viewer,
        'GET',
        `/grading-schemes?search=${ownTag}`,
        undefined,
        extra,
      );
      expect(own.status, `${who} + forged header`).toBe(200);
      expect(
        rowsOf(own).map((s) => s.id),
        `${who} still lists its own scheme`,
      ).toEqual([ownId]);
      const other = await probe(
        request,
        viewer,
        'GET',
        `/grading-schemes/${otherId}`,
        undefined,
        extra,
      );
      expect(other.status, `${who} + forged header GET other scheme`).toBe(404);
    }
    const forgedEntries = await probe(
      request,
      adminB,
      'GET',
      `/gradebook/entries?sectionId=${a.section.id}`,
      undefined,
      { 'X-Tenant-ID': TENANT_A },
    );
    expect(forgedEntries.status).toBe(200);
    expect(rowsOf(forgedEntries)).toEqual([]);
  });

  test('N6 student pickers and labels carry no date of birth or guardian phone (S5, S8); S5 no national id', async ({
    page,
  }) => {
    await openFresh(page, a.admin);
    const dobAndPhone = [
      a.l1.dateOfBirth,
      a.l2.dateOfBirth,
      a.l1.guardianPhone!,
      a.l2.guardianPhone!,
    ];
    await goto(page, `/assessments/results?subjectId=${a.subject.id}&academicPeriodId=${PERIOD_A}`);
    const option = page.locator(`option[value="${a.l1.id}"]`).first();
    await expect(option).toContainText(a.l1.name);
    await expectNotInPage(page, 'S5', [...dobAndPhone, a.l1.nationalId!, a.l2.nationalId!]);

    await goto(page, `/institutions/${a.institution.id}/gradebook?sectionId=${a.section.id}`);
    const picker = page
      .getByTestId('grade-entry-form')
      .locator(`#studentId option[value="${a.l1.id}"]`);
    await expect(picker).toContainText(a.l1.name);
    await expectNotInPage(page, 'S8', dobAndPhone);
  });

  test('N7 a teacher who does not teach the section cannot save a grade on the screen or the API', async ({
    page,
    request,
  }) => {
    const other = await createTeacher(
      request,
      a.admin,
      tag,
      'Other',
      a.institution.id,
      a.subject.id,
    );
    const code = `AS${tag}-N7`;
    const api = await probe(request, other.persona, 'PUT', '/gradebook/entries', {
      sectionId: a.section.id,
      studentId: a.l1.id,
      assessmentCode: code,
      numericScore: 60,
    });
    expect(api.status, api.body).toBe(403);

    // On screen the refused save shows the fixed permission copy and creates nothing.
    await openFresh(page, other.persona);
    await goto(page, `/institutions/${a.institution.id}/gradebook?sectionId=${a.section.id}`);
    const form = await hydratedForm(page, 'grade-entry-form');
    await pickStudent(form, 'studentId', a.l1);
    await form.locator('#assessmentCode').fill(code);
    await form.locator('#numericScore').fill('60');
    await serverAction(page, () => clickDom(form.getByRole('button', { name: 'Save grade' })));
    const alert = form.getByRole('alert');
    await expect(alert).toContainText(PERMISSION_DENIED_COPY);
    await expect(alert).toHaveText(/\(ref [A-Za-z0-9-]{8,64}\)$/);
    await expect(form.getByTestId('grade-save-message')).toHaveCount(0);
    const entries = (
      await getJson(request, a.admin, `/gradebook/entries?sectionId=${a.section.id}`)
    ).data as Row[];
    expect(entries.filter((e) => e.assessmentCode === code)).toEqual([]);
  });
});
