import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import {
  BACKEND_READY,
  buildImportWorkbook,
  chooseOption,
  classLabel,
  deleteStudents,
  deleteTagged,
  enroll,
  enrollmentsOf,
  getJson,
  hydratedForm,
  newTag,
  openAs,
  placement,
  reloadUntil,
  searchStudents,
  seedStudent,
  stAdmin,
  utcDate,
  waitForReact,
  type Row,
} from './fixtures/students-screens';

/**
 * Students module — every write screen saves through its own form (spec 101).
 *
 * Each test seeds its own tagged rows as a tenant administrator, saves through the
 * screen's form, confirms the result on screen, then reads the stored value back through
 * the gateway. Every student a test creates is deleted in `finally`.
 *
 * Known open defects (defects.md) are asserted only in patches/: the edit form does not
 * send If-Match (I1), an "Update existing" import that carries institution_code or
 * guardian columns drops the admission number or the guardians (I2, I3), enrollment
 * accepts a class from another institution (I4), the profile status pill after
 * graduation (P7), the transfer copy that promises an approval step (P2) and the import
 * duplicate table that names the existing student by raw id (P8).
 */

/** Value of one import result tile (`Total rows`, `Imported`, `Errors`, `Duplicates`). */
function stat(page: Page, label: string) {
  return page
    .locator('p.uppercase', { hasText: new RegExp(`^${label}$`) })
    .locator('xpath=following-sibling::p[1]');
}

test.describe('Students screens — write (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires live gateway (E2E_BACKEND_READY)');

  test('/students/new saves a student with a contact and a guardian', async ({ page, request }) => {
    const tag = newTag();
    const admin = stAdmin(`st-admin-${tag}`);
    const firstName = `St${tag}N`;
    const dob = utcDate(-(10 * 365 + 40));
    let createdId = '';
    try {
      await openAs(page, admin);
      await page.goto('/students/new', { waitUntil: 'load' });
      const form = await hydratedForm(page, 'student-form');
      await form.locator('#firstName').fill(firstName);
      await form.locator('#lastName').fill('Learner');
      await form.locator('#dateOfBirth').fill(dob);
      await chooseOption(page, 'gender', 'Male');
      await form.locator('#nationalId').fill(`ST-${tag}-NEW`);
      await form.locator('#nationality').fill('ST');
      await form.getByRole('button', { name: 'Add contact' }).click();
      await form.locator('[id="contacts.0.type"]').selectOption('email');
      await form.locator('[id="contacts.0.value"]').fill(`st.${tag.toLowerCase()}@new.test`);
      await form.getByRole('button', { name: 'Add guardian' }).click();
      await form.locator('[id="guardians.0.firstName"]').fill(`St${tag}G`);
      await form.locator('[id="guardians.0.lastName"]').fill('Guardian');
      await form.locator('[id="guardians.0.relationship"]').fill('aunt');
      await form.locator('[id="guardians.0.contactPhone"]').fill(`000-${tag}-7`);
      await form.locator('[id="guardians.0.contactEmail"]').fill(`g.${tag.toLowerCase()}@new.test`);
      await form.getByRole('button', { name: 'Save student' }).click();

      await expect(page).toHaveURL(/\/students\/[0-9a-f-]{36}$/, { timeout: 30_000 });
      createdId = page.url().split('/').pop()!;
      await expect(page.getByTestId('student-profile-heading')).toHaveText(`${firstName} Learner`);

      const stored = await getJson<Row>(request, admin, `/students/${createdId}`);
      expect(stored).toMatchObject({
        firstName,
        lastName: 'Learner',
        gender: 'male',
        nationalId: `ST-${tag}-NEW`,
        nationality: 'ST',
        contacts: [{ type: 'email', value: `st.${tag.toLowerCase()}@new.test`, isPrimary: false }],
      });
      expect(String(stored.dateOfBirth).slice(0, 10)).toBe(dob);
      expect(stored.guardians).toEqual([
        expect.objectContaining({
          firstName: `St${tag}G`,
          lastName: 'Guardian',
          relationship: 'aunt',
          contactPhone: `000-${tag}-7`,
          contactEmail: `g.${tag.toLowerCase()}@new.test`,
        }),
      ]);
      const admissionNo = String((stored.customData as Row).admissionNo ?? '');
      expect(admissionNo).toMatch(/\S/);
      await expect(page.getByText(`Adm. ${admissionNo}`, { exact: true })).toBeVisible();
    } finally {
      if (createdId) await deleteStudents(request, admin, [createdId]);
      await deleteTagged(request, admin, `St${tag}N`);
    }
  });

  test('/students/[id]/edit saves a changed name and guardian phone', async ({ page, request }) => {
    const tag = newTag();
    const admin = stAdmin(`st-admin-${tag}`);
    const s = await seedStudent(request, admin, tag);
    try {
      await openAs(page, admin);
      await page.goto(`/students/${s.id}/edit`, { waitUntil: 'load' });
      const form = await hydratedForm(page, 'student-form');
      await expect(form.locator('#lastName')).toHaveValue(s.lastName);
      await form.locator('#lastName').fill('Edited');
      await form.locator('[id="guardians.0.contactPhone"]').fill(`000-${tag}-9`);
      await form.getByRole('button', { name: 'Save changes' }).click();

      await expect(page).toHaveURL(new RegExp(`/students/${s.id}$`), { timeout: 30_000 });
      await expect(page.getByTestId('student-profile-heading')).toHaveText(`${s.firstName} Edited`);
      await page.getByRole('tab', { name: 'Guardians' }).click();
      const guardians = page.getByRole('table', { name: 'Guardians' });
      await expect(
        guardians.getByRole('row').filter({ hasText: `${s.guardians[0]!.firstName} Guardian` }),
      ).toContainText(`000-${tag}-9`);
      await expect(
        guardians.getByRole('row').filter({ hasText: `${s.guardians[1]!.firstName} Guardian` }),
      ).toContainText(s.guardians[1]!.contactPhone);

      const stored = await getJson<Row>(request, admin, `/students/${s.id}`);
      expect(stored.lastName).toBe('Edited');
      expect(stored.nationalId).toBe(s.nationalId);
      expect((stored.customData as Row).admissionNo).toBe(s.admissionNo);
      expect(stored.guardians).toEqual([
        expect.objectContaining({ ...s.guardians[0], contactPhone: `000-${tag}-9` }),
        expect.objectContaining({ ...s.guardians[1] }),
      ]);
    } finally {
      await deleteStudents(request, admin, [s.id]);
    }
  });

  test('/students/[id]/enroll places the student in a class', async ({ page, request }) => {
    const tag = newTag();
    const admin = stAdmin(`st-admin-${tag}`);
    const pl = await placement(request, admin);
    const s = await seedStudent(request, admin, tag);
    try {
      await openAs(page, admin);
      await page.goto(`/students/${s.id}`, { waitUntil: 'load' });
      await page.getByTestId('student-enroll-cta').click();
      await expect(page).toHaveURL(new RegExp(`/students/${s.id}/enroll$`));
      const form = page.getByTestId('enroll-form');
      await waitForReact(form);
      await chooseOption(page, 'institutionId', pl.source.institutionName);
      await chooseOption(page, 'gradeId', pl.grade.name);
      await chooseOption(page, 'academicPeriodId', pl.period.name);
      await chooseOption(page, 'classId', pl.source.className);
      await expect(form.locator('#enrolledAt')).toHaveValue(utcDate(0));
      await page.getByTestId('enroll-submit').click();

      await expect(page).toHaveURL(new RegExp(`/students/${s.id}\\?enrolled=1$`), {
        timeout: 30_000,
      });
      await expect(page.getByTestId('student-profile-class')).toHaveText(classLabel(pl));
      await expect(page.getByRole('link', { name: /request transfer/i })).toBeVisible();
      await expect(page.getByTestId('student-enroll-cta')).toHaveCount(0);

      const rows = await enrollmentsOf(request, admin, s.id);
      expect(rows).toEqual([
        expect.objectContaining({
          studentId: s.id,
          institutionId: pl.source.institutionId,
          gradeId: pl.grade.id,
          classId: pl.source.classId,
          academicPeriodId: pl.period.id,
          status: 'ENROLLED',
        }),
      ]);
      await page.getByRole('tab', { name: 'History' }).click();
      const history = page.getByRole('table', { name: 'Enrollment history' });
      await expect(history.getByRole('row').filter({ hasText: utcDate(0) })).toContainText(
        pl.source.institutionName,
      );
    } finally {
      await deleteStudents(request, admin, [s.id]);
    }
  });

  test('/students/[id]/transfer moves the student to the destination class', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const admin = stAdmin(`st-admin-${tag}`);
    const pl = await placement(request, admin);
    const s = await seedStudent(request, admin, tag);
    try {
      const sourceEnrollmentId = await enroll(request, admin, s.id, pl);
      const reason = `ST ${tag} transfer reason`;
      await openAs(page, admin);
      await page.goto(`/students/${s.id}/transfer`, { waitUntil: 'load' });
      // The destination institution may be newer than the cached institution list.
      await reloadUntil(page, async () => {
        expect(await page.content()).toContain(pl.destination.institutionName);
      });
      await waitForReact(page.locator('#reason'));
      await chooseOption(page, 'destinationInstitutionId', pl.destination.institutionName);
      await chooseOption(page, 'destinationGradeId', pl.grade.name);
      await chooseOption(page, 'academicPeriodId', pl.period.name);
      await chooseOption(page, 'destinationClassId', pl.destination.className);
      await expect(page.locator('#transferDate')).toHaveValue(utcDate(0));
      await page.locator('#reason').fill(reason);
      await page.getByRole('button', { name: /^Submit transfer/ }).click();

      await expect(page).toHaveURL(new RegExp(`/students/${s.id}\\?transfer=submitted$`), {
        timeout: 30_000,
      });
      await reloadUntil(page, async () => {
        await expect(page.getByTestId('student-profile-class')).toHaveText(
          classLabel(pl, 'destination'),
        );
      });
      const head = page.getByTestId('student-profile-heading').locator('xpath=..');
      await expect(head.getByText(pl.destination.institutionName, { exact: true })).toBeVisible();
      await page.getByRole('tab', { name: 'History' }).click();
      const transfers = page.getByRole('table', { name: 'Transfer records' });
      await expect(transfers.getByRole('row').filter({ hasText: reason })).toHaveCount(1);
      await expect(transfers.getByRole('row').filter({ hasText: reason })).toContainText(
        pl.destination.institutionName,
      );

      const rows = await enrollmentsOf(request, admin, s.id);
      const source = rows.find((r) => r.id === sourceEnrollmentId);
      const dest = rows.find((r) => r.id !== sourceEnrollmentId);
      expect(rows).toHaveLength(2);
      expect(source?.status).toBe('TRANSFERRED');
      expect(dest).toMatchObject({
        institutionId: pl.destination.institutionId,
        classId: pl.destination.classId,
        gradeId: pl.grade.id,
        status: 'ENROLLED',
      });
      const records = await getJson<{ data: Row[] }>(
        request,
        admin,
        `/enrollments/student/${s.id}/transfers`,
      );
      expect(records.data).toEqual([
        expect.objectContaining({
          sourceInstitutionId: pl.source.institutionId,
          destinationInstitutionId: pl.destination.institutionId,
          reason,
          transferDate: utcDate(0),
        }),
      ]);
    } finally {
      await deleteStudents(request, admin, [s.id]);
    }
  });

  test('/students/import creates the valid rows and reports the invalid one', async ({
    page,
    request,
  }) => {
    test.slow();
    const tag = newTag();
    const admin = stAdmin(`st-admin-${tag}`);
    const prefix = `St${tag}I`;
    const dob = utcDate(-(9 * 365 + 20));
    try {
      const workbook = await buildImportWorkbook([
        { first_name: `${prefix}1`, last_name: 'Imported', date_of_birth: dob, gender: 'female' },
        {
          first_name: `${prefix}2`,
          last_name: 'Imported',
          date_of_birth: dob,
          gender: 'male',
          national_id: `ST-${tag}-IMP2`,
        },
        { first_name: '', last_name: 'Imported', date_of_birth: dob },
      ]);
      await openAs(page, admin);
      await page.goto('/students/import', { waitUntil: 'load' });
      await waitForReact(page.locator('#import-file'));
      await page.locator('#import-file').setInputFiles({
        name: `st-${tag}.xlsx`,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: workbook,
      });
      await expect(page.locator('#duplicateResolution')).toHaveText('Skip duplicates');
      await page.getByRole('button', { name: 'Start import' }).click();
      await page.getByTestId('bulk-import-confirm-confirm').click();

      await expect(
        page.getByRole('status').filter({ hasText: 'Imported 2 of 3 rows.' }),
      ).toBeVisible({ timeout: 60_000 });
      await expect(stat(page, 'Total rows')).toHaveText('3');
      await expect(stat(page, 'Imported')).toHaveText('2');
      await expect(stat(page, 'Errors')).toHaveText('1');
      await expect(stat(page, 'Duplicates')).toHaveText('0');
      const errors = page.getByRole('table', { name: 'Validation errors' });
      await expect(errors.getByRole('row')).toHaveCount(2);
      await expect(errors.getByRole('row').nth(1).getByRole('cell').nth(1)).toHaveText(
        'first_name',
      );

      const stored = await searchStudents(request, admin, prefix);
      expect(stored.map((r) => r.firstName).sort()).toEqual([`${prefix}1`, `${prefix}2`]);
      expect(stored.find((r) => r.firstName === `${prefix}2`)?.nationalId).toBe(`ST-${tag}-IMP2`);
      await page.goto(`/students?search=${prefix}`, { waitUntil: 'load' });
      await expect(page.getByTestId('student-row-name')).toHaveCount(2);
      for (const name of [`${prefix}1 Imported`, `${prefix}2 Imported`]) {
        await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
      }
    } finally {
      await deleteTagged(request, admin, prefix);
    }
  });

  test('/students/import with "Update existing" updates the matched student', async ({
    page,
    request,
  }) => {
    test.slow();
    const tag = newTag();
    const admin = stAdmin(`st-admin-${tag}`);
    const s = await seedStudent(request, admin, tag);
    try {
      const workbook = await buildImportWorkbook([
        {
          first_name: s.firstName,
          last_name: 'Updated',
          date_of_birth: s.dateOfBirth,
          national_id: s.nationalId,
        },
      ]);
      await openAs(page, admin);
      await page.goto('/students/import', { waitUntil: 'load' });
      await waitForReact(page.locator('#import-file'));
      await chooseOption(page, 'duplicateResolution', 'Update existing records');
      await page.locator('#import-file').setInputFiles({
        name: `st-${tag}-update.xlsx`,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: workbook,
      });
      await page.getByRole('button', { name: 'Start import' }).click();
      await page.getByTestId('bulk-import-confirm-confirm').click();

      await expect(stat(page, 'Duplicates')).toHaveText('1', { timeout: 60_000 });
      await expect(stat(page, 'Total rows')).toHaveText('1');
      await expect(stat(page, 'Errors')).toHaveText('0');
      // The third cell (existing student) shows a raw id today (M1-P8, defects.md).
      const dupes = page.getByRole('table', { name: 'Duplicate matches' });
      const dupe = dupes.getByRole('row').nth(1).getByRole('cell');
      await expect(dupe.nth(0)).toHaveText('2');
      await expect(dupe.nth(1)).toHaveText('national_id');

      await page.goto(`/students/${s.id}`, { waitUntil: 'load' });
      await expect(page.getByTestId('student-profile-heading')).toHaveText(
        `${s.firstName} Updated`,
      );
      const stored = await getJson<Row>(request, admin, `/students/${s.id}`);
      expect(stored.lastName).toBe('Updated');
      expect(stored.nationalId).toBe(s.nationalId);
      expect(await searchStudents(request, admin, s.firstName)).toHaveLength(1);
    } finally {
      await deleteStudents(request, admin, [s.id]);
    }
  });

  test('/students/[id] Graduate closes the active enrollment', async ({ page, request }) => {
    const tag = newTag();
    const admin = stAdmin(`st-admin-${tag}`);
    const pl = await placement(request, admin);
    const s = await seedStudent(request, admin, tag);
    try {
      const enrollmentId = await enroll(request, admin, s.id, pl);
      await openAs(page, admin);
      await page.goto(`/students/${s.id}`, { waitUntil: 'load' });
      const button = page.getByTestId('graduate-student');
      await waitForReact(button);
      page.once('dialog', (dialog) => void dialog.accept());
      await button.click();
      await expect(page.getByRole('status').filter({ hasText: 'Student graduated.' })).toBeVisible({
        timeout: 30_000,
      });

      const rows = await enrollmentsOf(request, admin, s.id);
      expect(rows).toEqual([expect.objectContaining({ id: enrollmentId, status: 'GRADUATED' })]);
      await page.goto(`/students/${s.id}`, { waitUntil: 'load' });
      await page.getByRole('tab', { name: 'History' }).click();
      const history = page.getByRole('table', { name: 'Enrollment history' });
      const graduated = history
        .getByRole('row')
        .filter({ hasText: 'Graduated from student profile' });
      await expect(graduated).toHaveCount(1);
      await expect(graduated.getByRole('cell').nth(1)).toHaveText('ENROLLED');
      await expect(graduated.getByRole('cell').nth(2)).toHaveText('Graduated');
      await expect(page.getByTestId('graduate-student')).toHaveCount(0);
    } finally {
      await deleteStudents(request, admin, [s.id]);
    }
  });

  test('/students bulk graduate marks the selected student Alumni', async ({ page, request }) => {
    const tag = newTag();
    const admin = stAdmin(`st-admin-${tag}`);
    const pl = await placement(request, admin);
    const s = await seedStudent(request, admin, tag);
    try {
      const enrollmentId = await enroll(request, admin, s.id, pl);
      await openAs(page, admin);
      await page.goto(`/students?search=${s.firstName}`, { waitUntil: 'load' });
      const bar = page.getByTestId('students-bulk-graduate-bar');
      const checkbox = bar.getByRole('checkbox', { name: `Select ${s.name}` });
      await waitForReact(checkbox);
      await checkbox.click();
      page.once('dialog', (dialog) => void dialog.accept());
      await bar.getByRole('button', { name: 'Graduate selected (1)' }).click();
      await expect(bar.getByRole('status')).toHaveText('Graduated 1 enrollment.', {
        timeout: 30_000,
      });

      const rows = await enrollmentsOf(request, admin, s.id);
      expect(rows).toEqual([expect.objectContaining({ id: enrollmentId, status: 'GRADUATED' })]);
      await page.goto(`/students?search=${s.firstName}`, { waitUntil: 'load' });
      const row = page
        .getByRole('row')
        .filter({ has: page.getByRole('link', { name: s.name, exact: true }) });
      await expect(row.getByText('Alumni', { exact: true })).toBeVisible();
      await expect(page.getByTestId('students-bulk-graduate-bar')).toHaveCount(0);
    } finally {
      await deleteStudents(request, admin, [s.id]);
    }
  });

  test('/students/[id] records and removes a discipline incident and sets a consent', async ({
    page,
    request,
  }) => {
    test.slow();
    const tag = newTag();
    const admin = stAdmin(`st-admin-${tag}`);
    const s = await seedStudent(request, admin, tag);
    const incidentType = `ST ${tag} Uniform`;
    const description = `ST ${tag} wore the wrong uniform`;
    try {
      await openAs(page, admin);
      await page.goto(`/students/${s.id}`, { waitUntil: 'load' });
      const panel = page.getByTestId('student-360');
      await expect(panel).toHaveAttribute('data-hydrated', 'true');
      await expect(panel.getByTestId('discipline-empty')).toBeVisible();
      await panel.getByTestId('discipline-add').click();
      const form = page.getByTestId('discipline-form');
      await expect(form).toHaveAttribute('data-hydrated', 'true');
      await form.getByTestId('discipline-type').fill(incidentType);
      await form.getByTestId('discipline-date').fill(utcDate(0));
      await form.getByTestId('discipline-description').fill(description);
      await chooseOption(page, 'di-severity', 'Medium');
      await form.getByRole('button', { name: 'Save incident' }).click();

      const row = panel.getByTestId('discipline-row');
      await expect(row).toHaveCount(1, { timeout: 30_000 });
      await expect(row.getByRole('cell')).toHaveText([
        utcDate(0),
        `${incidentType}${description}`,
        'medium',
        'Staff only',
        '',
      ]);
      const stored = await getJson<{ data: Row[] }>(request, admin, `/students/${s.id}/discipline`);
      expect(stored.data).toEqual([
        expect.objectContaining({
          incidentType,
          description,
          severity: 'medium',
          incidentDate: utcDate(0),
          visibleToParent: false,
        }),
      ]);

      await row.getByTestId('discipline-remove').click();
      await page.getByTestId('discipline-remove-confirm-confirm').click();
      await expect(panel.getByTestId('discipline-empty')).toBeVisible({ timeout: 30_000 });
      const after = await getJson<{ data: Row[] }>(request, admin, `/students/${s.id}/discipline`);
      expect(after.data).toEqual([]);

      // Fresh load so the removal's refresh cannot race the toggle.
      await page.goto(`/students/${s.id}`, { waitUntil: 'load' });
      await expect(panel.getByTestId('student-consents')).toHaveAttribute('data-hydrated', 'true');
      const toggle = panel.getByTestId('consent-toggle-trips');
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await toggle.click();
      const trips = panel
        .getByTestId('student-consents')
        .locator('div', { has: page.getByTestId('consent-toggle-trips') })
        .last();
      await expect(trips).toContainText('Granted · by', { timeout: 30_000 });
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      const consents = await getJson<{ data: Row[] }>(request, admin, `/students/${s.id}/consents`);
      expect(consents.data.filter((c) => c.kind === 'trips')).toEqual([
        expect.objectContaining({ kind: 'trips', granted: true }),
      ]);
    } finally {
      await deleteStudents(request, admin, [s.id]);
    }
  });

  test('/students/records issues transcript version 1 for the selected student', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    // transcript_issuances.issued_by is a uuid column: the issuer's JWT subject is a uuid,
    // as it is for real accounts.
    const admin = stAdmin(randomUUID());
    const s = await seedStudent(request, admin, tag);
    try {
      await openAs(page, admin);
      await page.goto(`/students/records?studentId=${s.id}`, { waitUntil: 'load' });
      await expect(page.locator('#transcriptStudent')).toHaveText(s.name);
      const issue = page.getByRole('button', { name: 'Issue official transcript' });
      await waitForReact(issue);
      await issue.click();
      await expect(page.getByTestId('issue-transcript-confirm')).toContainText(
        `Issue official transcript for ${s.name}?`,
      );
      await page.getByTestId('issue-transcript-confirm-confirm').click();
      await expect(
        page.getByRole('status').filter({ hasText: 'Issued transcript version 1.' }),
      ).toBeVisible({ timeout: 30_000 });

      const stored = await getJson<{ data: Row[] }>(
        request,
        admin,
        `/gradebook/transcripts?studentId=${s.id}`,
      );
      expect(stored.data).toHaveLength(1);
      expect(stored.data[0]).toMatchObject({ studentId: s.id, version: 1 });
      const status = String(stored.data[0]!.status);

      await page.goto(`/students/records?studentId=${s.id}`, { waitUntil: 'load' });
      const issued = page.locator('table tbody tr');
      await expect(issued).toHaveCount(1);
      await expect(issued.locator('td').nth(0)).toHaveText(s.name);
      await expect(issued.locator('td').nth(1)).toHaveText('v1');
      await expect(issued.locator('td').nth(2)).toHaveText(status);
      await expect(issued.locator('td').nth(4)).toHaveText(
        `${String(stored.data[0]!.checksumSha256).slice(0, 16)}…`,
      );
    } finally {
      await deleteStudents(request, admin, [s.id]);
    }
  });
});
