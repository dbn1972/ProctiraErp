import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import {
  BACKEND_READY,
  createStudent,
  getAllPages,
  getRows,
  hostelAdmin,
  hydratedForm,
  newTag,
  openAs,
  pickStudent,
  postCreated,
  rowStartingWith,
  seedStructure,
  utcDate,
  type Persona,
} from './fixtures/hostel-screens';

/**
 * Hostel module — every write screen saves through its own form (screen → API → DB).
 *
 * Each test seeds only the parents it needs through the gateway with a unique tag, saves
 * through the screen's form as a tenant administrator, confirms the result on screen,
 * reloads to prove it came back from the database, and reads the row through the API.
 * All dates are derived from the run.
 */

/**
 * A form save is a server action plus `router.refresh()`. Under `next dev` (local runs)
 * the first action in a file compiles the action module, which can take well over 15 s.
 */
const SAVE_TIMEOUT = 60_000;

function listItem(page: Page, text: string) {
  return page.locator('main li', { hasText: text });
}

function seedHostel(request: APIRequestContext, p: Persona, tag: string) {
  return postCreated(request, p, '/hostel', { name: `HO hall ${tag}`, code: `HO-${tag}` });
}

test.describe('Hostel screens — form saves (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires live gateway (E2E_BACKEND_READY)');
  // Several saves per test, each up to SAVE_TIMEOUT.
  test.slow();

  test('/hostel: the add-hostel form creates a hostel shown in the register', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const admin = hostelAdmin(`ho-admin-${tag}`);
    await openAs(page, admin);
    const name = `HO form hall ${tag}`;
    const code = `HOF-${tag}`;

    await page.goto('/hostel', { waitUntil: 'domcontentloaded' });
    const form = await hydratedForm(page, 'hostel-create-form');
    await form.getByLabel('Name').fill(name);
    await form.getByLabel('Code').fill(code);
    await form.getByLabel('Address').fill(`HO address ${tag}`);
    await form.getByLabel('Capacity').fill('24');
    await form.getByRole('button', { name: 'Create hostel' }).click();

    const row = page.getByTestId('hostel-row').filter({ hasText: name });
    await expect(row).toHaveCount(1, { timeout: SAVE_TIMEOUT });
    await expect(form.getByLabel('Name')).toHaveValue('');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(`(${code})`);
    await expect(row).toContainText('capacity 24 · active');

    const saved = (await getRows(request, admin, '/hostel')).filter((h) => h.code === code);
    expect(saved.map((h) => [h.name, h.capacity, h.address])).toEqual([
      [name, 24, `HO address ${tag}`],
    ]);
  });

  test('/hostel/structure: the block, room and bed forms build a hostel structure', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const admin = hostelAdmin(`ho-admin-${tag}`);
    const hostel = await seedHostel(request, admin, tag);
    await openAs(page, admin);
    const blockName = `HO form block ${tag}`;
    const roomNumber = `HOFR${tag}`;
    const bedLabel = `HOFB${tag}`;

    await page.goto('/hostel/structure', { waitUntil: 'domcontentloaded' });
    const blockForm = await hydratedForm(page, 'hostel-block-form');
    await blockForm.locator('#block-hostel').selectOption(hostel.id);
    await blockForm.getByLabel('Block name').fill(blockName);
    await blockForm.getByLabel('Floor').fill('3');
    await blockForm.getByRole('button', { name: 'Create block' }).click();
    await expect(rowStartingWith(page, blockName)).toContainText(`HO hall ${tag} · floor 3`, {
      timeout: SAVE_TIMEOUT,
    });
    const blocks = await getRows(request, admin, `/hostel/blocks?hostelId=${hostel.id}`);
    expect(blocks.map((b) => [b.name, b.floor])).toEqual([[blockName, 3]]);
    const blockId = String(blocks[0]!.id);

    const roomForm = await hydratedForm(page, 'hostel-room-form');
    await expect(roomForm.locator(`#room-block option[value="${blockId}"]`)).toHaveCount(1);
    await roomForm.locator('#room-block').selectOption(blockId);
    await roomForm.getByLabel('Room number').fill(roomNumber);
    await roomForm.getByLabel('Capacity').fill('2');
    await roomForm.getByRole('button', { name: 'Create room' }).click();
    await expect(rowStartingWith(page, `Room ${roomNumber}`)).toContainText(
      `${blockName} · capacity 2`,
      {
        timeout: SAVE_TIMEOUT,
      },
    );
    const rooms = await getRows(request, admin, `/hostel/rooms?blockId=${blockId}`);
    expect(rooms.map((r) => [r.roomNumber, r.capacity])).toEqual([[roomNumber, 2]]);
    const roomId = String(rooms[0]!.id);

    const bedForm = await hydratedForm(page, 'hostel-bed-form');
    await expect(bedForm.locator(`#bed-room option[value="${roomId}"]`)).toHaveCount(1);
    await bedForm.locator('#bed-room').selectOption(roomId);
    await bedForm.getByLabel('Bed label').fill(bedLabel);
    await bedForm.getByRole('button', { name: 'Create bed' }).click();
    await expect(rowStartingWith(page, `Bed ${bedLabel}`)).toContainText(
      `room ${roomNumber} · available`,
      { timeout: SAVE_TIMEOUT },
    );

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(rowStartingWith(page, blockName)).toHaveCount(1);
    await expect(rowStartingWith(page, `Room ${roomNumber}`)).toHaveCount(1);
    await expect(rowStartingWith(page, `Bed ${bedLabel}`)).toHaveCount(1);
    const beds = await getRows(request, admin, `/hostel/beds?roomId=${roomId}`);
    expect(beds.map((b) => [b.bedLabel, b.isAvailable])).toEqual([[bedLabel, true]]);
  });

  test('/hostel/fees: the fee-structure form saves a structure shown with its amount', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const admin = hostelAdmin(`ho-admin-${tag}`);
    const hostel = await seedHostel(request, admin, tag);
    await openAs(page, admin);
    const roomType = `HO form room type ${tag}`;
    const termLabel = `HO form term ${tag}`;

    await page.goto('/hostel/fees', { waitUntil: 'domcontentloaded' });
    const form = await hydratedForm(page, 'hostel-fee-form');
    await form.locator('#fee-hostel').selectOption(hostel.id);
    await form.getByLabel('Room type').fill(roomType);
    await form.getByLabel('Term').fill(termLabel);
    await form.getByLabel('Amount (₹)').fill('2500.50');
    await form.getByRole('button', { name: 'Save structure' }).click();
    await expect(form.getByText('Hostel fee structure saved.')).toBeVisible({
      timeout: SAVE_TIMEOUT,
    });

    const row = page.getByTestId('hostel-fee-row').filter({ hasText: roomType });
    await expect(row).toHaveCount(1);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(row).toContainText(`${roomType} · ${termLabel}`);
    await expect(row).toContainText('₹2,500.50');
    const saved = await getRows(request, admin, `/hostel/fee-structures?hostelId=${hostel.id}`);
    expect(saved.map((f) => [f.roomType, f.termLabel, f.amountCents])).toEqual([
      [roomType, termLabel, 250050],
    ]);
  });

  test('/hostel/assignments: the assign-bed form assigns a student to a bed', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const admin = hostelAdmin(`ho-admin-${tag}`);
    const s = await seedStructure(request, admin, tag);
    const student = await createStudent(request, admin, tag);
    await openAs(page, admin);
    const startDate = utcDate(0);
    const endDate = utcDate(120);

    await page.goto('/hostel/assignments', { waitUntil: 'domcontentloaded' });
    const form = await hydratedForm(page, 'hostel-assignment-form');
    await pickStudent(form, 'assign-student', student);
    await form.locator('#assign-bed').selectOption(s.bed.id);
    await form.getByLabel('Start date').fill(startDate);
    await form.getByLabel('End date').fill(endDate);
    await form.getByRole('button', { name: 'Assign bed' }).click();

    const row = listItem(page, `${student.label} · bed ${s.bed.bedLabel}`);
    await expect(row).toHaveCount(1, { timeout: SAVE_TIMEOUT });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(row).toContainText(`from ${startDate} to ${endDate} · active`);

    const saved = (await getAllPages(request, admin, '/hostel/assignments')).filter(
      (a) => a.studentId === student.id,
    );
    expect(saved.map((a) => [a.bedId, a.startDate, a.endDate, a.isActive])).toEqual([
      [s.bed.id, startDate, endDate, true],
    ]);
    const beds = await getRows(request, admin, `/hostel/beds?roomId=${s.room.id}`);
    expect(
      beds.map((b) => b.isAvailable),
      'assigned bed is taken',
    ).toEqual([false]);
  });

  test('/hostel/leaves: the record-leave form saves a request that is then approved', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const admin = hostelAdmin(`ho-admin-${tag}`);
    const hostel = await seedHostel(request, admin, tag);
    const student = await createStudent(request, admin, tag);
    await openAs(page, admin);
    const reason = `HO form leave ${tag}`;
    const startDate = utcDate(7);
    const endDate = utcDate(9);

    await page.goto('/hostel/leaves', { waitUntil: 'domcontentloaded' });
    const form = await hydratedForm(page, 'hostel-leave-form');
    await form.locator('#leave-hostel').selectOption(hostel.id);
    await pickStudent(form, 'leave-student', student);
    await form.getByLabel('Start date').fill(startDate);
    await form.getByLabel('End date').fill(endDate);
    await form.getByLabel('Reason').fill(reason);
    await form.getByRole('button', { name: 'Record leave' }).click();

    const row = listItem(page, reason);
    await expect(row).toContainText(`${student.label} · pending`, { timeout: SAVE_TIMEOUT });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(row).toContainText(`${startDate} → ${endDate}`);
    // The decision buttons hydrate with the rest of the page; a click before that is lost.
    await hydratedForm(page, 'hostel-leave-form');

    await row.getByTestId('approve-leave-button').click();
    await page.getByTestId('hostel-leave-approve-confirm-confirm').click();
    await expect(row).toContainText(`${student.label} · approved`, { timeout: SAVE_TIMEOUT });
    await expect(row.getByTestId('approve-leave-button')).toHaveCount(0);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(row).toContainText(`${student.label} · approved`);

    const saved = (await getAllPages(request, admin, '/hostel/leaves')).filter(
      (l) => l.studentId === student.id,
    );
    expect(saved.map((l) => [l.hostelId, l.startDate, l.endDate, l.reason, l.status])).toEqual([
      [hostel.id, startDate, endDate, reason, 'approved'],
    ]);
  });

  test('/hostel/visitors: the register-visitor form logs a visitor checked in and out', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const admin = hostelAdmin(`ho-admin-${tag}`);
    const hostel = await seedHostel(request, admin, tag);
    const student = await createStudent(request, admin, tag);
    await openAs(page, admin);
    const visitorName = `HO form visitor ${tag}`;
    const visitDate = utcDate(0);

    await page.goto('/hostel/visitors', { waitUntil: 'domcontentloaded' });
    const form = await hydratedForm(page, 'hostel-visitor-form');
    await form.locator('#visitor-hostel').selectOption(hostel.id);
    await form.getByLabel('Visitor name').fill(visitorName);
    await pickStudent(form, 'visitor-student', student);
    await form.getByLabel('Visit date').fill(visitDate);
    await form.getByRole('button', { name: 'Register visitor' }).click();

    const row = listItem(page, visitorName);
    await expect(row).toContainText(`${visitorName} · expected`, { timeout: SAVE_TIMEOUT });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(row).toContainText(`${visitDate} · ${student.label}`);
    await hydratedForm(page, 'hostel-visitor-form');

    await row.getByTestId('visitor-checked_in-button').click();
    await expect(row).toContainText(`${visitorName} · checked_in`, { timeout: SAVE_TIMEOUT });
    await row.getByTestId('visitor-checked_out-button').click();
    await expect(row).toContainText(`${visitorName} · checked_out`, { timeout: SAVE_TIMEOUT });
    await expect(row.getByRole('button')).toHaveCount(0);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(row).toContainText(`${visitorName} · checked_out`);

    const saved = (await getAllPages(request, admin, '/hostel/visitors')).filter(
      (v) => v.studentId === student.id,
    );
    expect(saved.map((v) => [v.hostelId, v.visitorName, v.visitDate, v.status])).toEqual([
      [hostel.id, visitorName, visitDate, 'checked_out'],
    ]);
  });

  test('/hostel/gate-passes: the request form saves a pass that is approved, out and in', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const admin = hostelAdmin(`ho-admin-${tag}`);
    const hostel = await seedHostel(request, admin, tag);
    const student = await createStudent(request, admin, tag);
    await openAs(page, admin);
    const reason = `HO form gate ${tag}`;
    const day = utcDate(2);

    await page.goto('/hostel/gate-passes', { waitUntil: 'domcontentloaded' });
    const form = await hydratedForm(page, 'hostel-gate-pass-form');
    await form.locator('#gp-hostel').selectOption(hostel.id);
    await pickStudent(form, 'gp-student', student);
    await form.locator('#gp-who').selectOption('parent');
    await form.getByLabel('Expected out').fill(`${day}T08:00`);
    await form.getByLabel('Expected in').fill(`${day}T18:00`);
    await form.getByLabel('Reason').fill(reason);
    await form.getByRole('button', { name: 'Request pass' }).click();
    await expect(form.getByText('Gate pass requested.')).toBeVisible({ timeout: SAVE_TIMEOUT });

    const row = page.getByTestId('hostel-gate-pass-row').filter({ hasText: student.label });
    await expect(row).toHaveAttribute('data-gate-status', 'pending');
    const [pass] = (
      await getRows(request, admin, `/hostel/gate-passes?hostelId=${hostel.id}`)
    ).filter((g) => g.studentId === student.id);
    expect(pass, 'pass saved').toBeTruthy();
    const id = String(pass!.id);
    expect([pass!.reason, pass!.status]).toEqual([reason, 'pending']);
    // The form reads the times in the tenant timezone; the stored pass keeps the 10 h span.
    expect(Date.parse(String(pass!.expectedInAt)) - Date.parse(String(pass!.expectedOutAt))).toBe(
      10 * 3_600_000,
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(row.locator('time').nth(0)).toHaveAttribute(
      'datetime',
      String(pass!.expectedOutAt),
    );
    await hydratedForm(page, 'hostel-gate-pass-form');

    await row.getByTestId(`gate-approve-${id}`).click();
    await page.getByTestId('gate-pass-approve-confirm').click();
    await expect(row).toHaveAttribute('data-gate-status', 'approved', { timeout: SAVE_TIMEOUT });
    await row.getByTestId(`gate-out-${id}`).click();
    await expect(row).toHaveAttribute('data-gate-status', 'out', { timeout: SAVE_TIMEOUT });
    await row.getByTestId(`gate-in-${id}`).click();
    await expect(row).toHaveAttribute('data-gate-status', 'in', { timeout: SAVE_TIMEOUT });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(row).toHaveAttribute('data-gate-status', 'in');
    await expect(row.getByRole('button')).toHaveCount(0);

    const after = (await getRows(request, admin, `/hostel/gate-passes?hostelId=${hostel.id}`)).map(
      (g) => [g.id, g.status, g.decidedBy],
    );
    expect(after).toEqual([[id, 'in', admin.sub]]);
  });

  test('/hostel/mess: the plan, menu and subscription forms save a mess plan', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const admin = hostelAdmin(`ho-admin-${tag}`);
    const hostel = await seedHostel(request, admin, tag);
    const student = await createStudent(request, admin, tag);
    await openAs(page, admin);
    const planName = `HO form plan ${tag}`;
    const dish = `HO form dish ${tag}`;
    const startDate = utcDate(1);

    await page.goto('/hostel/mess', { waitUntil: 'domcontentloaded' });
    const planForm = await hydratedForm(page, 'hostel-mess-plan-form');
    await planForm.locator('#mess-hostel').selectOption(hostel.id);
    await planForm.getByLabel('Plan name').fill(planName);
    await planForm.getByLabel('Meals per day').fill('2');
    await planForm.getByRole('button', { name: 'Create plan' }).click();
    await expect(page.getByText('Mess plan created.')).toBeVisible({ timeout: SAVE_TIMEOUT });
    const planRow = page.getByTestId('hostel-mess-plan-row').filter({ hasText: planName });
    await expect(planRow).toContainText('2 meals · active');
    const plans = await getRows(request, admin, `/hostel/mess/plans?hostelId=${hostel.id}`);
    expect(plans.map((p) => [p.name, p.mealCount])).toEqual([[planName, 2]]);
    const planId = String(plans[0]!.id);

    const menuForm = await hydratedForm(page, 'hostel-mess-menu-form');
    await expect(menuForm.locator(`#menu-plan option[value="${planId}"]`)).toHaveCount(1);
    await menuForm.locator('#menu-plan').selectOption(planId);
    await menuForm.locator('#menu-day').selectOption('5');
    await menuForm.locator('#menu-meal').selectOption('breakfast');
    await menuForm.getByLabel('Dish').fill(dish);
    await menuForm.getByRole('button', { name: 'Add menu item' }).click();
    await expect(page.getByText('Menu item added.')).toBeVisible({ timeout: SAVE_TIMEOUT });
    const menu = await getRows(request, admin, `/hostel/mess/menu?planId=${planId}`);
    expect(menu.map((m) => [m.weekday, m.meal, m.itemName])).toEqual([[5, 'breakfast', dish]]);

    const subForm = await hydratedForm(page, 'hostel-mess-subscribe-form');
    await subForm.locator('#sub-plan').selectOption(planId);
    await pickStudent(subForm, 'sub-student', student);
    await subForm.getByLabel('Start date').fill(startDate);
    await subForm.getByRole('button', { name: 'Subscribe' }).click();
    await expect(page.getByText('Student subscribed.')).toBeVisible({ timeout: SAVE_TIMEOUT });
    const subs = await getRows(request, admin, `/hostel/mess/subscriptions?planId=${planId}`);
    expect(subs.map((s) => [s.studentId, s.startDate])).toEqual([[student.id, startDate]]);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(planRow).toContainText('2 meals · active');
  });

  test('/hostel/attendance: the night-roll form records and then updates a mark', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const admin = hostelAdmin(`ho-admin-${tag}`);
    const s = await seedStructure(request, admin, tag);
    const student = await createStudent(request, admin, tag);
    await openAs(page, admin);
    const onDate = utcDate(0);
    const reason = `HO form roll ${tag}`;
    const url = `/hostel/attendance?blockId=${s.block.id}&onDate=${onDate}`;

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('No marks for this block and date.').first()).toBeVisible();
    const form = await hydratedForm(page, 'hostel-attendance-form');
    await expect(form.locator('#att-block')).toHaveValue(s.block.id);
    await expect(form.getByLabel('Date')).toHaveValue(onDate);
    await pickStudent(form, 'att-student', student);
    await form.locator('#att-status').selectOption('leave');
    await form.getByLabel('Reason').fill(reason);
    await form.getByRole('button', { name: 'Record mark' }).click();
    await expect(form.getByText('Marked leave.')).toBeVisible({ timeout: SAVE_TIMEOUT });

    const row = page.getByTestId('hostel-attendance-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(`${student.label} · ${reason}`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(row).toContainText('leave');

    // The upsert is idempotent: a second mark for the same student and date replaces it.
    const again = await hydratedForm(page, 'hostel-attendance-form');
    await pickStudent(again, 'att-student', student);
    await again.locator('#att-status').selectOption('present');
    await again.getByRole('button', { name: 'Record mark' }).click();
    await expect(again.getByText('Marked present.')).toBeVisible({ timeout: SAVE_TIMEOUT });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('present');

    const marks = await getRows(
      request,
      admin,
      `/hostel/attendance?blockId=${s.block.id}&onDate=${onDate}`,
    );
    expect(marks.map((m) => [m.studentId, m.status])).toEqual([[student.id, 'present']]);
  });
});
