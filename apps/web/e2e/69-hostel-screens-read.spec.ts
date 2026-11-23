import { expect, test, type Page } from '@playwright/test';

import {
  BACKEND_READY,
  hostelAdmin,
  newTag,
  openAs,
  rowStartingWith,
  seedHostelData,
  type SeededHostelData,
} from './fixtures/hostel-screens';

/**
 * Hostel module — every screen shows rows written through the live API (screen → API → DB).
 *
 * One test seeds a full hostel data set with a unique tag through the gateway, then opens
 * each of the nine hostel screens as a tenant administrator and finds this run's rows by
 * their unique strings. The hostel lists are uncapped (every page is read), so leftovers
 * from earlier runs never hide this run's rows.
 */

function listItem(page: Page, text: string) {
  return page.locator('main li', { hasText: text });
}

test.describe('Hostel screens — read path (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires live gateway (E2E_BACKEND_READY)');

  let d: SeededHostelData;
  const tag = newTag();
  const admin = hostelAdmin(`ho-admin-${tag}`);

  test.beforeAll(async ({ request }) => {
    d = await seedHostelData(request, admin, tag);
  });

  test.beforeEach(async ({ page }) => {
    await openAs(page, admin);
  });

  test('/hostel lists the seeded hostel with code, capacity and status', async ({ page }) => {
    await page.goto('/hostel', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Hostel' })).toBeVisible();
    const row = page.getByTestId('hostel-row').filter({ hasText: d.hostel.name });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(`(${d.hostel.code})`);
    await expect(row).toContainText('capacity 40 · active');
  });

  test('/hostel/structure lists the seeded block, room and bed with their parents', async ({
    page,
  }) => {
    await page.goto('/hostel/structure', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Structure' })).toBeVisible();
    const block = rowStartingWith(page, d.block.name);
    await expect(block).toHaveCount(1);
    await expect(block).toContainText(`${d.hostel.name} · floor 2`);
    const room = rowStartingWith(page, `Room ${d.room.roomNumber}`);
    await expect(room).toHaveCount(1);
    await expect(room).toContainText(`${d.block.name} · capacity 3`);
    const bed = rowStartingWith(page, `Bed ${d.bed.bedLabel}`);
    await expect(bed).toHaveCount(1);
    // The seeded assignment holds the bed, so it is no longer available.
    await expect(bed).toContainText(`room ${d.room.roomNumber} · unavailable`);
  });

  test('/hostel/assignments lists the seeded assignment by student name and bed', async ({
    page,
  }) => {
    await page.goto('/hostel/assignments', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Assignments' })).toBeVisible();
    const row = listItem(page, `${d.student.label} · bed ${d.bed.bedLabel}`);
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(`from ${d.assignment.startDate} · active`);
  });

  test('/hostel/leaves lists the seeded leave with dates, reason and decision buttons', async ({
    page,
  }) => {
    await page.goto('/hostel/leaves', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Leaves' })).toBeVisible();
    const row = listItem(page, d.leave.reason);
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(`${d.student.label} · pending`);
    await expect(row).toContainText(`${d.leave.startDate} → ${d.leave.endDate}`);
    await expect(row.getByTestId('approve-leave-button')).toBeVisible();
  });

  test('/hostel/visitors lists the seeded visitor with date, student and status', async ({
    page,
  }) => {
    await page.goto('/hostel/visitors', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Visitors' })).toBeVisible();
    const row = listItem(page, d.visitor.visitorName);
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(`${d.visitor.visitorName} · expected`);
    await expect(row).toContainText(`${d.visitor.visitDate} · ${d.student.label}`);
    await expect(row.getByTestId('visitor-checked_in-button')).toBeVisible();
  });

  test('/hostel/gate-passes lists the seeded pass with student, times and status', async ({
    page,
  }) => {
    await page.goto('/hostel/gate-passes', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Gate passes' })).toBeVisible();
    const row = page.getByTestId('hostel-gate-pass-row').filter({ hasText: d.student.label });
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute('data-gate-status', 'pending');
    const times = row.locator('time');
    await expect(times).toHaveCount(2);
    await expect(times.nth(0)).toHaveAttribute('datetime', d.gatePass.expectedOutAt);
    await expect(times.nth(1)).toHaveAttribute('datetime', d.gatePass.expectedInAt);
    await expect(row.getByTestId(`gate-approve-${d.gatePass.id}`)).toBeVisible();
  });

  test('/hostel/mess lists the seeded plan with meal count and status', async ({ page }) => {
    await page.goto('/hostel/mess', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Mess plans' })).toBeVisible();
    const row = page.getByTestId('hostel-mess-plan-row').filter({ hasText: d.plan.name });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('4 meals · active');
    // The seeded plan is offered in the menu and subscription forms.
    await expect(
      page.getByTestId('hostel-mess-menu-form').locator(`option[value="${d.plan.id}"]`),
    ).toHaveCount(1);
  });

  test('/hostel/fees lists the seeded fee structure with its amount', async ({ page }) => {
    await page.goto('/hostel/fees', { waitUntil: 'domcontentloaded' });
    await expect(
      page.getByRole('heading', { level: 1, name: 'Hostel fee structures' }),
    ).toBeVisible();
    const row = page.getByTestId('hostel-fee-row').filter({ hasText: d.fee.roomType });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(`${d.fee.roomType} · ${d.fee.termLabel}`);
    await expect(row).toContainText('₹12,345.00');
  });

  test('/hostel/attendance shows the seeded night-roll mark for its block and date', async ({
    page,
  }) => {
    await page.goto(`/hostel/attendance?blockId=${d.block.id}&onDate=${d.attendance.onDate}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByRole('heading', { level: 1, name: 'Hostel attendance' })).toBeVisible();
    await expect(page.getByText(`Roll for ${d.attendance.onDate}`)).toBeVisible();
    const row = page.getByTestId('hostel-attendance-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('absent');
    await expect(row).toContainText(`${d.student.label} · ${d.attendance.reason}`);
  });
});
