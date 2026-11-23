import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import {
  BACKEND_READY,
  INSTITUTION_A,
  INSTITUTION_A_NAME,
  getJson,
  hrAdmin,
  hydratedForm,
  newTag,
  openAs,
  parseCsv,
  postOk,
  seedClassAndSubject,
  seedStaffData,
  seedSubstitution,
  seedTemplate,
  utcDate,
  type Row,
  type SeededSchool,
  type SeededStaffData,
  type SeededSubstitution,
  type SeededTemplate,
} from './fixtures/staff-screens';

/**
 * Staff / HR module — every screen shows rows written through the live API
 * (screen → API → DB).
 *
 * One beforeAll seeds a full HR data set with a unique tag through the gateway, then each
 * test opens one of the twelve staff screens as a tenant administrator and finds this
 * run's rows by their unique strings. Lists that read only a first page are handled by
 * making the seeded rows sort first (see fixtures/staff-screens.ts).
 */

interface ProfileExtras {
  school: SeededSchool;
  assignment: { id: string; role: string; allocation: number; startDate: string };
  template: SeededTemplate;
  appraisal: { id: string; date: string; status: string };
  program: { id: string; name: string };
  certification: { id: string; name: string; issued: string; expiry: string; status: string };
  substitution: SeededSubstitution;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

test.describe('Staff screens — read path (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires live gateway (E2E_BACKEND_READY)');

  let d: SeededStaffData;
  let x: ProfileExtras;
  const tag = newTag();
  const admin = hrAdmin(`st-admin-${tag}`);

  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    d = await seedStaffData(request, admin, tag);
    const school = await seedClassAndSubject(request, admin, tag);
    const assignment = await postOk(request, admin, '/staff/assignments', {
      staffId: d.staff.id,
      institutionId: INSTITUTION_A,
      subjectId: school.subject.id,
      classId: school.klass.id,
      role: 'Class teacher',
      allocationPercentage: 40,
      startDate: utcDate(-2),
    });
    const template = await seedTemplate(request, admin, tag);
    const appraisalDate = utcDate(-1);
    const appraisal = await postOk(request, admin, '/staff/appraisals', {
      staffId: d.staff.id,
      templateId: template.id,
      appraisalDate,
      scores: template.criteria.map((c) => ({ criterionName: c.name, score: 4 })),
      overallComment: `ST appraisal comment ${tag}`,
    });
    const programName = `ST program ${tag}`;
    const program = await postOk(request, admin, '/staff/training/programs', {
      name: programName,
      startDate: utcDate(3650),
      endDate: utcDate(3651),
      provider: `ST provider ${tag}`,
    });
    const certName = `ST certificate ${tag}`;
    const issued = utcDate(-10);
    const expiry = utcDate(355);
    const cert = await postOk(request, admin, '/staff/training/certifications', {
      staffId: d.staff.id,
      programId: program.id,
      certificationName: certName,
      issuedDate: issued,
      expiryDate: expiry,
    });
    const substitution = await seedSubstitution(request, admin, tag);
    x = {
      school,
      assignment: {
        id: assignment.id,
        role: 'Class teacher',
        allocation: 40,
        startDate: utcDate(-2),
      },
      template,
      appraisal: { id: appraisal.id, date: appraisalDate, status: String(appraisal.status) },
      program: { id: program.id, name: programName },
      certification: {
        id: cert.id,
        name: certName,
        issued,
        expiry,
        status: String(cert.status),
      },
      substitution,
    };
  });

  test.beforeEach(async ({ page }) => {
    await openAs(page, admin);
  });

  test('/staff lists the seeded staff member with employee ID, designation and status', async ({
    page,
  }) => {
    await page.goto(`/staff?search=${d.staff.firstName}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Staff' })).toBeVisible();
    const row = page
      .getByRole('table', { name: 'Staff records' })
      .getByRole('row')
      .filter({ hasText: d.staff.name });
    await expect(row).toHaveCount(1);
    await expect(row.getByRole('link', { name: d.staff.name, exact: true })).toHaveAttribute(
      'href',
      `/staff/${d.staff.id}`,
    );
    await expect(row).toContainText(d.staff.identityNumber);
    await expect(row).toContainText(d.staff.position);
    await expect(row).toContainText('Active');
  });

  test('/staff/[id] shows details, leave taken, assignments, appraisals and training', async ({
    page,
  }) => {
    await page.goto(`/staff/${d.staff.id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: d.staff.name })).toBeVisible();
    const details = page.getByRole('complementary', { name: 'Staff details sidebar' });
    await expect(details).toContainText(`Employee ID${d.staff.identityNumber}`);
    await expect(details).toContainText(`Mobile${d.staff.contactPhone}`);
    await expect(details).toContainText(`Email${d.staff.contactEmail}`);
    const usage = page.getByTestId('staff-leave-usage');
    await expect(usage).toContainText('Casual0 days approved · 1 pending');
    await expect(usage).toContainText('Sick1 day approved');
    await expect(details).toContainText(`4.0 / 5${x.appraisal.status}${x.appraisal.date}`);
    await expect(page.getByText(x.school.subject.label, { exact: true })).toBeVisible();

    await page.goto(`/staff/${d.staff.id}?tab=assignments`, { waitUntil: 'domcontentloaded' });
    const assignment = page
      .getByRole('table', { name: 'Staff assignments' })
      .getByRole('row')
      .filter({ hasText: x.school.klass.name });
    await expect(assignment).toHaveCount(1);
    for (const text of [
      INSTITUTION_A_NAME,
      x.school.subject.label,
      x.assignment.role,
      '40%',
      `${x.assignment.startDate} → present`,
      'Active',
    ]) {
      await expect(assignment).toContainText(text);
    }

    await page.goto(`/staff/${d.staff.id}?tab=appraisals`, { waitUntil: 'domcontentloaded' });
    const appraisal = page
      .getByRole('table', { name: 'Staff appraisals' })
      .getByRole('row')
      .filter({ hasText: x.template.name });
    await expect(appraisal).toHaveCount(1);
    await expect(appraisal).toContainText(x.appraisal.date);
    await expect(appraisal).toContainText('4.00 / 5');
    await expect(appraisal).toContainText(titleCase(x.appraisal.status));

    await page.goto(`/staff/${d.staff.id}?tab=training`, { waitUntil: 'domcontentloaded' });
    const cert = page
      .getByRole('table', { name: 'Training certifications' })
      .getByRole('row')
      .filter({ hasText: x.certification.name });
    await expect(cert).toHaveCount(1);
    for (const text of [
      x.program.name,
      x.certification.issued,
      x.certification.expiry,
      titleCase(x.certification.status),
    ]) {
      await expect(cert).toContainText(text);
    }
  });

  test('/staff/[id]/appraisals/new names the staff member and offers the seeded template', async ({
    page,
  }) => {
    await page.goto(`/staff/${d.staff.id}/appraisals/new`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'New appraisal' })).toBeVisible();
    await expect(page.getByText(`Rate ${d.staff.name} on each criterion`)).toBeVisible();
    await hydratedForm(page, 'staff-appraisal-form');
    await page.locator('#templateId').click();
    await expect(page.getByRole('option', { name: x.template.name, exact: true })).toBeVisible();
  });

  test('/staff/[id]/assignments/new shows the seeded assignment in the current workload', async ({
    page,
  }) => {
    await page.goto(`/staff/${d.staff.id}/assignments/new?institutionId=${INSTITUTION_A}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(
      page.getByRole('heading', { level: 1, name: 'New teaching assignment' }),
    ).toBeVisible();
    await expect(page.getByText(`subject to ${d.staff.name}.`)).toBeVisible();
    await expect(page.getByText(`${d.staff.name} · active assignments`)).toBeVisible();
    await expect(
      page.getByText(`${x.school.klass.name} — ${x.school.subject.label}`, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Light · 40%', { exact: true })).toBeVisible();
    await hydratedForm(page, 'staff-assignment-form');
  });

  test('/staff/[id]/edit loads the seeded record into the form', async ({ page }) => {
    await page.goto(`/staff/${d.staff.id}/edit`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: `Edit ${d.staff.name}` })).toBeVisible();
    const form = await hydratedForm(page, 'staff-form');
    await expect(form.locator('#firstName')).toHaveValue(d.staff.firstName);
    await expect(form.locator('#lastName')).toHaveValue(d.staff.lastName);
    await expect(form.locator('#identityNumber')).toHaveValue(d.staff.identityNumber);
    await expect(form.locator('#contactPhone')).toHaveValue(d.staff.contactPhone);
    await expect(form.locator('#contactEmail')).toHaveValue(d.staff.contactEmail);
    await expect(form.locator('#position')).toHaveValue(d.staff.position);
  });

  test('/staff/attendance shows the seeded mark for its date and the monthly summary', async ({
    page,
  }) => {
    await page.goto(`/staff/attendance?date=${d.attendance.date}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByRole('heading', { level: 1, name: 'Staff attendance' })).toBeVisible();
    await expect(page.getByText(`Mark ${d.attendance.date}`)).toBeVisible();
    const grid = await hydratedForm(page, 'staff-attendance-grid');
    const marks = grid.getByRole('group', { name: `Attendance for ${d.staff.name}` });
    await expect(marks.getByRole('radio', { name: 'half-day' })).toBeChecked();
    await expect(marks.getByRole('radio', { name: 'present' })).not.toBeChecked();
    await expect(
      page.getByText(`Monthly summary (${d.attendance.date.slice(0, 7)})`),
    ).toBeVisible();
    await expect(
      page.getByTestId('staff-attendance-summary-row').filter({ hasText: d.staff.name }),
    ).toHaveText(`${d.staff.name} · present 0 · leave 0 · half-day 1 · payable 0.5`);
  });

  test('/staff/contracts lists the seeded contract and qualification', async ({ page }) => {
    await page.goto('/staff/contracts', { waitUntil: 'domcontentloaded' });
    await expect(
      page.getByRole('heading', { level: 1, name: 'Contracts & qualifications' }),
    ).toBeVisible();
    const contract = page.getByTestId('staff-contract-row').filter({ hasText: d.contract.band });
    await expect(contract).toHaveCount(1);
    await expect(contract).toContainText(`fixed_term · ${d.contract.band} · active`);
    await expect(contract).toContainText(
      `${d.staff.label} · ${d.contract.startDate} → ${d.contract.endDate}`,
    );
    const qualification = page
      .getByTestId('staff-qualification-row')
      .filter({ hasText: d.qualification.degree });
    await expect(qualification).toHaveCount(1);
    await expect(qualification).toContainText(
      `${d.qualification.degree} · ${d.qualification.institution} (2100)`,
    );
    await expect(qualification).toContainText(`${d.staff.label} · ${d.qualification.documentRef}`);
  });

  test('/staff/import renders the bulk import form', async ({ page }) => {
    await page.goto('/staff/import', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: /bulk staff import/i })).toBeVisible();
    const form = await hydratedForm(page, 'staff-import-form');
    await expect(form.getByLabel('CSV text')).toHaveValue(/^firstName,lastName,dateOfBirth/);
    await expect(form.getByRole('button', { name: 'Commit import' })).toBeDisabled();
  });

  test('/staff/leaves lists the seeded pending and approved leave', async ({ page }) => {
    await page.goto('/staff/leaves', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Staff leave' })).toBeVisible();
    const pending = page.getByTestId('staff-leave-row').filter({ hasText: d.pendingLeave.reason });
    await expect(pending).toHaveCount(1);
    await expect(pending).toContainText(
      `casual · ${d.pendingLeave.date} → ${d.pendingLeave.date} · 1 day`,
    );
    await expect(pending).toContainText(d.staff.label);
    await expect(pending.getByTestId('leave-status')).toHaveText('pending');
    await expect(pending.getByTestId('leave-approve')).toBeVisible();
    const approved = page
      .getByTestId('staff-leave-row')
      .filter({ hasText: d.approvedLeave.reason });
    await expect(approved).toHaveCount(1);
    await expect(approved).toContainText(
      `sick · ${d.approvedLeave.date} → ${d.approvedLeave.date} · 1 day`,
    );
    await expect(approved.getByTestId('leave-decided')).toHaveText('approved');
    await expect(approved.getByTestId('leave-approve')).toHaveCount(0);
  });

  test('/staff/new renders the add-staff form', async ({ page }) => {
    await page.goto('/staff/new', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Add staff member' })).toBeVisible();
    const form = await hydratedForm(page, 'staff-form');
    await expect(form.locator('#firstName')).toHaveValue('');
  });

  test('/staff/payroll shows the seeded ledger amounts of the posted month', async ({
    page,
    request,
  }) => {
    const p = d.payroll;
    await page.goto('/staff/payroll', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Payroll export' })).toBeVisible();
    const panel = await hydratedForm(page, 'staff-payroll-panel');
    await panel.getByLabel('Month').fill(p.month);
    await panel.getByRole('button', { name: 'Build export' }).click();
    const row = panel.getByTestId('staff-payroll-row').filter({ hasText: d.staff.name });
    await expect(row).toHaveText(
      `${d.staff.name} · band ${p.band} · present 1 · leave 1 · payable 1.5`,
      { timeout: 30_000 },
    );
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      panel.getByRole('button', { name: 'Download CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(`payroll-${p.month}.csv`);
    const csv = parseCsv(await readFile(await download.path(), 'utf8'));
    expect(csv.filter((r) => r.staffId === d.staff.id)).toEqual([
      {
        staffId: d.staff.id,
        name: d.staff.name,
        salaryBand: p.band,
        daysPresent: '1',
        leaveDays: '1',
        absentDays: '1',
        grossCents: String(p.grossCents),
        deductionsCents: String(p.deductionsCents),
        netCents: String(p.netCents),
        payableDays: '1.5',
      },
    ]);
    // The screen showed the run this test posted in beforeAll.
    const stored = await getJson<{ idempotent: boolean; rows: Row[] }>(
      request,
      admin,
      `/staff/payroll/export?month=${p.month}`,
    );
    expect(stored.idempotent).toBe(true);
  });

  test('/staff/substitutions lists the seeded substitution with both teachers', async ({
    page,
    request,
  }) => {
    const s = x.substitution;
    await page.goto('/staff/substitutions', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Substitutions' })).toBeVisible();
    const row = page.locator('main tbody tr').filter({ hasText: s.reason });
    await expect(row).toHaveCount(1);
    const cells = row.locator('td');
    await expect(cells.nth(0)).toHaveText(s.date);
    await expect(cells.nth(2)).toHaveText(s.original.label);
    await expect(cells.nth(3)).toHaveText(s.substitute.label);
    await expect(cells.nth(4)).toHaveText(s.reason);
    await expect(cells.nth(5)).toHaveText(s.status);
    const api = await getJson<{ data: Row[] }>(request, admin, '/timetable/substitutions');
    expect(api.data.filter((r) => r.id === s.id).map((r) => [r.reason, r.status])).toEqual([
      [s.reason, s.status],
    ]);
  });
});
