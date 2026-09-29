/**
 * Live Sunrise institution detail. Requires Postgres seeded with
 * db/seeds/006_sunrise_public_school_demo.sql, the gateway, and
 * E2E_BACKEND_READY=1.
 *
 * Routes covered for G-804:
 * /institutions/${id}/overview
 * /institutions/${id}/overview/report
 * /institutions/${id}/classes
 * /institutions/${id}/grades
 * /institutions/${id}/schedule
 * /institutions/${id}/schedule/${sectionId}
 */
import { expect, test } from '@playwright/test';

import { setupGatewayTenantSession } from './fixtures/fake-session';

const BACKEND_READY = process.env.E2E_BACKEND_READY === '1';
const SUNRISE = '00000000-0000-4000-8000-00000000a501';
const MAYUR = '00000000-0000-4000-8000-00000000a551';
const SECTION_9B = '00000000-0000-4000-8000-00000000a572';

test.describe('Institutions detail — Sunrise live', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1, gateway, and the Sunrise seed');

  test('overview shows seeded KPIs, enrollment, activity, and a real school report', async ({
    page,
  }) => {
    await setupGatewayTenantSession(page, {
      sub: 'priya-sharma',
      email: 'priya.sharma@school.edu',
      displayName: 'Priya Sharma',
      tenantId: SUNRISE,
      roles: [{ roleId: 'principal', roleName: 'Principal', areaId: null }],
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/institutions/${MAYUR}/overview`, { waitUntil: 'domcontentloaded' });

    const overview = page.getByTestId('institution-overview').filter({ visible: true });
    await expect(overview).toBeVisible();
    await expect(page.getByText('SCREEN STATE')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /UX review/i })).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Sunrise Public School – Mayur Vihar' }),
    ).toBeVisible();
    await expect(overview.getByText('1,240').first()).toBeVisible();
    await expect(page.getByText('English medium')).toBeVisible();
    await expect(page.getByText('office.mv@sunrisepublic.edu.in')).toBeVisible();
    await expect(overview.getByText('Term 2 timetable published')).toBeVisible();
    await expect(overview.getByText('Class 9')).toBeVisible();

    const reportPath = `/institutions/${MAYUR}/overview/report`;
    await page.getByRole('link', { name: 'School report' }).click();
    await expect(page).toHaveURL(reportPath, { timeout: 20_000 });
    await expect(page.getByTestId('school-report').filter({ visible: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'School report' })).toBeVisible();
    await expect(page.getByText('1,240').first()).toBeVisible();
  });

  test('classes, grades, and schedule use seeded names instead of raw ids', async ({ page }) => {
    await setupGatewayTenantSession(page, {
      sub: 'priya-sharma',
      email: 'priya.sharma@school.edu',
      displayName: 'Priya Sharma',
      tenantId: SUNRISE,
      roles: [{ roleId: 'principal', roleName: 'Principal', areaId: null }],
    });
    await page.setViewportSize({ width: 1440, height: 900 });

    const classesPath = `/institutions/${MAYUR}/classes`;
    await page.goto(classesPath, { waitUntil: 'domcontentloaded' });
    const classes = page.getByTestId('institution-classes').filter({ visible: true });
    await expect(classes).toBeVisible();
    await expect(classes.getByText('9 · A').first()).toBeVisible();
    await expect(classes.getByText('Neha Verma').first()).toBeVisible();
    await expect(classes.getByText('Room 201').first()).toBeVisible();
    await expect(classes.getByText('Unassigned').first()).toBeVisible();
    await expect(page.getByText('SCREEN STATE')).toHaveCount(0);

    const gradesPath = `/institutions/${MAYUR}/grades`;
    await page.goto(gradesPath, { waitUntil: 'domcontentloaded' });
    const grades = page.getByTestId('institution-grades').filter({ visible: true });
    await expect(grades).toBeVisible();
    await expect(grades.getByRole('columnheader', { name: 'View' })).toBeVisible();

    const schedulePath = `/institutions/${MAYUR}/schedule`;
    await page.goto(schedulePath, { waitUntil: 'domcontentloaded' });
    const schedule = page.getByTestId('institution-schedule').filter({ visible: true });
    await expect(schedule).toBeVisible();
    await expect(schedule.getByText('Published').first()).toBeVisible();
    await expect(schedule.getByText('Class 9-A Mathematics')).toBeVisible();
    const sectionRows = schedule.locator('tbody tr');
    await expect(sectionRows.first()).toContainText('G9A-MATH');
    await expect(sectionRows.last()).toContainText('G8C-HIN');
    await expect(sectionRows.last()).toContainText('Archived');
    await expect(
      schedule.getByRole('button', { name: 'Publish schedule' }).filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(
      schedule
        .getByRole('button', { name: 'Unpublish to draft' })
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
    await expect(schedule.getByText('Teacher clash', { exact: true })).toBeVisible();
    await expect(schedule.getByText(/Period 3 \(09:20–10:00\)/)).toBeVisible();
    await expect(schedule.getByText('Neha Verma').first()).toBeVisible();

    const sectionPath = `/institutions/${MAYUR}/schedule/${SECTION_9B}`;
    await page.goto(sectionPath, { waitUntil: 'domcontentloaded' });
    const section = page.getByTestId('institution-schedule-section').filter({ visible: true });
    await expect(section).toBeVisible();
    await expect(section.getByRole('heading', { name: 'Class 9-B Mathematics' })).toBeVisible();
    await expect(section.getByText('G9B-MATH')).toBeVisible();
    await expect(section.getByText('Aarav Mehta')).toBeVisible();
    await expect(
      section.getByRole('button', { name: 'Unpublish to draft' }).filter({ visible: true }),
    ).toBeVisible();
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(crumbs.getByText('Sunrise Public School – Mayur Vihar')).toBeVisible();
    await expect(crumbs.getByText('Class 9-B Mathematics')).toBeVisible();
    const withdraw = section.getByRole('button', { name: /Withdraw Aarav Mehta/ });
    await expect(withdraw).toHaveAttribute('data-hydrated', 'true');
    await withdraw.click();
    await expect(page.getByTestId('withdraw-student').filter({ visible: true })).toBeVisible();
    await page.getByTestId('withdraw-student-cancel').click();
  });
});
