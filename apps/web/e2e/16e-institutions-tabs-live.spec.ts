/**
 * Live Sunrise gradebook, curriculum, and infrastructure tabs.
 * Requires Postgres seeded with db/seeds/006, the gateway, Redis, and E2E_BACKEND_READY=1.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect as playwrightExpect, test, type Locator, type Page } from '@playwright/test';

const expect = playwrightExpect.configure({ timeout: 20_000 });

import { setupGatewayTenantSession } from './fixtures/fake-session';
import { runAxe } from './helpers/axe';
import { cleanupSunriseE2E } from './helpers/sunrise-e2e-cleanup';

const BACKEND_READY = process.env.E2E_BACKEND_READY === '1';
const SUNRISE = '00000000-0000-4000-8000-00000000a501';
const MAYUR = '00000000-0000-4000-8000-00000000a551';
const MATH = '00000000-0000-4000-8000-00000000a581';
const GRADE9 = '00000000-0000-4000-8000-00000000a542';
const TERM = '00000000-0000-4000-8000-00000000a531';
const CAPTURES = join(process.cwd(), '../../docs/audits/captures/institutions-tabs');
/**
 * CI serves `next dev` on a 2-core runner shared with the gateway, Postgres,
 * Redis and other workers, so a server action (or the `router.refresh()` RSC
 * render after it) can stall well past the 20s expect default while another
 * worker's route compiles. Each write waits on its own action response with
 * this ceiling, then asserts the re-rendered UI with the same ceiling.
 */
const ACTION_TIMEOUT = 60_000;

/** Unique per attempt so a retry never matches a row a previous attempt wrote. */
function stampFor(retry: number) {
  return `${Date.now().toString(36)}${retry}`;
}

test.describe('Institution detail tabs — Sunrise live', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1, gateway, and the Sunrise seed');
  test.setTimeout(300_000);

  test.beforeEach(async ({ page }) => {
    mkdirSync(CAPTURES, { recursive: true });
    await setupGatewayTenantSession(page, {
      sub: 'priya-sharma',
      email: 'priya.sharma@school.edu',
      displayName: 'Priya Sharma',
      tenantId: SUNRISE,
      roles: [{ roleId: 'principal', roleName: 'Principal', areaId: null }],
    });
  });

  // One test per tab: each owns disjoint rows (and cleans only those), so the
  // tabs can run in parallel workers and a retry re-runs only the failed tab.
  test('gradebook writes persist', async ({ page }, testInfo) => {
    cleanupSunriseE2E('gradebook');
    try {
      const stamp = stampFor(testInfo.retry);
      await exerciseGradebook(page, '77', `E2E${stamp.slice(-7)}`);
    } finally {
      cleanupSunriseE2E('gradebook');
    }
  });

  test('curriculum writes persist', async ({ page }, testInfo) => {
    cleanupSunriseE2E('curriculum');
    try {
      const stamp = stampFor(testInfo.retry);
      const lesson = `E2E lesson ${stamp}`;
      await exerciseCurriculum(
        page,
        lesson,
        `${lesson} edited`,
        `M9.${stamp.slice(-5).toUpperCase()}`,
      );
    } finally {
      cleanupSunriseE2E('curriculum');
    }
  });

  test('infrastructure writes persist', async ({ page }, testInfo) => {
    cleanupSunriseE2E('infrastructure');
    try {
      const stamp = stampFor(testInfo.retry);
      await exerciseInfrastructure(
        page,
        `E2E Room ${stamp.slice(-5)}`,
        `E2E ceiling leak ${stamp}`,
      );
    } finally {
      cleanupSunriseE2E('infrastructure');
    }
  });
});

/**
 * Runs `trigger` and waits for the Next server action POST it fires on the
 * current route. The UI assertions that follow then only cover the re-render.
 */
async function serverAction(page: Page, trigger: () => Promise<void>) {
  const path = new URL(page.url()).pathname;
  const response = page.waitForResponse(
    async (res) =>
      res.request().method() === 'POST' &&
      new URL(res.url()).pathname === path &&
      (await res.request().headerValue('next-action')) !== null,
    { timeout: ACTION_TIMEOUT },
  );
  await trigger();
  const res = await response;
  expect(res.status(), `server action POST ${path}`).toBe(200);
}

async function waitForShell(page: Page, width: number) {
  await expect(page.getByTestId('header-user-skeleton')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /Mayur Vihar/ })).toBeVisible();
  if (width >= 768) {
    if (width < 1024) {
      await page.getByRole('button', { name: 'Open navigation menu' }).click();
    }
    await expect(page.getByTestId('tenant-switcher-skeleton')).toHaveCount(0);
    await expect(page.getByTestId('tenant-switcher')).toContainText('Delhi East');
    await expect(page.getByTestId('tenant-switcher')).toContainText('1,240');
    const crumb = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(crumb).toContainText('Mayur Vihar');
    await expect(crumb).not.toContainText('00000000');
    if (width < 1024) {
      await page.getByRole('button', { name: 'Close navigation menu' }).click();
      await expect(page.getByRole('button', { name: 'Close navigation menu' })).toHaveCount(0);
      const drawer = page.locator('[data-shell="desktop"] > div').first();
      await expect(drawer).toHaveAttribute('aria-hidden', 'true');
      await expect
        .poll(async () => drawer.evaluate((el) => Math.round(el.getBoundingClientRect().right)))
        .toBeLessThanOrEqual(0);
    }
  }
}

async function shoot(page: Page, name: string, width: number) {
  await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
  await waitForShell(page, width);
  const scroll = page.locator('[data-shell-scroll="page"]');
  await scroll.evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.waitForFunction(
    () => {
      const root = document.querySelector<HTMLElement>(
        '[data-testid="institution-gradebook"], [data-testid="institution-curriculum"], [data-testid="institution-infrastructure"]',
      );
      return Boolean(root && root.offsetHeight > 400);
    },
    undefined,
    { timeout: 15_000 },
  );
  const scrollHeight = await scroll.evaluate((el) => el.scrollHeight);
  const chrome = width < 500 ? 160 : 80;
  await page.setViewportSize({
    width,
    height: Math.min(Math.max(scrollHeight + chrome, width < 500 ? 844 : 900), 9000),
  });
  await scroll.evaluate((el) => {
    el.scrollTop = 0;
  });
  if (width >= 768 && width < 1024) {
    const drawer = page.locator('[data-shell="desktop"] > div').first();
    await expect
      .poll(async () => drawer.evaluate((el) => Math.round(el.getBoundingClientRect().right)))
      .toBeLessThanOrEqual(0);
  }
  await page.screenshot({
    path: join(CAPTURES, `${name}-${width}.png`),
    fullPage: true,
  });
}

async function waitHydrated(page: Page, testId: string) {
  await expect(page.getByTestId(testId).filter({ visible: true })).toHaveAttribute(
    'data-hydrated',
    'true',
  );
}

async function confirm(page: Page, testId: string) {
  const button = page.getByTestId(`${testId}-confirm`).filter({ visible: true });
  await expect(button).toBeVisible();
  await clickDom(button);
}

/** Dev RSC refreshes replace the node between actionability checks. Dispatch in-page. */
async function clickDom(locator: Locator) {
  await expect(locator).toBeVisible();
  await locator.evaluate((el) => {
    (el as HTMLElement).click();
  });
}

async function exerciseGradebook(page: Page, score: string, assessmentCode: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/institutions/${MAYUR}/gradebook`, { waitUntil: 'domcontentloaded' });
  const root = page.getByTestId('institution-gradebook').filter({ visible: true });
  await expect(root).toBeVisible();
  // PRC-L041: the default section comes from the active academic period, not
  // the G9B-MATH seed code; Aarav Mehta is asserted after selecting G9B-MATH.
  await expect(page.getByTestId('gradebook-section-name').filter({ visible: true })).toBeVisible();
  await expect(root).not.toContainText('db/sql');
  await expect(root).not.toContainText('db/seeds');
  await expect(root.getByText(/^E2E/)).toHaveCount(0);
  await waitForShell(page, 1440);
  await runAxe(page);
  await shoot(page, 'gradebook', 1440);
  await shoot(page, 'gradebook', 834);
  await shoot(page, 'gradebook', 390);

  await page.setViewportSize({ width: 1440, height: 900 });
  await waitForShell(page, 1440);
  const picker = page.getByTestId('gradebook-section-picker').filter({ visible: true });
  await expect(picker).toBeVisible();
  const labels = await picker.locator('option').allTextContents();
  const other = labels.find((label) => label.includes('G9B-SCI'));
  if (other) {
    const value = await picker.locator('option', { hasText: other }).first().getAttribute('value');
    expect(value).toBeTruthy();
    await picker.selectOption(value!);
    await expect(page).toHaveURL(new RegExp(`sectionId=${value}`), { timeout: 20_000 });
    await expect(
      page.getByTestId('gradebook-section-name').filter({ visible: true }),
    ).toContainText('G9B-SCI');
  }
  const math = labels.find((label) => label.includes('G9B-MATH'));
  expect(math).toBeTruthy();
  const mathPicker = page.getByTestId('gradebook-section-picker').filter({ visible: true });
  await expect(mathPicker).toBeVisible();
  const mathValue = await mathPicker
    .locator('option', { hasText: math! })
    .first()
    .getAttribute('value');
  expect(mathValue).toBeTruthy();
  await mathPicker.selectOption(mathValue!);
  try {
    await expect(page).toHaveURL(new RegExp(`sectionId=${mathValue}`), { timeout: 10_000 });
  } catch {
    // Soft-nav can stall under production RSC; the picker change already fired.
    await page.goto(`/institutions/${MAYUR}/gradebook?sectionId=${mathValue}`, {
      waitUntil: 'domcontentloaded',
    });
  }
  await expect(page.getByTestId('gradebook-section-name').filter({ visible: true })).toContainText(
    'G9B-MATH',
  );
  const gradebook = page.getByTestId('institution-gradebook').filter({ visible: true });
  await expect(gradebook).toContainText('Aarav Mehta');

  await gradebook.locator('#studentId-search').fill('Mehta');
  const student = gradebook.locator('#studentId');
  const aaravOption = student.locator('option', { hasText: 'Aarav Mehta' });
  await expect(aaravOption.first()).toBeAttached();
  const studentLabels = await aaravOption.allTextContents();
  const aarav = studentLabels.find(
    (label) => label.includes('Aarav Mehta') && !label.startsWith('Selected'),
  );
  expect(aarav, studentLabels.join(' | ')).toBeTruthy();
  await student.selectOption({ label: aarav! });
  await gradebook.locator('#assessmentCode').fill(assessmentCode);
  await gradebook.locator('#numericScore').fill(score);
  await serverAction(page, () => gradebook.getByRole('button', { name: 'Save grade' }).click());
  await expect(gradebook.getByTestId('grade-save-message')).toContainText(/Grade saved for/, {
    timeout: ACTION_TIMEOUT,
  });
  await expect(gradebook.getByTestId('grade-save-message')).not.toContainText(
    /[0-9a-f]{8}-[0-9a-f]{4}-/i,
  );

  const entry = gradebook
    .getByTestId('grade-entry-row')
    .filter({ hasText: assessmentCode })
    .first();
  await expect(entry).toBeVisible({ timeout: ACTION_TIMEOUT });
  await serverAction(page, () => clickDom(entry.getByRole('button', { name: 'Submit' })));
  for (const [step, next] of [
    ['Approve', 'Lock'],
    ['Lock', 'Publish'],
    ['Publish', 'Unpublish'],
  ] as const) {
    await expect(entry.getByRole('button', { name: step })).toBeVisible({
      timeout: ACTION_TIMEOUT,
    });
    await clickDom(entry.getByRole('button', { name: step }));
    await serverAction(page, () => confirm(page, 'gradebook-workflow-confirm'));
    await expect(entry.getByRole('button', { name: next })).toBeVisible({
      timeout: ACTION_TIMEOUT,
    });
  }
  await clickDom(entry.getByRole('button', { name: 'Unpublish' }));
  await serverAction(page, () => confirm(page, 'gradebook-workflow-confirm'));
  await expect(entry).toContainText('Draft', { timeout: ACTION_TIMEOUT });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(
    page
      .getByTestId('institution-gradebook')
      .filter({ visible: true })
      .getByTestId('grade-entry-row')
      .filter({ hasText: assessmentCode })
      .first(),
  ).toContainText('Draft');

  await page.goto(
    `/institutions/${MAYUR}/gradebook/report-cards/892236cc-f3d8-5458-8770-6ee2b83c47be`,
    { waitUntil: 'domcontentloaded' },
  );
  await expect(page.getByRole('heading').first()).toBeVisible();
}

async function exerciseCurriculum(
  page: Page,
  lesson: string,
  lessonEdited: string,
  outcome: string,
) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(
    `/institutions/${MAYUR}/curriculum?subjectId=${MATH}&gradeId=${GRADE9}&academicPeriodId=${TERM}`,
    { waitUntil: 'domcontentloaded' },
  );
  const root = page.getByTestId('institution-curriculum').filter({ visible: true });
  await expect(root).toBeVisible();
  await waitHydrated(page, 'curriculum-panel');
  await expect(root).toContainText('Number systems');
  await expect(root).toContainText('M9.1');
  await expect(page.getByTestId('curriculum-apply-scope')).toHaveCount(0);
  await waitForShell(page, 1440);
  await runAxe(page);
  await shoot(page, 'curriculum', 1440);
  await shoot(page, 'curriculum', 834);
  await shoot(page, 'curriculum', 390);

  await page.setViewportSize({ width: 1440, height: 900 });
  const grade = page.getByTestId('curriculum-grade').filter({ visible: true });
  await grade.selectOption({ label: '8 — Class 8' });
  await expect(page).toHaveURL(/gradeId=00000000-0000-4000-8000-00000000a541/);
  await expect(page).not.toHaveURL(new RegExp(`gradeId=${GRADE9}`));
  await grade.selectOption({ label: '9 — Class 9' });
  await expect(page).toHaveURL(new RegExp(`gradeId=${GRADE9}`));
  await waitHydrated(page, 'curriculum-panel');

  const curriculumForm = page.getByTestId('institution-curriculum').filter({ visible: true });
  await curriculumForm.locator('#unit-code').fill('U1');
  await curriculumForm.locator('#unit-name').fill('Duplicate number systems');
  await serverAction(page, () => curriculumForm.getByTestId('add-syllabus-unit').click());
  await expect(curriculumForm.getByTestId('unit-form-error')).toBeVisible();
  await expect(curriculumForm.getByTestId('outcome-form-error')).toHaveCount(0);

  const unit = page
    .getByTestId('syllabus-unit-row')
    .filter({ hasText: 'Coordinate geometry' })
    .filter({ visible: true });
  const markTaught = unit.getByRole('button', { name: 'Mark taught', exact: true });
  const taughtButton = unit.getByRole('button', { name: 'Taught', exact: true });
  // Either label is the settled state; `isVisible()` alone does not wait.
  await expect(markTaught.or(taughtButton)).toBeVisible();
  if (await taughtButton.isVisible()) {
    await clickDom(taughtButton);
    await serverAction(page, () => confirm(page, 'curriculum-taught-confirm'));
    await expect(markTaught).toBeEnabled({ timeout: ACTION_TIMEOUT });
  }
  await clickDom(markTaught);
  await serverAction(page, () => confirm(page, 'curriculum-taught-confirm'));
  // The label flips only after the follow-up `router.refresh()` render lands.
  await expect(taughtButton).toBeEnabled({ timeout: ACTION_TIMEOUT });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitHydrated(page, 'curriculum-panel');
  const taught = page
    .getByTestId('syllabus-unit-row')
    .filter({ hasText: 'Coordinate geometry' })
    .filter({ visible: true });
  await expect(taught.getByRole('button', { name: 'Taught', exact: true })).toBeVisible();
  await clickDom(taught.getByRole('button', { name: 'Taught', exact: true }));
  await serverAction(page, () => confirm(page, 'curriculum-taught-confirm'));
  await expect(taught.getByRole('button', { name: 'Mark taught', exact: true })).toBeEnabled({
    timeout: ACTION_TIMEOUT,
  });

  await taught.locator('input[name="title"]').fill(lesson);
  await serverAction(page, () => taught.getByRole('button', { name: 'Add lesson' }).click());
  await expect(taught.getByText(lesson)).toBeVisible({ timeout: ACTION_TIMEOUT });
  page.once('dialog', (dialog) => dialog.accept(lessonEdited));
  await serverAction(page, () => taught.getByRole('button', { name: 'Edit' }).click());
  await expect(taught.getByText(lessonEdited)).toBeVisible({ timeout: ACTION_TIMEOUT });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitHydrated(page, 'curriculum-panel');
  const afterLesson = page
    .getByTestId('syllabus-unit-row')
    .filter({ hasText: 'Coordinate geometry' })
    .filter({ visible: true });
  await expect(afterLesson.getByText(lessonEdited)).toBeVisible();
  await serverAction(page, () =>
    afterLesson.getByRole('button', { name: 'Remove' }).first().click(),
  );
  await expect(afterLesson.getByText(lessonEdited)).toHaveCount(0, { timeout: ACTION_TIMEOUT });

  const curriculum = page.getByTestId('institution-curriculum').filter({ visible: true });
  await curriculum.locator('#lo-code').fill(outcome);
  await curriculum.locator('#lo-statement').fill('E2E outcome statement');
  await serverAction(page, () => curriculum.getByTestId('add-learning-outcome').click());
  await expect(curriculum.getByTestId('learning-outcome-list')).toContainText(outcome, {
    timeout: ACTION_TIMEOUT,
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitHydrated(page, 'curriculum-panel');
  const outcomeList = page
    .getByTestId('institution-curriculum')
    .filter({ visible: true })
    .getByTestId('learning-outcome-list');
  const outcomeRow = outcomeList.locator('li').filter({ hasText: outcome });
  await expect(outcomeRow).toBeVisible();
  // Reloading before the delete action responds would abort it.
  await serverAction(page, () => outcomeRow.getByRole('button', { name: 'Remove' }).click());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitHydrated(page, 'curriculum-panel');
  await expect(
    page.getByTestId('institution-curriculum').filter({ visible: true }).getByText(outcome),
  ).toHaveCount(0);
}

async function exerciseInfrastructure(page: Page, roomName: string, repair: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/institutions/${MAYUR}/infrastructure`, { waitUntil: 'domcontentloaded' });
  const root = page.getByTestId('institution-infrastructure').filter({ visible: true });
  await expect(root).toBeVisible();
  await waitHydrated(page, 'facility-editor');
  await expect(root).toContainText('Room 204');
  await expect(root).toContainText('Chemistry lab L2');
  await expect(root).not.toContainText('Declared');
  await expect(root).toContainText('Ceiling tiles loose above the rear row');
  await expect(root.getByTestId('repair-request-list')).toContainText('Room 204');
  await expect(root.getByTestId('repair-request-list')).toContainText('open');
  await waitForShell(page, 1440);
  await runAxe(page);
  await shoot(page, 'infrastructure', 1440);
  await shoot(page, 'infrastructure', 834);
  await shoot(page, 'infrastructure', 390);

  const infra = page.getByTestId('institution-infrastructure').filter({ visible: true });
  await infra.getByRole('link', { name: 'Room 204' }).click();
  await expect(page).toHaveURL(/#facility-/);
  await expect(infra.getByTestId('facility-Room 204')).toBeVisible();

  await infra.locator('#room-name').fill(roomName);
  await infra.locator('#room-capacity').fill('12');
  await infra.locator('#room-condition').selectOption('Good');
  await serverAction(page, () => infra.getByRole('button', { name: 'Add room' }).click());
  await expect(infra.getByText('Room added.')).toBeVisible({ timeout: ACTION_TIMEOUT });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitHydrated(page, 'facility-editor');
  const infraAfter = page.getByTestId('institution-infrastructure').filter({ visible: true });
  await expect(infraAfter.getByTestId(`facility-${roomName}`)).toBeVisible();

  await infraAfter.locator('#edit-facility').selectOption({ label: roomName });
  await infraAfter.locator('#edit-name').fill(roomName);
  await infraAfter.locator('#edit-capacity').fill('12');
  await infraAfter.locator('#edit-condition').selectOption('Fair');
  await serverAction(page, () => infraAfter.getByRole('button', { name: 'Save facility' }).click());
  await expect(infraAfter.getByText('Facility updated.')).toBeVisible({
    timeout: ACTION_TIMEOUT,
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitHydrated(page, 'facility-editor');
  const infraSaved = page.getByTestId('institution-infrastructure').filter({ visible: true });
  await expect(infraSaved.getByTestId(`facility-${roomName}`)).toContainText('Fair');

  await infraSaved.locator('#repair-summary').fill(repair);
  await serverAction(page, () => infraSaved.getByTestId('submit-repair-request').click());
  await expect(infraSaved.getByText('Repair request logged.')).toBeVisible({
    timeout: ACTION_TIMEOUT,
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitHydrated(page, 'facility-editor');
  await expect(
    page
      .getByTestId('institution-infrastructure')
      .filter({ visible: true })
      .getByTestId('repair-request-list'),
  ).toContainText(repair);

  const downloadPromise = page.waitForEvent('download');
  await page
    .getByTestId('institution-infrastructure')
    .filter({ visible: true })
    .getByTestId('infrastructure-verification-report')
    .click();
  const download = await downloadPromise;
  expect(await download.failure()).toBeNull();
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
}
