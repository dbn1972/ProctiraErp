import ExcelJS from 'exceljs';
import { expect, test, type Page } from '@playwright/test';

import {
  IMPORT_TEMPLATE_COLUMNS,
  IMPORT_TEMPLATE_HEADERS,
} from '../src/app/(dashboard)/students/import/template/columns';
import {
  BACKEND_READY,
  classLabel,
  deleteStudents,
  enGbDate,
  enroll,
  hydratedForm,
  newTag,
  openAs,
  placement,
  reloadUntil,
  seedDiscipline,
  seedStudent,
  setConsent,
  stAdmin,
  utcDate,
  waitForReact,
} from './fixtures/students-screens';

/**
 * Students module — every read screen shows this run's seeded values (spec 100).
 *
 * Each test seeds its own tagged students through the live gateway as a tenant
 * administrator, opens the screen, asserts the exact seeded values, and deletes the
 * students afterwards. Write paths are in spec 101; privacy and tenancy in spec 102.
 *
 * Known open defects (defects.md) are not asserted here: the profile status pill for a
 * student without an active enrollment, and the status tabs that do not filter.
 */

function studentRow(page: Page, name: string) {
  return page.getByRole('row').filter({ has: page.getByRole('link', { name, exact: true }) });
}

test.describe('Students screens — read (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires live gateway (E2E_BACKEND_READY)');

  test('/students lists the seeded students with their placement and status', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const admin = stAdmin(`st-admin-${tag}`);
    const pl = await placement(request, admin);
    const enrolled = await seedStudent(request, admin, tag);
    const unenrolled = await seedStudent(request, admin, tag, { firstName: `St${tag}U` });
    try {
      await enroll(request, admin, enrolled.id, pl);

      await openAs(page, admin);
      await page.goto(`/students?search=St${tag}`, { waitUntil: 'load' });
      const row = studentRow(page, enrolled.name);
      await reloadUntil(page, async () => {
        await expect(row.getByTestId('student-class-section')).toHaveText(classLabel(pl));
      });
      await expect(row).toHaveCount(1);
      await expect(row.getByRole('cell').nth(1)).toHaveText(enrolled.nationalId);
      await expect(row.getByTestId('student-institution')).toHaveText(pl.source.institutionName);
      await expect(row.getByText('Enrolled', { exact: true })).toBeVisible();
      await expect(
        row.getByText(`F · ${enGbDate(enrolled.dateOfBirth)} · Adm. ${enrolled.admissionNo}`, {
          exact: true,
        }),
      ).toBeVisible();

      const other = studentRow(page, unenrolled.name);
      await expect(other).toHaveCount(1);
      await expect(other.getByText('Not enrolled', { exact: true })).toBeVisible();
      await expect(other.getByTestId('student-class-section')).toHaveText('—');
      await expect(other.getByTestId('student-institution')).toHaveText('—');
      await expect(page.getByTestId('student-row-name')).toHaveCount(2);
    } finally {
      await deleteStudents(request, admin, [enrolled.id, unenrolled.id]);
    }
  });

  test('/students/[id] shows the profile, guardians, history and 360 records', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const admin = stAdmin(`st-admin-${tag}`);
    const pl = await placement(request, admin);
    const s = await seedStudent(request, admin, tag);
    try {
      await enroll(request, admin, s.id, pl);
      const incident = await seedDiscipline(request, admin, s.id, tag);
      await setConsent(request, admin, s.id, 'photo', true);

      await openAs(page, admin);
      await page.goto(`/students/${s.id}`, { waitUntil: 'load' });
      await expect(page.getByTestId('student-profile-heading')).toHaveText(s.name);
      await reloadUntil(page, async () => {
        await expect(page.getByTestId('student-profile-class')).toHaveText(classLabel(pl));
      });
      const head = page.getByTestId('student-profile-heading').locator('xpath=..');
      await expect(head.getByText(s.nationalId, { exact: true })).toBeVisible();
      await expect(head.getByText(`Adm. ${s.admissionNo}`, { exact: true })).toBeVisible();
      await expect(head.getByText(pl.source.institutionName, { exact: true })).toBeVisible();
      await expect(head.getByText('Enrolled', { exact: true })).toBeVisible();
      await expect(head).toContainText(`F · ${enGbDate(s.dateOfBirth)} (12 y)`);
      await expect(page.getByText('No attendance recorded in this window yet.')).toBeVisible();

      const facts = page.locator('dl').filter({ hasText: 'Guardian phone' });
      await expect(facts).toContainText(`${s.guardians[0]!.firstName} Guardian (mother)`);
      await expect(facts).toContainText(s.guardians[0]!.contactPhone);
      await expect(facts).toContainText(s.guardians[0]!.contactEmail);
      await expect(facts).toContainText(s.contactEmail);

      const panel = page.getByTestId('student-360');
      const incidentRow = panel.getByTestId('discipline-row');
      await expect(incidentRow).toHaveCount(1);
      await expect(incidentRow).toContainText(incident.incidentType);
      await expect(incidentRow).toContainText(incident.description);
      await expect(incidentRow).toContainText('Staff only');
      const photo = panel.getByTestId('student-consents').locator('div', {
        has: page.getByTestId('consent-toggle-photo'),
      });
      await expect(photo.last()).toContainText(`Granted · by`);
      await expect(photo.last()).toContainText(utcDate(0));
      await expect(page.getByTestId('consent-toggle-photo')).toHaveAttribute(
        'aria-checked',
        'true',
      );

      await page.getByRole('tab', { name: 'Guardians' }).click();
      const guardians = page.getByRole('table', { name: 'Guardians' });
      for (const g of s.guardians) {
        const r = guardians.getByRole('row').filter({ hasText: `${g.firstName} ${g.lastName}` });
        await expect(r).toHaveCount(1);
        await expect(r.getByRole('cell')).toHaveText([
          `${g.firstName} ${g.lastName}`,
          g.relationship,
          g.contactPhone,
          g.contactEmail,
        ]);
      }

      await page.getByRole('tab', { name: 'History' }).click();
      const history = page.getByRole('table', { name: 'Enrollment history' });
      const first = history.getByRole('row').filter({ hasText: utcDate(0) });
      await expect(first).toHaveCount(1);
      await expect(first.getByRole('cell').nth(2)).toHaveText('Enrolled');
      await expect(first.getByRole('cell').nth(3)).toHaveText(pl.source.institutionName);
    } finally {
      await deleteStudents(request, admin, [s.id]);
    }
  });

  test('/students/[id]/edit is prefilled with the stored values', async ({ page, request }) => {
    const tag = newTag();
    const admin = stAdmin(`st-admin-${tag}`);
    const s = await seedStudent(request, admin, tag);
    try {
      await openAs(page, admin);
      await page.goto(`/students/${s.id}/edit`, { waitUntil: 'load' });
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Edit student: ${s.name}`);
      await expect(page.getByText(`Adm. ${s.admissionNo}`)).toBeVisible();
      const form = await hydratedForm(page, 'student-form');
      await expect(form.locator('#firstName')).toHaveValue(s.firstName);
      await expect(form.locator('#lastName')).toHaveValue(s.lastName);
      await expect(form.locator('#dateOfBirth')).toHaveValue(s.dateOfBirth);
      await expect(form.locator('#gender')).toHaveText('Female');
      await expect(form.locator('#nationalId')).toHaveValue(s.nationalId);
      await expect(form.locator('#nationality')).toHaveValue('ST');
      await expect(form.locator('[id="contacts.0.type"]')).toHaveValue('email');
      await expect(form.locator('[id="contacts.0.value"]')).toHaveValue(s.contactEmail);
      for (const [i, g] of s.guardians.entries()) {
        await expect(form.locator(`[id="guardians.${i}.firstName"]`)).toHaveValue(g.firstName);
        await expect(form.locator(`[id="guardians.${i}.lastName"]`)).toHaveValue(g.lastName);
        await expect(form.locator(`[id="guardians.${i}.relationship"]`)).toHaveValue(
          g.relationship,
        );
        await expect(form.locator(`[id="guardians.${i}.contactPhone"]`)).toHaveValue(
          g.contactPhone,
        );
        await expect(form.locator(`[id="guardians.${i}.contactEmail"]`)).toHaveValue(
          g.contactEmail,
        );
      }
      await expect(form.locator('[id="guardians.2.firstName"]')).toHaveCount(0);
    } finally {
      await deleteStudents(request, admin, [s.id]);
    }
  });

  test('/students/[id]/enroll offers the tenant institutions, or says the student is enrolled', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const admin = stAdmin(`st-admin-${tag}`);
    const pl = await placement(request, admin);
    const free = await seedStudent(request, admin, tag);
    const placed = await seedStudent(request, admin, tag, { firstName: `St${tag}P` });
    try {
      await enroll(request, admin, placed.id, pl);
      await openAs(page, admin);

      await page.goto(`/students/${free.id}/enroll`, { waitUntil: 'load' });
      const form = page.getByTestId('enroll-form');
      await expect(form).toHaveCount(1);
      await expect(page.getByTestId('enroll-already-active')).toHaveCount(0);
      await waitForReact(form);
      await expect(form.locator('#enrolledAt')).toHaveValue(utcDate(0));
      await page.locator('#institutionId').click();
      await expect(
        page.getByRole('option', { name: pl.source.institutionName, exact: true }),
      ).toHaveCount(1);
      await page.keyboard.press('Escape');

      await page.goto(`/students/${placed.id}/enroll`, { waitUntil: 'load' });
      await expect(page.getByTestId('enroll-already-active')).toBeVisible();
      await expect(page.getByTestId('enroll-form')).toHaveCount(0);
      await expect(page.getByRole('link', { name: /request transfer/i })).toHaveAttribute(
        'href',
        `/students/${placed.id}/transfer`,
      );
    } finally {
      await deleteStudents(request, admin, [free.id, placed.id]);
    }
  });

  test('/students/[id]/transfer shows the source enrollment and a live checklist', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const admin = stAdmin(`st-admin-${tag}`);
    const pl = await placement(request, admin);
    const s = await seedStudent(request, admin, tag);
    try {
      await enroll(request, admin, s.id, pl);
      await seedDiscipline(request, admin, s.id, tag);
      await setConsent(request, admin, s.id, 'data_sharing', true);

      await openAs(page, admin);
      await page.goto(`/students/${s.id}/transfer`, { waitUntil: 'load' });
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Transfer request');
      await reloadUntil(page, async () => {
        await expect(page.locator('#sourceEnrollmentId')).toHaveText(
          `${pl.source.institutionName} · ${classLabel(pl)}`,
        );
      });
      const check = (key: string) => page.getByTestId(`transfer-check-${key}`);
      await expect(check('discipline')).toHaveAttribute('data-state', 'outstanding');
      await expect(check('discipline')).toContainText('1 incident without a recorded action.');
      await expect(check('consent')).toHaveAttribute('data-state', 'done');
      await expect(check('consent')).toContainText(
        'Guardian consented to sharing records with the destination school.',
      );
      await expect(check('fees')).toHaveAttribute('data-state', 'done');
      await expect(check('fees')).toContainText('No open or overdue invoices.');
      await expect(page.getByTestId('transfer-checklist')).toContainText('2/3 complete.');
      await expect(page.getByTestId('transfer-checklist-warning')).toContainText(
        '1 checklist item is not complete (No outstanding discipline action).',
      );
    } finally {
      await deleteStudents(request, admin, [s.id]);
    }
  });

  test('/students/enroll links to add, directory and import', async ({ page }) => {
    const admin = stAdmin(`st-admin-${newTag()}`);
    await openAs(page, admin);
    await page.goto('/students/enroll', { waitUntil: 'load' });
    await expect(page.getByTestId('students-enroll-hub')).toBeVisible();
    await expect(page.getByTestId('enroll-hub-add-student')).toHaveAttribute(
      'href',
      '/students/new',
    );
    await expect(page.getByTestId('enroll-hub-directory')).toHaveAttribute('href', '/students');
    await expect(page.getByTestId('enroll-hub-import')).toHaveAttribute('href', '/students/import');
  });

  test('/students/import lists the template columns and serves the template', async ({ page }) => {
    const admin = stAdmin(`st-admin-${newTag()}`);
    await openAs(page, admin);
    await page.goto('/students/import', { waitUntil: 'load' });
    const columns = page.getByTestId('import-template-columns').locator('li');
    await expect(columns).toHaveCount(IMPORT_TEMPLATE_COLUMNS.length);
    await expect(columns.locator('code')).toHaveText([...IMPORT_TEMPLATE_HEADERS]);
    await expect(columns.first()).toContainText('First name — required');

    const res = await page.request.get('/students/import/template');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('spreadsheetml');
    const workbook = new ExcelJS.Workbook();
    const body = await res.body();
    await workbook.xlsx.load(
      body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
    );
    const header = (workbook.worksheets[0]!.getRow(1).values as unknown[]).slice(1);
    expect(header).toEqual([...IMPORT_TEMPLATE_HEADERS]);

    await page.getByRole('button', { name: 'Download template' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Template downloaded.' }),
    ).toBeVisible();
  });

  test('/students/new opens an empty form', async ({ page }) => {
    const admin = stAdmin(`st-admin-${newTag()}`);
    await openAs(page, admin);
    await page.goto('/students/new', { waitUntil: 'load' });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Add student');
    const form = await hydratedForm(page, 'student-form');
    for (const id of ['firstName', 'lastName', 'dateOfBirth', 'nationalId', 'nationality']) {
      await expect(form.locator(`#${id}`)).toHaveValue('');
    }
    await expect(form.getByText('No contacts on file.')).toBeVisible();
    await expect(form.getByText('No guardians on file.')).toBeVisible();
    await expect(page.getByTestId('student-draft-offer')).toHaveCount(0);
    await expect(form.getByRole('button', { name: 'Save student' })).toBeEnabled();
  });

  test('/students/records shows the selected student with no transcripts or GPA yet', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const admin = stAdmin(`st-admin-${tag}`);
    const s = await seedStudent(request, admin, tag);
    try {
      await openAs(page, admin);
      await page.goto(`/students/records?studentId=${s.id}`, { waitUntil: 'load' });
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Student Records');
      await expect(page.getByText('Records API unavailable')).toHaveCount(0);
      await expect(page.locator('#transcriptStudent')).toHaveText(s.name);
      await expect(page.getByText(`No transcripts yet for ${s.name}.`)).toBeVisible();
      await expect(page.getByText('No GPA snapshots for this student.')).toBeVisible();
    } finally {
      await deleteStudents(request, admin, [s.id]);
    }
  });
});
