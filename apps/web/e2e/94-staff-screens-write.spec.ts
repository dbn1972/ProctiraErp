import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import {
  BACKEND_READY,
  CONTRACT_START_DAYS,
  INSTITUTION_A,
  INSTITUTION_A_NAME,
  createStaff,
  exportPayroll,
  firstSortingLastName,
  getAllPages,
  getJson,
  hrAdmin,
  hydratedForm,
  newTag,
  openAs,
  parseCsv,
  pickRadixOption,
  pickStaff,
  postOk,
  seedClassAndSubject,
  seedPayrollMonth,
  seedTemplate,
  setLeaveBalance,
  utcDate,
  type Row,
} from './fixtures/staff-screens';

/**
 * Staff / HR module — every write screen saves through its own form (screen → API → DB).
 *
 * Each test seeds only the parents it needs through the gateway with a unique tag, saves
 * through the screen's form as a tenant administrator, confirms the result on screen,
 * reloads to prove it came back from the database, and reads the row through the API.
 * All dates are derived from the run.
 *
 * Not here: `/staff/substitutions` cannot save today (S-D3, the form gets no staff list);
 * its form-save test is kept in the task's patches/ for the fix PR.
 */

/**
 * A form save is a server action plus `router.refresh()` (or a redirect). Under `next dev`
 * (local runs) the first action in a file compiles the action module, which can be slow.
 */
const SAVE_TIMEOUT = 60_000;

test.describe('Staff screens — form saves (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires live gateway (E2E_BACKEND_READY)');
  // Several saves per test, each up to SAVE_TIMEOUT.
  test.slow();

  test('/staff/new: the add-staff form creates a record shown on its profile', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const admin = hrAdmin(`st-admin-${tag}`);
    await openAs(page, admin);
    const v = {
      firstName: `StN${tag}`,
      lastName: 'Created',
      dateOfBirth: '1990-01-31',
      identityNumber: `ST-N${tag}`,
      contactPhone: '+15557654321',
      contactEmail: `stn-${tag.toLowerCase()}@staff.test`,
      position: 'Counselor',
    };

    await page.goto('/staff/new', { waitUntil: 'domcontentloaded' });
    const form = await hydratedForm(page, 'staff-form');
    for (const [field, value] of Object.entries(v)) await form.locator(`#${field}`).fill(value);
    await form.getByRole('button', { name: 'Create staff record' }).click();

    const name = `${v.firstName} ${v.lastName}`;
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible({
      timeout: SAVE_TIMEOUT,
    });
    await expect(page).toHaveURL(/\/staff\/[0-9a-f-]{36}$/);
    const staffId = page.url().split('/').pop()!;
    await page.reload({ waitUntil: 'domcontentloaded' });
    const details = page.getByRole('complementary', { name: 'Staff details sidebar' });
    await expect(details).toContainText(`Employee ID${v.identityNumber}`);
    await expect(details).toContainText(`Designation${v.position}`);
    await expect(details).toContainText(`Mobile${v.contactPhone}`);

    const saved = await getJson<Row>(request, admin, `/staff/${staffId}`);
    expect(Object.fromEntries(Object.keys(v).map((k) => [k, saved[k]]))).toEqual(v);
    expect(saved.status).toBe('ACTIVE');
  });

  test('/staff/[id]/edit: the edit form updates the record shown on its profile', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const admin = hrAdmin(`st-admin-${tag}`);
    const staff = await createStaff(request, admin, tag, { lastName: 'Edited' });
    await openAs(page, admin);
    const phone = '+15550009999';
    const position = 'Vice Principal';

    await page.goto(`/staff/${staff.id}/edit`, { waitUntil: 'domcontentloaded' });
    const form = await hydratedForm(page, 'staff-form');
    await form.locator('#contactPhone').fill(phone);
    await form.locator('#position').fill(position);
    await form.getByRole('button', { name: 'Save changes' }).click();

    await expect(page).toHaveURL(new RegExp(`/staff/${staff.id}$`), { timeout: SAVE_TIMEOUT });
    const details = page.getByRole('complementary', { name: 'Staff details sidebar' });
    await expect(details).toContainText(`Mobile${phone}`, { timeout: SAVE_TIMEOUT });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(details).toContainText(`Designation${position}`);
    await expect(details).toContainText(`Mobile${phone}`);

    const saved = await getJson<Row>(request, admin, `/staff/${staff.id}`);
    expect([saved.contactPhone, saved.position, saved.identityNumber]).toEqual([
      phone,
      position,
      staff.identityNumber,
    ]);
  });

  test('/staff/[id]/assignments/new: the assignment form saves a teaching assignment', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const admin = hrAdmin(`st-admin-${tag}`);
    const staff = await createStaff(request, admin, tag, { lastName: 'Assigned' });
    const school = await seedClassAndSubject(request, admin, tag);
    await openAs(page, admin);

    await page.goto(`/staff/${staff.id}/assignments/new?institutionId=${INSTITUTION_A}`, {
      waitUntil: 'domcontentloaded',
    });
    const form = await hydratedForm(page, 'staff-assignment-form');
    await expect(form.locator('#institutionId')).toContainText(INSTITUTION_A_NAME);
    await pickRadixOption(page, 'classId', school.klass.name);
    await pickRadixOption(page, 'subjectId', `${school.subject.name} (${school.subject.code})`);
    await form.locator('#role').fill('Subject teacher');
    await form.locator('#allocationPercentage').fill('30');
    const startDate = await form.locator('#startDate').inputValue();
    expect(startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await form.getByRole('button', { name: 'Create assignment' }).click();

    await expect(page).toHaveURL(new RegExp(`/staff/${staff.id}\\?tab=assignments$`), {
      timeout: SAVE_TIMEOUT,
    });
    const row = page
      .getByRole('table', { name: 'Staff assignments' })
      .getByRole('row')
      .filter({ hasText: school.klass.name });
    await expect(row).toHaveCount(1, { timeout: SAVE_TIMEOUT });
    await page.reload({ waitUntil: 'domcontentloaded' });
    for (const text of [
      INSTITUTION_A_NAME,
      school.subject.label,
      'Subject teacher',
      '30%',
      `${startDate} → present`,
      'Active',
    ]) {
      await expect(row).toContainText(text);
    }

    const saved = await getAllPages(request, admin, `/staff/assignments?staffId=${staff.id}`);
    expect(
      saved.map((a) => [a.institutionId, a.classId, a.subjectId, a.role, a.allocationPercentage]),
    ).toEqual([[INSTITUTION_A, school.klass.id, school.subject.id, 'Subject teacher', 30]]);
  });

  test('/staff/[id]/appraisals/new: the appraisal form saves a scored appraisal', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const admin = hrAdmin(`st-admin-${tag}`);
    const staff = await createStaff(request, admin, tag, { lastName: 'Appraised' });
    const template = await seedTemplate(request, admin, tag);
    await openAs(page, admin);
    const date = utcDate(-3);
    const comment = `ST overall comment ${tag}`;

    await page.goto(`/staff/${staff.id}/appraisals/new`, { waitUntil: 'domcontentloaded' });
    const form = await hydratedForm(page, 'staff-appraisal-form');
    await pickRadixOption(page, 'templateId', template.name);
    await expect(form.getByText(template.criteria[0]!.name)).toBeVisible();
    await form.locator('#appraisalDate').fill(date);
    await form.locator('#scores\\.0\\.score').fill('5');
    await form.locator('#scores\\.1\\.score').fill('4');
    await form.locator('#overallComment').fill(comment);
    await form.getByRole('button', { name: 'Save appraisal' }).click();

    await expect(page).toHaveURL(new RegExp(`/staff/${staff.id}\\?tab=appraisals$`), {
      timeout: SAVE_TIMEOUT,
    });
    const row = page
      .getByRole('table', { name: 'Staff appraisals' })
      .getByRole('row')
      .filter({ hasText: template.name });
    await expect(row).toHaveCount(1, { timeout: SAVE_TIMEOUT });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(row).toContainText(date);
    // Equal weights on a 0–5 scale with criterion maximum 5: (5 + 4) / 2.
    await expect(row).toContainText('4.50 / 5');

    const saved = await getAllPages(request, admin, `/staff/appraisals?staffId=${staff.id}`);
    expect(
      saved.map((a) => [a.templateId, a.appraisalDate, a.totalScore, a.overallComment]),
    ).toEqual([[template.id, date, 4.5, comment]]);
  });

  test('/staff/import: dry-run then commit creates the staff member and contract', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const admin = hrAdmin(`st-admin-${tag}`);
    await openAs(page, admin);
    const firstName = `StI${tag}`;
    const band = `STI${tag}`;
    const start = utcDate(CONTRACT_START_DAYS + 1);
    const end = utcDate(CONTRACT_START_DAYS + 300);
    const csv = [
      'firstName,lastName,dateOfBirth,identityNumber,contactPhone,position,contactEmail,contractType,startDate,endDate,salaryBand',
      `${firstName},Imported,1988-03-04,ST-I${tag},+15551230000,Teacher,sti-${tag.toLowerCase()}@staff.test,probation,${start},${end},${band}`,
    ].join('\n');

    await page.goto('/staff/import', { waitUntil: 'domcontentloaded' });
    const form = await hydratedForm(page, 'staff-import-form');
    await form.getByLabel('CSV text').fill(csv);
    await form.getByRole('button', { name: 'Dry-run' }).click();
    const report = form.getByTestId('staff-import-report');
    await expect(report).toContainText('1 row(s) · 1 valid', { timeout: SAVE_TIMEOUT });
    await expect(report).toContainText('No row errors.');
    await form.getByRole('button', { name: 'Commit import' }).click();
    await expect(form.getByTestId('staff-import-notice')).toHaveText('Created 1 staff record(s).', {
      timeout: SAVE_TIMEOUT,
    });
    await expect(report).toContainText('1 row(s) · 1 valid · 1 created');

    await page.goto(`/staff?search=${firstName}`, { waitUntil: 'domcontentloaded' });
    const row = page
      .getByRole('table', { name: 'Staff records' })
      .getByRole('row')
      .filter({ hasText: `${firstName} Imported` });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(`ST-I${tag}`);

    const staff = (await getJson<{ data: Row[] }>(request, admin, `/staff?search=${firstName}`))
      .data;
    expect(staff.map((s) => [s.firstName, s.lastName, s.identityNumber])).toEqual([
      [firstName, 'Imported', `ST-I${tag}`],
    ]);
    const contracts = await getAllPages(request, admin, `/staff/contracts?staffId=${staff[0]!.id}`);
    expect(contracts.map((c) => [c.contractType, c.startDate, c.endDate, c.salaryBand])).toEqual([
      ['probation', start, end, band],
    ]);
  });

  test('/staff/contracts: the contract and qualification forms save rows shown in the registry', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const admin = hrAdmin(`st-admin-${tag}`);
    const staff = await createStaff(request, admin, tag, { lastName: 'Contracted' });
    await openAs(page, admin);
    const band = `STC${tag}`;
    const start = utcDate(CONTRACT_START_DAYS + 2);
    const end = utcDate(CONTRACT_START_DAYS + 200);
    const notes = `ST form contract note ${tag}`;
    const degree = `ST form degree ${tag}`;
    const university = `ST form university ${tag}`;
    const docRef = `ST-FDOC-${tag}`;

    await page.goto('/staff/contracts', { waitUntil: 'domcontentloaded' });
    const cForm = await hydratedForm(page, 'staff-contract-form');
    await pickStaff(cForm, 'contract-staff', staff);
    await cForm.locator('#contract-type').selectOption('fixed_term');
    await cForm.locator('#contract-band').fill(band);
    await cForm.locator('#contract-start').fill(start);
    await cForm.locator('#contract-end').fill(end);
    await cForm.locator('#contract-notes').fill(notes);
    await cForm.getByRole('button', { name: 'Save contract' }).click();
    await expect(cForm.getByText('Contract recorded.', { exact: true })).toBeVisible({
      timeout: SAVE_TIMEOUT,
    });
    const contract = page.getByTestId('staff-contract-row').filter({ hasText: band });
    await expect(contract).toHaveCount(1, { timeout: SAVE_TIMEOUT });

    const qForm = await hydratedForm(page, 'staff-qualification-form');
    await pickStaff(qForm, 'qual-staff', staff);
    await qForm.locator('#qual-degree').fill(degree);
    await qForm.locator('#qual-inst').fill(university);
    await qForm.locator('#qual-year').fill('2100');
    await qForm.locator('#qual-doc').fill(docRef);
    await qForm.getByRole('button', { name: 'Save qualification' }).click();
    const qualification = page.getByTestId('staff-qualification-row').filter({ hasText: degree });
    await expect(qualification).toHaveCount(1, { timeout: SAVE_TIMEOUT });
    await expect(qForm.locator('#qual-degree')).toHaveValue('');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(contract).toContainText(`fixed_term · ${band} · active`);
    await expect(contract).toContainText(`${staff.label} · ${start} → ${end}`);
    await expect(qualification).toContainText(`${degree} · ${university} (2100)`);
    await expect(qualification).toContainText(`${staff.label} · ${docRef}`);

    const contracts = await getAllPages(request, admin, `/staff/contracts?staffId=${staff.id}`);
    expect(
      contracts.map((c) => [
        c.contractType,
        c.startDate,
        c.endDate,
        c.salaryBand,
        c.notes,
        c.status,
      ]),
    ).toEqual([['fixed_term', start, end, band, notes, 'active']]);
    const quals = await getAllPages(request, admin, `/staff/qualifications?staffId=${staff.id}`);
    expect(quals.map((q) => [q.degree, q.institution, q.year, q.documentRef, q.verified])).toEqual([
      [degree, university, 2100, docRef, false],
    ]);
  });

  test('/staff/leaves: request a leave through the form, then approve and reject on screen', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const admin = hrAdmin(`st-admin-${tag}`);
    const staff = await createStaff(request, admin, tag, { lastName: 'OnLeave' });
    await setLeaveBalance(request, admin, staff.id, 'annual', 10);
    const rejectReason = `ST to reject ${tag}`;
    const day = utcDate(20);
    const toReject = await postOk(request, admin, '/staff/leaves', {
      staffId: staff.id,
      leaveType: 'unpaid',
      startDate: day,
      endDate: day,
      reason: rejectReason,
    });
    await openAs(page, admin);
    const reason = `ST form leave reason ${tag}`;
    const start = utcDate(10);
    const end = utcDate(12);

    await page.goto('/staff/leaves', { waitUntil: 'domcontentloaded' });
    const form = page.locator('form').filter({ has: page.locator('#leave-staff') });
    await expect(form.locator('#leave-start')).toBeEnabled({ timeout: 30_000 });
    await pickStaff(form, 'leave-staff', staff);
    await form.locator('#leave-type').selectOption('annual');
    await form.locator('#leave-start').fill(start);
    await form.locator('#leave-end').fill(end);
    await form.locator('#leave-reason').fill(reason);
    await form.getByRole('button', { name: 'Submit leave' }).click();

    const row = page.getByTestId('staff-leave-row').filter({ hasText: reason });
    await expect(row).toHaveCount(1, { timeout: SAVE_TIMEOUT });
    await expect(row).toContainText(`annual · ${start} → ${end} · 3 days`);
    await expect(row.getByTestId('leave-status')).toHaveText('pending');
    await row.getByTestId('leave-approve').click();
    await page.getByTestId('staff-leave-approve-confirm-confirm').click();
    await expect(row.getByTestId('leave-decided')).toHaveText('approved', {
      timeout: SAVE_TIMEOUT,
    });

    const other = page.getByTestId('staff-leave-row').filter({ hasText: rejectReason });
    await other.getByTestId('leave-reject').click();
    await page.getByTestId('staff-leave-reject-confirm-confirm').click();
    await expect(other.getByTestId('leave-decided')).toHaveText('rejected', {
      timeout: SAVE_TIMEOUT,
    });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(row.getByTestId('leave-decided')).toHaveText('approved');
    await expect(other.getByTestId('leave-decided')).toHaveText('rejected');

    const mine = (await getAllPages(request, admin, '/staff/leaves')).filter(
      (l) => l.staffId === staff.id,
    );
    expect(
      mine
        .map((l) => [l.leaveType, l.startDate, l.endDate, l.reason, l.status])
        .sort((a, b) => String(a[1]).localeCompare(String(b[1]))),
    ).toEqual([
      ['annual', start, end, reason, 'approved'],
      ['unpaid', day, day, rejectReason, 'rejected'],
    ]);
    expect(mine.find((l) => l.id === toReject.id)?.decidedBy).toBe(admin.sub);
  });

  test('/staff/attendance: the mark grid saves a mark shown after reload and in the summary', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const admin = hrAdmin(`st-admin-${tag}`);
    const staff = await createStaff(request, admin, tag, { lastName: firstSortingLastName() });
    await openAs(page, admin);
    const date = utcDate(-334);

    await page.goto(`/staff/attendance?date=${date}`, { waitUntil: 'domcontentloaded' });
    const grid = await hydratedForm(page, 'staff-attendance-grid');
    const marks = grid.getByRole('group', { name: `Attendance for ${staff.name}` });
    await expect(marks.getByRole('radio')).toHaveCount(4);
    for (const radio of await marks.getByRole('radio').all()) await expect(radio).not.toBeChecked();
    await marks.getByRole('radio', { name: 'present' }).check();
    await grid.getByRole('button', { name: 'Save attendance' }).click();
    const summary = page
      .getByTestId('staff-attendance-summary-row')
      .filter({ hasText: staff.name });
    await expect(summary).toHaveText(
      `${staff.name} · present 1 · leave 0 · half-day 0 · payable 1`,
      { timeout: SAVE_TIMEOUT },
    );

    await page.reload({ waitUntil: 'domcontentloaded' });
    await hydratedForm(page, 'staff-attendance-grid');
    await expect(marks.getByRole('radio', { name: 'present' })).toBeChecked();
    await expect(summary).toHaveCount(1);

    const saved = await getAllPages(
      request,
      admin,
      `/staff/attendance?staffId=${staff.id}&date=${date}`,
    );
    expect(saved.map((m) => [m.date, m.status, m.markedBy])).toEqual([
      [date, 'present', admin.sub],
    ]);
  });

  test('/staff/payroll: building the export posts the month and shows the seeded amounts', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const admin = hrAdmin(`st-admin-${tag}`);
    const staff = await createStaff(request, admin, tag, { lastName: 'Payrolled' });
    const p = await seedPayrollMonth(request, admin, staff, tag);
    await openAs(page, admin);
    const rowText = `${staff.name} · band ${p.band} · present 1 · leave 1 · payable 1.5`;

    await page.goto('/staff/payroll', { waitUntil: 'domcontentloaded' });
    const panel = await hydratedForm(page, 'staff-payroll-panel');
    await panel.getByLabel('Month').fill(p.month);
    await panel.getByRole('button', { name: 'Build export' }).click();
    const row = panel.getByTestId('staff-payroll-row').filter({ hasText: staff.name });
    await expect(row).toHaveText(rowText, { timeout: SAVE_TIMEOUT });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      panel.getByRole('button', { name: 'Download CSV' }).click(),
    ]);
    const csv = parseCsv(await readFile(await download.path(), 'utf8'));
    const expected = {
      staffId: staff.id,
      name: staff.name,
      salaryBand: p.band,
      daysPresent: '1',
      leaveDays: '1',
      absentDays: '1',
      grossCents: String(p.grossCents),
      deductionsCents: String(p.deductionsCents),
      netCents: String(p.netCents),
      payableDays: '1.5',
    };
    expect(csv.filter((r) => r.staffId === staff.id)).toEqual([expected]);

    // The screen posted the month: the API returns that stored run with the same amounts.
    const stored = await exportPayroll(request, admin, p.month);
    expect(stored.idempotent).toBe(true);
    const apiRow = stored.rows.find((r) => r.staffId === staff.id);
    expect(
      apiRow &&
        Object.fromEntries(
          Object.keys(expected).map((k) => [k, String(apiRow[k as keyof typeof apiRow])]),
        ),
    ).toEqual(expected);

    await page.reload({ waitUntil: 'domcontentloaded' });
    const again = await hydratedForm(page, 'staff-payroll-panel');
    await again.getByLabel('Month').fill(p.month);
    await again.getByRole('button', { name: 'Build export' }).click();
    await expect(again.getByTestId('staff-payroll-row').filter({ hasText: staff.name })).toHaveText(
      rowText,
      { timeout: SAVE_TIMEOUT },
    );
  });
});
