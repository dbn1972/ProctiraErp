import { expect, test, type Page } from '@playwright/test';

import {
  BACKEND_READY,
  PERIOD_A,
  asAdmin,
  chooseRadixOption,
  clickDom,
  createInstitution,
  createSection,
  createStudent,
  createSubject,
  createTeacher,
  ensureGradingBoard,
  getJson,
  hydratedForm,
  newTag,
  goto,
  openAs,
  pickStudent,
  probe,
  rank,
  reportCardJobsFor,
  serverAction,
  studentGrade,
  waitForReact,
  type Persona,
  type Row,
  type SeededSection,
  type SeededStudent,
  type SeededTeacher,
} from './fixtures/assessments-gradebook-screens';

/**
 * Assessments + gradebook — every write screen saves through its own form, and the
 * result is confirmed on screen and through the API (exact marks and grade letters).
 *
 * The spec seeds its own institution, subject, students, teacher and section in
 * `beforeAll` (it does not reuse spec 112's rows), then runs W1 → W7 in order: each step
 * uses what the previous one saved (the scheme created in W1 is edited in W2 and used by
 * the items of W3; W5 enters results against those items; W6 publishes the grade W7
 * puts on the report card).
 */

test.describe('Assessments + gradebook screens — write path (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires live gateway (E2E_BACKEND_READY)');
  test.describe.configure({ mode: 'serial' });

  const tag = newTag();
  const admin = asAdmin();
  let institution: { id: string; name: string };
  let subject: { id: string; code: string; name: string };
  let l1: SeededStudent;
  let l2: SeededStudent;
  let teacher: SeededTeacher;
  let section: SeededSection;
  let schemeId = '';
  let schemeName = '';
  let midtermName = '';
  let finalName = '';
  let entryId = '';

  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    ensureGradingBoard();
    institution = await createInstitution(request, admin, tag);
    subject = await createSubject(request, admin, `AS${tag}W`, `AS ${tag} Writing`);
    l1 = await createStudent(request, admin, tag, 'Learner', 1);
    l2 = await createStudent(request, admin, tag, 'Peer', 2);
    teacher = await createTeacher(request, admin, tag, 'Teacher', institution.id, subject.id);
    section = await createSection(request, admin, tag, institution.id, teacher.staffId, [
      l1.id,
      l2.id,
    ]);
  });

  async function schemesTagged(request: Parameters<typeof getJson>[0]): Promise<Row[]> {
    const body = await getJson(request, admin, `/grading-schemes?search=${tag}&pageSize=100`);
    return body.data as Row[];
  }

  test('W1 S7 /assessments/schemes/new creates a scheme; overlapping bands are refused', async ({
    page,
    request,
  }) => {
    await openAs(page, admin);
    await goto(page, '/assessments/schemes/new');
    await expect(page.getByRole('heading', { level: 1, name: 'New grading scheme' })).toBeVisible();
    const form = await hydratedForm(page, 'grading-scheme-form');
    schemeName = `${rank()} AS ${tag} New Scheme`;
    await form.locator('#name').fill(schemeName);
    const band = (i: number, field: string) => form.locator(`[id="thresholds.${i}.${field}"]`);
    // A 90–100, B 80–95 (overlaps A), C 0–79.99.
    await band(0, 'minScore').fill('90');
    await band(1, 'minScore').fill('80');
    await band(1, 'maxScore').fill('95');
    await band(2, 'maxScore').fill('79.99');
    await form.getByTestId('grading-scheme-submit').click();
    await expect(form.getByText('Overlaps the band ending at 95')).toBeVisible();
    await expect(page).toHaveURL(/\/assessments\/schemes\/new$/);
    expect(await schemesTagged(request), 'nothing created').toEqual([]);

    await band(1, 'maxScore').fill('89.99');
    await serverAction(page, () => form.getByTestId('grading-scheme-submit').click());
    await page.waitForURL(/\/assessments$/);
    await goto(page, `/assessments?search=${tag}`);
    const row = page
      .getByRole('table', { name: 'Grading schemes' })
      .locator('tbody tr')
      .filter({ hasText: schemeName });
    await expect(row).toHaveCount(1);
    await expect(row.locator('td').nth(2)).toHaveText('0 – 100');
    await expect(row.locator('td').nth(3)).toHaveText('3');

    const saved = await schemesTagged(request);
    expect(saved.map((s) => s.name)).toEqual([schemeName]);
    schemeId = String(saved[0]!.id);
    const scheme = await getJson(request, admin, `/grading-schemes/${schemeId}`);
    expect([scheme.type, scheme.minValue, scheme.maxValue]).toEqual(['numeric', 0, 100]);
    expect((scheme.thresholds as Row[]).map((t) => [t.grade, t.minScore, t.maxScore])).toEqual([
      ['A', 90, 100],
      ['B', 80, 89.99],
      ['C', 0, 79.99],
    ]);
  });

  test('W2 S6 /assessments/schemes/[id]/edit renames the scheme and moves its bands', async ({
    page,
    request,
  }) => {
    await openAs(page, admin);
    await goto(page, `/assessments/schemes/${schemeId}/edit`);
    const form = await hydratedForm(page, 'grading-scheme-form');
    await expect(form.locator('#name')).toHaveValue(schemeName);
    const renamed = `${rank()} AS ${tag} Renamed`;
    await form.locator('#name').fill(renamed);
    await form.locator('[id="thresholds.1.minScore"]').fill('70');
    await form.locator('[id="thresholds.2.maxScore"]').fill('69.99');
    await serverAction(page, () => form.getByTestId('grading-scheme-submit').click());
    await page.waitForURL(/\/assessments$/);
    await goto(page, `/assessments?search=${tag}`);
    const rows = page.getByRole('table', { name: 'Grading schemes' }).locator('tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.getByRole('link', { name: renamed, exact: true })).toBeVisible();
    schemeName = renamed;

    const scheme = await getJson(request, admin, `/grading-schemes/${schemeId}`);
    expect(scheme.name).toBe(renamed);
    expect((scheme.thresholds as Row[]).map((t) => [t.grade, t.minScore, t.maxScore])).toEqual([
      ['A', 90, 100],
      ['B', 70, 89.99],
      ['C', 0, 69.99],
    ]);
  });

  test('W3 S2 /assessments/items saves two weighted items; weights not summing to 100 are refused', async ({
    page,
    request,
  }) => {
    const url = `/assessments/items?subjectId=${subject.id}&academicPeriodId=${PERIOD_A}`;
    const itemsPath = `/assessment-items?subjectId=${subject.id}&academicPeriodId=${PERIOD_A}`;
    await openAs(page, admin);
    await goto(page, url);
    const form = page.locator('form').filter({ has: page.locator('#gradingSchemeId') });
    await waitForReact(form);
    await chooseRadixOption(page, 'gradingSchemeId', `${schemeName} (numeric)`);
    midtermName = `AS ${tag} Midterm`;
    finalName = `AS ${tag} Final`;
    const item = (i: number, field: string) => form.locator(`[id="items.${i}.${field}"]`);
    await item(0, 'name').fill(midtermName);
    await item(0, 'weight').fill('40');
    await item(0, 'maxScore').fill('50');
    await form.getByRole('button', { name: 'Add item' }).click();
    await item(1, 'name').fill(finalName);
    await item(1, 'weight').fill('50');
    await form.getByRole('button', { name: 'Save items' }).click();
    // The live total flags the gap; the submit-time message is missing today (V1, defects.md).
    await expect(form.getByRole('status').filter({ hasText: 'Total weight' })).toHaveText(
      'Total weight: 90.00% (-10.00%)',
    );
    await expect(form.getByRole('status').filter({ hasText: 'Saved' })).toHaveCount(0);
    expect((await getJson(request, admin, itemsPath)).items, 'nothing saved').toEqual([]);

    await item(1, 'weight').fill('60');
    await serverAction(page, () => form.getByRole('button', { name: 'Save items' }).click());
    await expect(form.getByRole('status').filter({ hasText: 'Saved' })).toHaveText(
      'Saved 2 items (total weight 100%).',
    );

    await goto(page, url);
    await expect(page.locator('#gradingSchemeId')).toHaveText(`${schemeName} (numeric)`);
    await expect(page.getByRole('group', { name: /^Assessment item \d+$/ })).toHaveCount(2);
    const shown: Record<string, string[]> = {};
    for (let i = 0; i < 2; i += 1) {
      shown[await page.locator(`[id="items.${i}.name"]`).inputValue()] = await Promise.all(
        ['weight', 'minScore', 'maxScore'].map((f) =>
          page.locator(`[id="items.${i}.${f}"]`).inputValue(),
        ),
      );
    }
    expect(shown).toEqual({ [midtermName]: ['40', '0', '50'], [finalName]: ['60', '0', '100'] });
    const saved = await getJson(request, admin, itemsPath);
    expect([saved.gradingSchemeId, saved.totalWeight]).toEqual([schemeId, 100]);
    expect(
      (saved.items as Row[])
        .map((i) => [i.name, i.weight, i.minScore, i.maxScore])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual([
      [finalName, 60, 0, 100],
      [midtermName, 40, 0, 50],
    ]);
  });

  test('W4 S3 /assessments/outcomes adds an outcome to the subject', async ({ page, request }) => {
    const code = `AS${tag}O2`;
    const name = `AS ${tag} Decimals`;
    let outcomeId = '';
    try {
      await openAs(page, admin);
      await goto(page, `/assessments/outcomes?subjectId=${subject.id}`);
      const form = await hydratedForm(page, 'outcome-create-form');
      await expect(form.getByTestId('outcome-subject')).toHaveValue(subject.id);
      await expect(page.getByTestId('outcomes-empty')).toBeVisible();
      await form.locator('#outcome-code').fill(code);
      await form.locator('#outcome-name').fill(name);
      await serverAction(page, () => form.getByTestId('add-outcome').click());
      await expect(page.getByTestId('outcome-row')).toHaveText([`${code} · ${name}`]);
      await goto(page, `/assessments/outcomes?subjectId=${subject.id}`);
      await expect(page.getByTestId('outcome-row')).toHaveText([`${code} · ${name}`]);
      const listed = (await getJson(request, admin, `/outcomes?subjectId=${subject.id}`))
        .data as Row[];
      expect(listed.map((o) => [o.code, o.name, o.subjectId])).toEqual([[code, name, subject.id]]);
      outcomeId = String(listed[0]!.id);
    } finally {
      const rows = (await getJson(request, admin, `/outcomes?subjectId=${subject.id}`))
        .data as Row[];
      for (const o of rows.filter((r) => r.code === code || r.id === outcomeId)) {
        const del = await probe(request, admin, 'DELETE', `/outcomes/${String(o.id)}`);
        expect(del.status, `DELETE /outcomes: ${del.body}`).toBe(204);
      }
    }
  });

  test('W5 S5 /assessments/results saves scores for a student; out-of-range scores are refused', async ({
    page,
    request,
  }) => {
    const url = `/assessments/results?subjectId=${subject.id}&academicPeriodId=${PERIOD_A}`;
    const gradesPath = `/results/grades?subjectId=${subject.id}&academicPeriodId=${PERIOD_A}`;
    await openAs(page, admin);
    await goto(page, url);
    const grid = page.getByRole('table', { name: 'Result entry grid' });
    const row = grid.locator('tbody tr');
    await expect(row).toHaveCount(1);
    const select = row.locator('select');
    await waitForReact(select);
    await select.selectOption(l1.id);
    const score = (itemName: string) => row.getByLabel(new RegExp(`^${itemName} score for `));
    await score(midtermName).fill('55');
    await page.getByRole('button', { name: 'Save scores' }).click();
    await expect(row.getByRole('alert')).toHaveText(
      `${midtermName}: score 55 is outside the item range [0, 50]`,
    );
    await expect(page.getByRole('alert').filter({ hasText: 'No valid score' })).toHaveText(
      'No valid score entries to save.',
    );
    expect((await getJson(request, admin, gradesPath)).data, 'nothing saved').toEqual([]);

    await score(midtermName).fill('45');
    await score(finalName).fill('80');
    await serverAction(page, () => page.getByRole('button', { name: 'Save scores' }).click());
    await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toHaveText(
      'Saved 2 of 2 results.',
    );

    await goto(page, url);
    await expect(grid.locator('tbody tr')).toHaveCount(1);
    await expect(grid.locator('select')).toHaveValue(l1.id);
    await expect(score(midtermName)).toHaveValue('45');
    await expect(score(finalName)).toHaveValue('80');
    // 45/50 = 90% × 40 + 80/100 = 80% × 60 → 84 → B (W2 bands: B 70–89.99).
    const g = await studentGrade(request, admin, subject.id, l1.id);
    expect([g.weightedAverage, g.grade, g.complete]).toEqual([84, 'B', true]);
  });

  async function openGradebook(page: Page, p: Persona) {
    await page.context().clearCookies();
    await openAs(page, p);
    await goto(page, `/institutions/${institution.id}/gradebook?sectionId=${section.id}`);
    await expect(page.getByTestId('gradebook-section-name')).toHaveText(
      `${section.code} · ${section.name}`,
    );
    await hydratedForm(page, 'gradebook-workflow-panel');
  }

  test('W6 S8 /institutions/[id]/gradebook: teacher saves and submits a grade; admin publishes and ranks', async ({
    page,
    request,
  }) => {
    test.slow();
    const code = `AS${tag}-ENG`;
    const remark = `AS ${tag} remark`;
    await openGradebook(page, teacher.persona);
    await expect(page.getByTestId('gradebook-empty')).toBeVisible();
    const form = await hydratedForm(page, 'grade-entry-form');
    await pickStudent(form, 'studentId', l1);
    await form.locator('#assessmentCode').fill(code);
    await form.locator('#numericScore').fill('91');
    await form.getByTestId('grade-remark').fill(remark);
    await serverAction(page, () => form.getByRole('button', { name: 'Save grade' }).click());
    await expect(form.getByTestId('grade-save-message')).toContainText('Grade saved for ');
    await expect(form.getByTestId('grade-save-message')).toContainText(`${l1.name}.`);

    await goto(page, `/institutions/${institution.id}/gradebook?sectionId=${section.id}`);
    await hydratedForm(page, 'gradebook-workflow-panel');
    const row = page.getByTestId('grade-entry-row').filter({ hasText: code });
    await expect(row).toHaveCount(1);
    entryId = String(await row.getAttribute('data-entry-id'));
    await expect(row.locator('td').nth(1)).toContainText(l1.name);
    await expect(row.locator('td').nth(3)).toHaveText('91');
    await expect(row).toHaveAttribute('data-workflow', 'DRAFT');
    await expect(page.getByTestId(`workflow-${entryId}`)).toContainText(remark);
    await serverAction(page, () => clickDom(page.getByTestId(`transition-submit-${entryId}`)));
    await expect(row).toHaveAttribute('data-workflow', 'SUBMITTED');
    await expect(page.getByTestId(`transition-approve-${entryId}`)).toHaveCount(0);

    await openGradebook(page, admin);
    for (const [action, next] of [
      ['approve', 'APPROVED'],
      ['lock', 'LOCKED'],
      ['publish', 'PUBLISHED'],
    ] as const) {
      await clickDom(page.getByTestId(`transition-${action}-${entryId}`));
      await serverAction(page, () =>
        clickDom(page.getByTestId('gradebook-workflow-confirm-confirm')),
      );
      await expect(page.locator(`[data-entry-id="${entryId}"]`)).toHaveAttribute(
        'data-workflow',
        next,
      );
    }
    await expect(page.getByTestId(`workflow-${entryId}`)).toContainText('Published');
    const published = (await getJson(request, admin, `/gradebook/published?studentId=${l1.id}`))
      .data as Row[];
    expect(published.map((e) => [e.id, e.assessmentCode, e.numericScore])).toEqual([
      [entryId, code, 91],
    ]);

    // One student has entries in the section: 91 → A (10 grade points, 1 credit).
    await serverAction(page, () => clickDom(page.getByTestId('compute-class-rank')));
    await expect(page.getByTestId('gradebook-workflow-message')).toHaveText(
      'Class rank computed for 1 students.',
    );
    await expect(page.getByTestId(`rank-${l1.id}`)).toHaveText('1');
    await expect(page.getByTestId(`cgpa-${l1.id}`)).toHaveText('10');

    const gpaForm = page.locator('form').filter({ has: page.locator('#gpaStudentId') });
    await pickStudent(gpaForm, 'gpaStudentId', l1);
    await serverAction(page, () => gpaForm.getByRole('button', { name: 'Compute GPA' }).click());
    await expect(gpaForm.locator('p').filter({ hasText: 'GPA snapshot saved' })).toHaveText(
      'GPA snapshot saved · weighted 10 · unweighted 10 · credits 1',
    );
    const gpa = (await getJson(request, admin, `/gradebook/gpa?studentId=${l1.id}`)).data as Row[];
    expect(gpa.map((s) => [s.weightedGpa, s.unweightedGpa, s.creditsEarned])).toEqual([
      [10, 10, 1],
    ]);
  });

  test('W7 S8 → S9: admin generates a report card and opens its preview', async ({
    page,
    request,
  }) => {
    expect(await reportCardJobsFor(request, admin, l1.id), 'no earlier card').toEqual([]);
    await openGradebook(page, admin);
    const form = page.locator('form').filter({ has: page.locator('#rcStudentId') });
    await waitForReact(form);
    await pickStudent(form, 'rcStudentId', l1);
    await serverAction(page, () =>
      form.getByRole('button', { name: 'Generate report card' }).click(),
    );
    await expect(form.locator('p').filter({ hasText: 'Report card queued' })).toContainText(
      `Report card queued for `,
    );
    await expect(form.locator('p').filter({ hasText: 'Report card queued' })).toContainText(
      `${l1.name}.`,
    );
    const jobs = await reportCardJobsFor(request, admin, l1.id);
    expect(jobs.map((j) => [j.status, j.institutionId, (j.metadata as Row).gradeCount])).toEqual([
      ['SUCCEEDED', institution.id, 1],
    ]);
    const jobId = String(jobs[0]!.id);

    await goto(page, `/institutions/${institution.id}/gradebook?sectionId=${section.id}`);
    const link = page.getByTestId(`report-card-link-${jobId}`);
    await expect(link).toHaveCount(1);
    await clickDom(link);
    await page.waitForURL(`**/institutions/${institution.id}/gradebook/report-cards/${jobId}`);
    const card = page.getByTestId('report-card-preview');
    await expect(card).toContainText('Preview only');
    await expect(card).toContainText(l1.name);
    await expect(card).toContainText('1 published grade included.');
  });
});
