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

test.describe('Institution detail tabs — Sunrise live', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1, gateway, and the Sunrise seed');
  test.setTimeout(300_000);
  test.beforeAll(() => {
    cleanupSunriseE2E();
  });
  test.afterAll(() => {
    cleanupSunriseE2E();
  });

  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page, {
      sub: 'priya-sharma',
      email: 'priya.sharma@school.edu',
      displayName: 'Priya Sharma',
      tenantId: SUNRISE,
      roles: [{ roleId: 'principal', roleName: 'Principal', areaId: null }],
    });
  });

  test('gradebook, curriculum, and infrastructure writes persist', async ({ page }) => {
    mkdirSync(CAPTURES, { recursive: true });
    const stamp = Date.now().toString(36);
    const score = '77';
    const assessmentCode = `E2E${stamp.slice(-6)}`;
    const lesson = `E2E lesson ${stamp}`;
    const lessonEdited = `${lesson} edited`;
    const outcome = `M9.${stamp.slice(-4).toUpperCase()}`;
    const roomName = `E2E Room ${stamp.slice(-4)}`;
    const repair = `E2E ceiling leak ${stamp}`;

    await exerciseGradebook(page, score, assessmentCode);
    await exerciseCurriculum(page, lesson, lessonEdited, outcome);
    await exerciseInfrastructure(page, roomName, repair);
  });
});

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
  await expect(root).toContainText('Aarav Mehta');
  await expect(root).not.toContainText('db/sql');
  await expect(root).not.toContainText('db/seeds');
  await expect(root.getByText(/^E2E/)).toHaveCount(0);
  await waitForShell(page, 1440);
  await runAxe(page);
  await shoot(page, 'gradebook', 1440);
  await shoot(page, 'gradebook', 834);
  await shoot(page, 'gradebook', 390);

  const picker = page.locator('#gb-section');
  const labels = await picker.locator('option').allTextContents();
  const other = labels.find((label) => label.includes('G9B-SCI'));
  if (other) {
    await picker.selectOption({ label: other });
    await expect(page).toHaveURL(/sectionId=/);
    await expect(
      page.getByTestId('gradebook-section-name').filter({ visible: true }),
    ).toContainText('G9B-SCI');
  }
  const math = labels.find((label) => label.includes('G9B-MATH'));
  expect(math).toBeTruthy();
  await picker.selectOption({ label: math! });
  await expect(page.getByTestId('gradebook-section-name').filter({ visible: true })).toContainText(
    'G9B-MATH',
  );
  await expect(page.getByTestId('institution-gradebook').filter({ visible: true })).toContainText(
    'Aarav Mehta',
  );

  await page.locator('#studentId-search').fill('Mehta');
  const student = page.locator('#studentId');
  const aaravOption = student.locator('option', { hasText: 'Aarav Mehta' });
  await expect(aaravOption.first()).toBeAttached();
  const studentLabels = await aaravOption.allTextContents();
  const aarav = studentLabels.find(
    (label) => label.includes('Aarav Mehta') && !label.startsWith('Selected'),
  );
  expect(aarav, studentLabels.join(' | ')).toBeTruthy();
  await student.selectOption({ label: aarav! });
  await page.locator('#assessmentCode').fill(assessmentCode);
  await page.locator('#numericScore').fill(score);
  await page.getByRole('button', { name: 'Save grade' }).click();
  await expect(page.getByTestId('grade-save-message')).toContainText(/Grade saved for/);
  await expect(page.getByTestId('grade-save-message')).not.toContainText(
    /[0-9a-f]{8}-[0-9a-f]{4}-/i,
  );

  const entry = page.getByTestId('grade-entry-row').filter({ hasText: assessmentCode }).first();
  await expect(entry).toBeVisible();
  await clickDom(entry.getByRole('button', { name: 'Submit' }));
  await expect(entry.getByRole('button', { name: 'Approve' })).toBeVisible();
  await clickDom(entry.getByRole('button', { name: 'Approve' }));
  await confirm(page, 'gradebook-workflow-confirm');
  await expect(entry.getByRole('button', { name: 'Lock' })).toBeVisible();
  await clickDom(entry.getByRole('button', { name: 'Lock' }));
  await confirm(page, 'gradebook-workflow-confirm');
  await expect(entry.getByRole('button', { name: 'Publish' })).toBeVisible();
  await clickDom(entry.getByRole('button', { name: 'Publish' }));
  await confirm(page, 'gradebook-workflow-confirm');
  await expect(entry.getByRole('button', { name: 'Unpublish' })).toBeVisible();
  await clickDom(entry.getByRole('button', { name: 'Unpublish' }));
  await confirm(page, 'gradebook-workflow-confirm');
  await expect(entry).toContainText('Draft');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(
    page.getByTestId('grade-entry-row').filter({ hasText: assessmentCode }).first(),
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

  await page.locator('#unit-code').fill('U1');
  await page.locator('#unit-name').fill('Duplicate number systems');
  await page.getByTestId('add-syllabus-unit').click();
  await expect(page.getByTestId('unit-form-error')).toBeVisible();
  await expect(page.getByTestId('outcome-form-error')).toHaveCount(0);

  const unit = page.getByTestId('syllabus-unit-row').filter({ hasText: 'Coordinate geometry' });
  const markTaught = unit.getByRole('button', { name: 'Mark taught', exact: true });
  const taughtButton = unit.getByRole('button', { name: 'Taught', exact: true });
  if (await taughtButton.isVisible()) {
    await clickDom(taughtButton);
    await confirm(page, 'curriculum-taught-confirm');
    await expect(markTaught).toBeVisible();
  }
  await clickDom(markTaught);
  await confirm(page, 'curriculum-taught-confirm');
  await expect(taughtButton).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitHydrated(page, 'curriculum-panel');
  const taught = page.getByTestId('syllabus-unit-row').filter({ hasText: 'Coordinate geometry' });
  await expect(taught.getByRole('button', { name: 'Taught', exact: true })).toBeVisible();
  await clickDom(taught.getByRole('button', { name: 'Taught', exact: true }));
  await confirm(page, 'curriculum-taught-confirm');
  await expect(taught.getByRole('button', { name: 'Mark taught', exact: true })).toBeVisible();

  await taught.locator('input[name="title"]').fill(lesson);
  await taught.getByRole('button', { name: 'Add lesson' }).click();
  await expect(taught.getByText(lesson)).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept(lessonEdited));
  await taught.getByRole('button', { name: 'Edit' }).click();
  await expect(taught.getByText(lessonEdited)).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitHydrated(page, 'curriculum-panel');
  const afterLesson = page
    .getByTestId('syllabus-unit-row')
    .filter({ hasText: 'Coordinate geometry' });
  await expect(afterLesson.getByText(lessonEdited)).toBeVisible();
  await afterLesson.getByRole('button', { name: 'Remove' }).first().click();
  await expect(afterLesson.getByText(lessonEdited)).toHaveCount(0);

  await page.locator('#lo-code').fill(outcome);
  await page.locator('#lo-statement').fill('E2E outcome statement');
  await page.getByTestId('add-learning-outcome').click();
  await expect(page.getByTestId('learning-outcome-list')).toContainText(outcome);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitHydrated(page, 'curriculum-panel');
  const outcomeRow = page
    .getByTestId('learning-outcome-list')
    .locator('li')
    .filter({ hasText: outcome });
  await expect(outcomeRow).toBeVisible();
  await outcomeRow.getByRole('button', { name: 'Remove' }).click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitHydrated(page, 'curriculum-panel');
  await expect(page.getByText(outcome)).toHaveCount(0);
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
  await expect(page.getByTestId('repair-request-list')).toContainText('Room 204');
  await expect(page.getByTestId('repair-request-list')).toContainText('open');
  await waitForShell(page, 1440);
  await runAxe(page);
  await shoot(page, 'infrastructure', 1440);
  await shoot(page, 'infrastructure', 834);
  await shoot(page, 'infrastructure', 390);

  await page.getByRole('link', { name: 'Room 204' }).click();
  await expect(page).toHaveURL(/#facility-/);
  await expect(page.getByTestId('facility-Room 204')).toBeVisible();

  await page.locator('#room-name').fill(roomName);
  await page.locator('#room-capacity').fill('12');
  await page.locator('#room-condition').selectOption('Good');
  await page.getByRole('button', { name: 'Add room' }).click();
  await expect(page.getByText('Room added.')).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitHydrated(page, 'facility-editor');
  await expect(page.getByTestId(`facility-${roomName}`)).toBeVisible();

  await page.locator('#edit-facility').selectOption({ label: roomName });
  await page.locator('#edit-name').fill(roomName);
  await page.locator('#edit-capacity').fill('12');
  await page.locator('#edit-condition').selectOption('Fair');
  await page.getByRole('button', { name: 'Save facility' }).click();
  await expect(page.getByText('Facility updated.')).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitHydrated(page, 'facility-editor');
  await expect(page.getByTestId(`facility-${roomName}`)).toContainText('Fair');

  await page.locator('#repair-summary').fill(repair);
  await page.getByTestId('submit-repair-request').click();
  await expect(page.getByText('Repair request logged.')).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitHydrated(page, 'facility-editor');
  await expect(page.getByTestId('repair-request-list')).toContainText(repair);

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('infrastructure-verification-report').click();
  const download = await downloadPromise;
  expect(await download.failure()).toBeNull();
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
}
