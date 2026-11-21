import { expect, test, type Page } from '@playwright/test';

import {
  BACKEND_READY,
  PERIOD_A,
  getRows,
  newTag,
  goto,
  openAs,
  seedReadSet,
  studentGrade,
  type SeededReadSet,
} from './fixtures/assessments-gradebook-screens';

/**
 * Assessments + gradebook — every screen shows rows written through the live API
 * (screen → API → DB), with exact marks, percentages and grade letters.
 *
 * `beforeAll` seeds one data set with a unique tag (fixtures/assessments-gradebook-screens.ts):
 * a numeric 0–100 scheme (A 90–100, B 75–89.99, C 0–74.99), Midterm (40%, 0–50) and Final
 * (60%, 0–100), results L1 45 + 80 and L2 20, one outcome, a section with L1 and L2,
 * gradebook entries L1 88 (published) and L2 72 (draft), class rank and one report card
 * for L1. Each test opens one screen as a tenant administrator (S8 also as the section's
 * teacher) and finds this run's rows by their unique strings.
 *
 * Not asserted, because the value shown today is wrong (defects.md): the gradebook Letter
 * column (G1, always "—"), the weighted average / grade on the results screen (G2, not
 * shown; asserted through the API instead), the report-card term (G3), and GPA for a
 * student with draft entries (PRC-M268).
 */

function textOf(page: Page, testId: string) {
  return page.getByTestId(testId);
}

test.describe('Assessments + gradebook screens — read path (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires live gateway (E2E_BACKEND_READY)');

  let d: SeededReadSet;
  const tag = newTag();

  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    d = await seedReadSet(request, tag);
  });

  test.beforeEach(async ({ page }) => {
    await openAs(page, d.admin);
  });

  test('S1 /assessments lists the seeded scheme with type, range and band count', async ({
    page,
  }) => {
    await goto(page, `/assessments?search=${tag}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Assessment schemes' })).toBeVisible();
    const rows = page.getByRole('table', { name: 'Grading schemes' }).locator('tbody tr');
    const row = rows.filter({ hasText: d.scheme.name });
    await expect(row).toHaveCount(1);
    const cells = row.locator('td');
    await expect(cells.nth(0)).toContainText('3 grade bands · Numeric scale');
    await expect(cells.nth(1)).toHaveText('Numeric');
    await expect(cells.nth(2)).toHaveText('0 – 100');
    await expect(cells.nth(3)).toHaveText('3');
    await expect(row.getByRole('link', { name: d.scheme.name, exact: true })).toHaveAttribute(
      'href',
      `/assessments/schemes/${d.scheme.id}/edit`,
    );
  });

  test('S2 /assessments/items preloads the seeded items and scheme for the subject and period', async ({
    page,
  }) => {
    await goto(page, `/assessments/items?subjectId=${d.subject.id}&academicPeriodId=${PERIOD_A}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Assessment items' })).toBeVisible();
    await expect(page.locator('#gradingSchemeId')).toHaveText(`${d.scheme.name} (numeric)`);
    await expect(page.locator('#subjectId')).toHaveText(`${d.subject.name} (${d.subject.code})`);
    const groups = page.getByRole('group', { name: /^Assessment item \d+$/ });
    await expect(groups).toHaveCount(2);
    const seen: Record<string, string[]> = {};
    for (let i = 0; i < 2; i += 1) {
      const name = await page.locator(`[id="items.${i}.name"]`).inputValue();
      seen[name] = await Promise.all(
        ['weight', 'minScore', 'maxScore'].map((f) =>
          page.locator(`[id="items.${i}.${f}"]`).inputValue(),
        ),
      );
    }
    expect(seen).toEqual({
      [d.items.midterm.name]: ['40', '0', '50'],
      [d.items.final.name]: ['60', '0', '100'],
    });
    await expect(page.getByText('Total weight: 100.00%')).toBeVisible();
  });

  test('S3 /assessments/outcomes lists the seeded outcome for the subject', async ({ page }) => {
    await goto(page, `/assessments/outcomes?subjectId=${d.subject.id}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Learning outcomes' })).toBeVisible();
    await expect(textOf(page, 'outcomes-subject-name')).toHaveText(
      `${d.subject.code} — ${d.subject.name}`,
    );
    await expect(textOf(page, 'outcome-row')).toHaveCount(1);
    await expect(textOf(page, 'outcome-row')).toHaveText(`${d.outcome.code} · ${d.outcome.name}`);
  });

  test('S4 /assessments/report-cards counts entries and published grades for the seeded class', async ({
    page,
  }) => {
    await goto(page, `/assessments/report-cards?institutionId=${d.institution.id}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Report cards' })).toBeVisible();
    await expect(page.getByLabel('Institution')).toHaveValue(d.institution.id);
    const row = textOf(page, 'report-card-class-row');
    await expect(row).toHaveCount(1);
    const cells = row.locator('td');
    await expect(cells.nth(0)).toHaveText(`${d.section.code} — ${d.section.name}`);
    await expect(cells.nth(1)).toHaveText('2');
    await expect(cells.nth(2)).toHaveText('1');
    await expect(row.getByRole('link', { name: 'Gradebook' })).toHaveAttribute(
      'href',
      `/institutions/${d.institution.id}/gradebook?sectionId=${d.section.id}`,
    );
    // The job list shows the 20 newest jobs; this run's job was just created.
    const job = textOf(page, 'report-card-job').filter({
      has: page.locator(`time[datetime="${d.job.createdAt}"]`),
    });
    await expect(job).toHaveCount(1);
    await expect(job).toContainText('Report card · SUCCEEDED ·');
    await expect(job).toContainText('· Artifact ready');
  });

  test('S5 /assessments/results shows the seeded scores; the API grades them exactly', async ({
    page,
    request,
  }) => {
    await goto(page, `/assessments/results?subjectId=${d.subject.id}&academicPeriodId=${PERIOD_A}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Result entry' })).toBeVisible();
    await expect(page.getByText(`Grading scheme: ${d.scheme.name} (range 0–100).`)).toBeVisible();
    const grid = page.getByRole('table', { name: 'Result entry grid' });
    await expect(grid.locator('tbody tr')).toHaveCount(2);
    const rowFor = (studentId: string) =>
      grid
        .locator('tbody tr')
        .filter({ has: page.locator(`option[value="${studentId}"]:checked`) });
    const score = (studentId: string, itemName: string) =>
      rowFor(studentId).getByLabel(new RegExp(`^${itemName} score for `));
    await expect(rowFor(d.l1.id).locator('select option:checked')).toContainText(d.l1.name);
    await expect(score(d.l1.id, d.items.midterm.name)).toHaveValue('45');
    await expect(score(d.l1.id, d.items.final.name)).toHaveValue('80');
    await expect(rowFor(d.l2.id).locator('select option:checked')).toContainText(d.l2.name);
    await expect(score(d.l2.id, d.items.midterm.name)).toHaveValue('20');
    await expect(score(d.l2.id, d.items.final.name)).toHaveValue('');

    // 45/50 = 90% × 40 + 80/100 = 80% × 60 → 84 → B (75–89.99). The screen does not show it (G2).
    const g1 = await studentGrade(request, d.admin, d.subject.id, d.l1.id);
    expect([g1.weightedAverage, g1.grade, g1.complete, g1.coverage]).toEqual([84, 'B', true, 1]);
    // 20/50 = 40%, only Midterm entered: pro-rated 40 → C (0–74.99), incomplete, 40% coverage.
    const g2 = await studentGrade(request, d.admin, d.subject.id, d.l2.id);
    expect([g2.weightedAverage, g2.grade, g2.complete, g2.coverage]).toEqual([40, 'C', false, 0.4]);
  });

  test('S6 /assessments/schemes/[id]/edit prefills the seeded scheme exactly', async ({ page }) => {
    await goto(page, `/assessments/schemes/${d.scheme.id}/edit`);
    await expect(
      page.getByRole('heading', { level: 1, name: `Edit ${d.scheme.name}` }),
    ).toBeVisible();
    await expect(page.locator('#name')).toHaveValue(d.scheme.name);
    await expect(page.locator('#type')).toContainText('Numeric (score-based)');
    await expect(page.locator('#minValue')).toHaveValue('0');
    await expect(page.locator('#maxValue')).toHaveValue('100');
    await expect(page.getByRole('group', { name: /^Threshold \d+$/ })).toHaveCount(3);
    const expected = [
      ['A', '90', '100'],
      ['B', '75', '89.99'],
      ['C', '0', '74.99'],
    ];
    for (const [i, [grade, min, max]] of expected.entries()) {
      await expect(page.locator(`[id="thresholds.${i}.grade"]`)).toHaveValue(grade!);
      await expect(page.locator(`[id="thresholds.${i}.minScore"]`)).toHaveValue(min!);
      await expect(page.locator(`[id="thresholds.${i}.maxScore"]`)).toHaveValue(max!);
    }
  });

  for (const who of ['admin', 'teacher'] as const) {
    test(`S8 /institutions/[id]/gradebook shows the seeded entries, rank and report card (${who})`, async ({
      page,
    }) => {
      if (who === 'teacher') {
        await page.context().clearCookies();
        await openAs(page, d.teacher.persona);
      }
      await goto(page, `/institutions/${d.institution.id}/gradebook?sectionId=${d.section.id}`);
      await expect(page.getByRole('heading', { level: 2, name: 'Gradebook' })).toBeVisible();
      await expect(textOf(page, 'gradebook-section-name')).toHaveText(
        `${d.section.code} · ${d.section.name}`,
      );
      const rows = textOf(page, 'grade-entry-row');
      await expect(rows).toHaveCount(2);
      const l1 = page.locator(`[data-entry-id="${d.l1Math.id}"]`);
      const cells1 = l1.locator('td');
      await expect(cells1.nth(1)).toContainText(d.l1.name);
      await expect(cells1.nth(2)).toHaveText(d.l1Math.code);
      await expect(cells1.nth(3)).toHaveText('88');
      await expect(l1).toHaveAttribute('data-workflow', 'PUBLISHED');
      await expect(textOf(page, `workflow-${d.l1Math.id}`)).toContainText('Published');
      await expect(textOf(page, `workflow-${d.l1Math.id}`)).toContainText(d.remark);
      // Only L1's entry (88 → B, 8 grade points) is published; L1 is first of two.
      await expect(l1.getByTestId(`rank-${d.l1.id}`)).toHaveText('1');
      await expect(l1.getByTestId(`cgpa-${d.l1.id}`)).toHaveText('8');
      const l2 = page.locator(`[data-entry-id="${d.l2Math.id}"]`);
      const cells2 = l2.locator('td');
      await expect(cells2.nth(1)).toContainText(d.l2.name);
      await expect(cells2.nth(2)).toHaveText(d.l2Math.code);
      await expect(cells2.nth(3)).toHaveText('72');
      await expect(l2).toHaveAttribute('data-workflow', 'DRAFT');
      await expect(textOf(page, `workflow-${d.l2Math.id}`)).toContainText('Draft');

      const job = textOf(page, 'report-card-jobs')
        .locator('li')
        .filter({ has: page.getByTestId(`report-card-link-${d.job.id}`) });
      await expect(job).toHaveCount(1);
      await expect(job).toContainText('Done');
      await expect(job).toContainText(`Report card · `);
      await expect(job).toContainText(d.l1.name);
      await expect(job.getByTestId(`report-card-link-${d.job.id}`)).toHaveAttribute(
        'href',
        `/institutions/${d.institution.id}/gradebook/report-cards/${d.job.id}`,
      );
    });
  }

  test('S9 /institutions/[id]/gradebook/report-cards/[jobId] previews the seeded card', async ({
    page,
    request,
  }) => {
    const listed = (await getRows(request, d.admin, '/gradebook/report-cards')).find(
      (job) => job.id === d.job.id,
    );
    expect(listed?.status).toBe('SUCCEEDED');
    expect((listed?.metadata as Record<string, unknown>).gradeCount).toBe(1);
    await goto(page, `/institutions/${d.institution.id}/gradebook/report-cards/${d.job.id}`);
    const card = textOf(page, 'report-card-preview');
    await expect(card.getByRole('heading', { level: 1, name: 'Report card' })).toBeVisible();
    await expect(card).toContainText('Preview only');
    await expect(card).toContainText(d.l1.name);
    await expect(card).toContainText('1 published grade included.');
  });
});
