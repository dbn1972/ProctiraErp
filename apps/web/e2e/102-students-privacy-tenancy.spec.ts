import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import {
  BACKEND_READY,
  GATEWAY_URL,
  TENANT_A,
  TENANT_B,
  apiHeaders,
  buildImportWorkbook,
  chooseOption,
  deleteStudents,
  deleteTagged,
  enGbDate,
  enroll,
  enrollmentsOf,
  expectNotInPage,
  getJson,
  hydratedForm,
  importBody,
  newTag,
  openAs,
  placement,
  searchStudents,
  seedDiscipline,
  seedStudent,
  stAdmin,
  stNurse,
  stParent,
  stStaff,
  stStudent,
  stTeacher,
  studentRoutes,
  utcDate,
  waitForReact,
  type Persona,
  type Row,
  type SeededStudent,
} from './fixtures/students-screens';

/**
 * Students module — privacy and tenancy negatives (spec 102).
 *
 * Student records are child PII (national ID, identity documents, date of birth,
 * contact and guardian details). Each test seeds its own tagged students as the tenant
 * administrator, proves the administrator reads them (positive control), then checks
 * that portal roles, read-only staff roles and another tenant never receive what they
 * should not, on screen or through the APIs the screens call.
 *
 * "Not shown" is checked against the page HTML (rendered text and the RSC payload), so
 * data that reaches the browser but is hidden also fails the test.
 *
 * Known open defect asserted only in patches/ (defects.md): roles that get the national
 * ID masked can still find a student by searching for it (S1).
 */

interface Probe {
  label: string;
  status: number;
  body: string;
}

async function probe(
  request: APIRequestContext,
  p: Persona,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  data?: Row,
  extra: Record<string, string> = {},
): Promise<Probe> {
  const res = await request.fetch(`${GATEWAY_URL}/api/v1${path}`, {
    method,
    headers: apiHeaders(p, extra),
    data,
  });
  return { label: `${method} ${path}`, status: res.status(), body: await res.text() };
}

/** Everything about `s` a role without full access must not receive. */
function secrets(s: SeededStudent): string[] {
  return [s.name, s.admissionNo, enGbDate(s.dateOfBirth), ...s.pii];
}

function newStudentBody(tag: string): Row {
  return {
    firstName: `St${tag}X`,
    lastName: 'Refused',
    dateOfBirth: utcDate(-(11 * 365)),
    gender: 'female',
  };
}

async function expectAccessDenied(page: Page, where: string): Promise<void> {
  await expect
    .soft(page.getByTestId('route-access-denied'), `${where}: access denied`)
    .toHaveCount(1, { timeout: 10_000 });
  await expect.soft(page.getByTestId('student-form'), `${where}: no student form`).toHaveCount(0);
  await expect.soft(page.getByTestId('enroll-form'), `${where}: no enroll form`).toHaveCount(0);
}

test.describe('Students privacy and tenancy — live (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires live gateway (E2E_BACKEND_READY)');

  test('portal roles get an access-denied screen and no student data on every students screen', async ({
    page,
    request,
  }) => {
    test.slow();
    const tag = newTag();
    const admin = stAdmin(`st-admin-${tag}`);
    const pl = await placement(request, admin);
    const s = await seedStudent(request, admin, tag);
    try {
      await enroll(request, admin, s.id, pl);
      await seedDiscipline(request, admin, s.id, tag);
      // Positive control: the administrator reads the student.
      expect((await getJson<Row>(request, admin, `/students/${s.id}`)).nationalId).toBe(
        s.nationalId,
      );

      for (const p of [stStudent(`st-s-${tag}`), stParent(`st-p-${tag}`)]) {
        const roleId = p.roles[0]!.roleId;
        await page.context().clearCookies();
        await openAs(page, p);
        for (const route of studentRoutes(s.id)) {
          await page.goto(route, { waitUntil: 'load' });
          await expectAccessDenied(page, `${roleId} ${route}`);
          await expectNotInPage(page, `${roleId} ${route}`, secrets(s));
        }
        const results = [
          [await probe(request, p, 'GET', `/students?search=${s.firstName}`), 403],
          [await probe(request, p, 'GET', `/students/search?q=${s.firstName}`), 403],
          [await probe(request, p, 'GET', `/students/${s.id}`), 404],
          [await probe(request, p, 'POST', '/students', newStudentBody(tag)), 403],
        ] as const;
        for (const [r, status] of results) {
          expect.soft(r.status, `${roleId} ${r.label}: ${r.body.slice(0, 200)}`).toBe(status);
          for (const secret of secrets(s)) {
            expect.soft(r.body, `${roleId} ${r.label} body`).not.toContain(secret);
          }
        }
      }
      expect(await searchStudents(request, admin, `St${tag}X`), 'no refused create').toEqual([]);
    } finally {
      await deleteStudents(request, admin, [s.id]);
    }
  });

  test('teacher, staff and nurse see students without the national ID or documents', async ({
    page,
    request,
  }) => {
    test.slow();
    const tag = newTag();
    const admin = stAdmin(`st-admin-${tag}`);
    const s = await seedStudent(request, admin, tag);
    const masked = [s.nationalId, s.documentNumber];
    try {
      // Positive control: the administrator gets both.
      const full = await getJson<Row>(request, admin, `/students/${s.id}`);
      expect(full.nationalId).toBe(s.nationalId);
      expect(full.identityDocuments).toEqual([
        expect.objectContaining({ number: s.documentNumber }),
      ]);

      for (const p of [stTeacher(`st-t-${tag}`), stStaff(`st-f-${tag}`), stNurse(`st-n-${tag}`)]) {
        const roleId = p.roles[0]!.roleId;
        const one = await getJson<Row>(request, p, `/students/${s.id}`);
        expect.soft(one.firstName, `${roleId} reads the student`).toBe(s.firstName);
        expect.soft(one.nationalId, `${roleId} GET /students/:id nationalId`).toBeNull();
        expect.soft(one.identityDocuments, `${roleId} identityDocuments`).toEqual([]);
        const list = await searchStudents(request, p, s.firstName);
        expect
          .soft(
            list.map((r) => r.id),
            `${roleId} lists the student`,
          )
          .toEqual([s.id]);
        expect.soft(list[0]?.nationalId, `${roleId} GET /students nationalId`).toBeNull();
        const search = await getJson<{ data: Row[] }>(
          request,
          p,
          `/students/search?q=${s.firstName}`,
        );
        expect
          .soft(
            search.data.map((r) => r.nationalId),
            `${roleId} search`,
          )
          .toEqual([null]);

        await page.context().clearCookies();
        await openAs(page, p);
        await page.goto(`/students?search=${s.firstName}`, { waitUntil: 'load' });
        const row = page
          .getByRole('row')
          .filter({ has: page.getByRole('link', { name: s.name, exact: true }) });
        await expect.soft(row, `${roleId} /students row`).toHaveCount(1);
        await expect.soft(row.getByRole('cell').nth(1), `${roleId} NID cell`).toHaveText('—');
        await expectNotInPage(page, `${roleId} /students`, masked);

        await page.goto(`/students/${s.id}`, { waitUntil: 'load' });
        await expect
          .soft(page.getByTestId('student-profile-heading'), `${roleId} profile`)
          .toHaveText(s.name);
        await expectNotInPage(page, `${roleId} /students/[id]`, masked);

        // Holds whether the route renders the form (today) or access denied (M1-R3).
        await page.goto(`/students/${s.id}/edit`, { waitUntil: 'load' });
        await expect
          .soft(page.locator('[id="identityDocuments.0.number"]'), `${roleId} edit documents`)
          .toHaveCount(0);
        await expectNotInPage(page, `${roleId} /students/[id]/edit`, masked);
      }
    } finally {
      await deleteStudents(request, admin, [s.id]);
    }
  });

  test('teacher, staff and nurse cannot change student records; the screen shows safe copy', async ({
    page,
    request,
  }) => {
    test.slow();
    const tag = newTag();
    const admin = stAdmin(`st-admin-${tag}`);
    const pl = await placement(request, admin);
    const s = await seedStudent(request, admin, tag);
    try {
      const enrollmentId = await enroll(request, admin, s.id, pl);
      const before = await getJson<Row>(request, admin, `/students/${s.id}`);
      const workbook = await buildImportWorkbook([
        { first_name: `St${tag}X`, last_name: 'Refused', date_of_birth: utcDate(-4000) },
      ]);
      const writes: Array<['POST' | 'PUT', string, Row]> = [
        ['POST', '/students', newStudentBody(tag)],
        ['PUT', `/students/${s.id}`, { lastName: 'Refused' }],
        [
          'POST',
          '/enrollments',
          {
            studentId: s.id,
            institutionId: pl.destination.institutionId,
            gradeId: pl.grade.id,
            classId: pl.destination.classId,
            academicPeriodId: pl.period.id,
            enrolledAt: utcDate(0),
          },
        ],
        [
          'POST',
          '/enrollments/transfer',
          {
            studentId: s.id,
            sourceEnrollmentId: enrollmentId,
            destinationInstitutionId: pl.destination.institutionId,
            destinationGradeId: pl.grade.id,
            destinationClassId: pl.destination.classId,
            academicPeriodId: pl.period.id,
            transferDate: utcDate(0),
            reason: `ST ${tag} refused`,
          },
        ],
        [
          'POST',
          '/enrollments/bulk-status',
          {
            enrollmentIds: [enrollmentId],
            status: 'GRADUATED',
            reason: `ST ${tag} refused`,
            effectiveDate: utcDate(0),
          },
        ],
        ['POST', '/students/import', importBody(workbook, 'create')],
      ];
      for (const p of [stTeacher(`st-t-${tag}`), stStaff(`st-f-${tag}`), stNurse(`st-n-${tag}`)]) {
        const roleId = p.roles[0]!.roleId;
        for (const [method, path, data] of writes) {
          const r = await probe(request, p, method, path, data);
          expect.soft(r.status, `${roleId} ${r.label}: ${r.body.slice(0, 200)}`).toBe(403);
        }
      }
      const after = await getJson<Row>(request, admin, `/students/${s.id}`);
      expect(after.lastName, 'refused PUT changed nothing').toBe(before.lastName);
      expect(await enrollmentsOf(request, admin, s.id)).toEqual([
        expect.objectContaining({ id: enrollmentId, status: 'ENROLLED' }),
      ]);
      expect(await searchStudents(request, admin, `St${tag}X`), 'no refused create').toEqual([]);

      // A save that reaches the gateway with the teacher's session fails with fixed copy and a
      // reference. The form is loaded as the administrator and the session is then switched,
      // so this holds whether or not read-only roles get the form themselves (M1-R3).
      await openAs(page, admin);
      await page.goto('/students/new', { waitUntil: 'load' });
      const form = await hydratedForm(page, 'student-form');
      await form.locator('#firstName').fill(`St${tag}X`);
      await form.locator('#lastName').fill('Refused');
      await form.locator('#dateOfBirth').fill(utcDate(-4000));
      await chooseOption(page, 'gender', 'Female');
      await page.context().clearCookies();
      await openAs(page, stTeacher(`st-t-${tag}`));
      await form.getByRole('button', { name: 'Save student' }).click();
      const alert = form.getByRole('alert');
      await expect(alert).toHaveText(
        /^You do not have permission to make this change\. Contact your administrator if you need access\. \(ref [A-Za-z0-9-]{8,64}\)$/,
        { timeout: 30_000 },
      );
      await expect(page).toHaveURL(/\/students\/new$/);
      expect(await page.content()).not.toMatch(/Forbidden|student:create|student\.create/);
      expect(await searchStudents(request, admin, `St${tag}X`), 'no create from screen').toEqual(
        [],
      );
    } finally {
      await deleteStudents(request, admin, [s.id]);
      await deleteTagged(request, admin, `St${tag}X`);
    }
  });

  test("another tenant never sees, changes or links tenant A's students", async ({
    page,
    request,
  }) => {
    test.slow();
    const tag = newTag();
    const adminA = stAdmin(`st-a-admin-${tag}`, TENANT_A);
    const adminB = stAdmin(`st-b-admin-${tag}`, TENANT_B);
    const pl = await placement(request, adminA);
    const a = await seedStudent(request, adminA, tag);
    const b = await seedStudent(request, adminB, tag, {
      firstName: `St${tag}B`,
      dateOfBirth: utcDate(-(12 * 365 + 120)),
    });
    try {
      const enrollmentId = await enroll(request, adminA, a.id, pl);
      // transcript_issuances.issued_by is a uuid column, so the issuer's subject is a uuid.
      const issued = await request.post(`${GATEWAY_URL}/api/v1/gradebook/transcripts/issue`, {
        headers: apiHeaders(stAdmin(randomUUID(), TENANT_A)),
        data: { studentId: a.id },
      });
      expect(issued.status(), (await issued.text()).slice(0, 300)).toBeLessThan(300);
      const issuedRow = (await issued.json()) as Row;
      const transcript = {
        id: String(issuedRow.id),
        checksum: String(issuedRow.checksumSha256),
      };
      expect(transcript.checksum).toMatch(/^[0-9a-f]{64}$/);
      // Positive controls: each administrator reads its own student.
      expect((await getJson<Row>(request, adminA, `/students/${a.id}`)).id).toBe(a.id);
      expect((await getJson<Row>(request, adminB, `/students/${b.id}`)).id).toBe(b.id);

      // A 404 may echo the id from the URL; nothing else of tenant A's may come back.
      const leaked = [enrollmentId, ...secrets(a)];
      // `St<tag>` also matches tenant B's own `St<tag>B`, so the search returns exactly that.
      const reads: Array<[string, number, string[] | null]> = [
        [`/students/${a.id}`, 404, null],
        [`/students?search=${a.firstName}`, 200, [b.id]],
        [`/students/search?q=${a.firstName}`, 200, [b.id]],
        [`/enrollments?studentId=${a.id}`, 200, []],
        [`/enrollments/student/${a.id}/history`, 200, []],
        [`/enrollments/student/${a.id}/transfers`, 200, []],
      ];
      for (const [path, status, ids] of reads) {
        const r = await probe(request, adminB, 'GET', path);
        expect.soft(r.status, `tenant B GET ${path}: ${r.body.slice(0, 200)}`).toBe(status);
        if (ids) {
          const rows = (JSON.parse(r.body) as { data?: Row[] }).data ?? null;
          expect
            .soft(
              rows?.map((x) => x.id),
              `tenant B GET ${path} rows`,
            )
            .toEqual(ids);
        }
        for (const s of leaked) expect.soft(r.body, `tenant B GET ${path} body`).not.toContain(s);
      }
      const writes: Array<['POST' | 'PUT' | 'DELETE', string, Row | undefined]> = [
        ['PUT', `/students/${a.id}`, { lastName: 'Crossed' }],
        ['DELETE', `/students/${a.id}`, undefined],
        [
          'POST',
          '/enrollments',
          {
            studentId: a.id,
            institutionId: pl.source.institutionId,
            gradeId: pl.grade.id,
            classId: pl.source.classId,
            academicPeriodId: pl.period.id,
            enrolledAt: utcDate(0),
          },
        ],
        ['POST', `/students/${b.id}/siblings`, { siblingId: a.id }],
      ];
      for (const [method, path, data] of writes) {
        const r = await probe(request, adminB, method, path, data);
        expect.soft(r.status, `tenant B ${method} ${path}: ${r.body.slice(0, 200)}`).toBe(404);
        for (const s of leaked) expect.soft(r.body, `tenant B ${method} ${path}`).not.toContain(s);
      }
      const stillA = await getJson<Row>(request, adminA, `/students/${a.id}`);
      expect(stillA.lastName, "tenant A's student is unchanged").toBe(a.lastName);
      expect(await enrollmentsOf(request, adminA, a.id)).toEqual([
        expect.objectContaining({ id: enrollmentId, status: 'ENROLLED' }),
      ]);
      const siblings = await getJson<{ data: Row[] }>(
        request,
        adminB,
        `/students/${b.id}/siblings`,
      );
      expect(siblings.data, 'tenant B linked no sibling').toEqual([]);

      // Screens: tenant B sees none of tenant A's student.
      await openAs(page, adminB);
      await page.goto(`/students?search=${a.firstName}`, { waitUntil: 'load' });
      await expect(page.getByTestId('student-row-name')).toHaveText([b.name]);
      await expectNotInPage(page, 'tenant B /students', [a.id, ...leaked]);
      for (const route of [
        `/students/${a.id}`,
        `/students/${a.id}/edit`,
        `/students/${a.id}/enroll`,
        `/students/${a.id}/transfer`,
      ]) {
        await page.goto(route, { waitUntil: 'load' });
        await expect
          .soft(page.getByRole('heading', { name: /page not found/i }), `tenant B ${route}`)
          // On a loaded runner the not-found view has taken over 20 s to appear after `load`
          // (counted run final-run2 at ae503782); same budget as waitForReact.
          .toBeVisible({ timeout: 45_000 });
        await expectNotInPage(
          page,
          `tenant B ${route}`,
          leaked.filter((s) => s !== a.id),
        );
      }
      // Records: tenant B gets none of tenant A's student or transcript for A's id.
      const transcripts = await getJson<{ data: Row[] }>(
        request,
        adminA,
        `/gradebook/transcripts?studentId=${a.id}`,
      );
      expect(transcripts.data, "tenant A reads its student's transcript").toEqual([
        expect.objectContaining({ id: transcript.id, studentId: a.id }),
      ]);
      const transcriptLeaks = [
        transcript.id,
        transcript.checksum,
        transcript.checksum.slice(0, 16),
      ];
      const recordsApi = await probe(
        request,
        adminB,
        'GET',
        `/gradebook/transcripts?studentId=${a.id}`,
      );
      expect.soft(recordsApi.status, `tenant B GET /gradebook/transcripts`).toBe(200);
      expect
        .soft((JSON.parse(recordsApi.body) as { data?: Row[] }).data, 'tenant B transcripts for A')
        .toEqual([]);
      for (const s of [enrollmentId, ...secrets(a), ...transcriptLeaks]) {
        expect.soft(recordsApi.body, 'tenant B GET /gradebook/transcripts body').not.toContain(s);
      }
      await page.goto(`/students/records?studentId=${a.id}`, { waitUntil: 'load' });
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Student Records');
      await expect(page.getByText('Records API unavailable')).toHaveCount(0);
      await expect.soft(page.locator('table tbody tr'), 'tenant B records rows').toHaveCount(0);
      await expectNotInPage(page, 'tenant B /students/records', [
        ...leaked.filter((s) => s !== a.id),
        ...transcriptLeaks,
      ]);

      // The screens did load live data: tenant B's own student is listed.
      await page.goto(`/students?search=${b.firstName}`, { waitUntil: 'load' });
      await expect(page.getByRole('link', { name: b.name, exact: true })).toBeVisible();

      // Tenant B's import of a row carrying tenant A's national ID is not a duplicate.
      const workbook = await buildImportWorkbook([
        {
          first_name: `St${tag}BI`,
          last_name: 'Imported',
          date_of_birth: a.dateOfBirth,
          national_id: a.nationalId,
        },
      ]);
      const imported = await probe(
        request,
        adminB,
        'POST',
        '/students/import',
        importBody(workbook, 'skip'),
      );
      expect(imported.status, imported.body.slice(0, 300)).toBeLessThan(300);
      const result = JSON.parse(imported.body) as Row;
      expect(result).toMatchObject({ totalRows: 1, successCount: 1, duplicateCount: 0 });
      expect(imported.body).not.toContain(a.id);
    } finally {
      await deleteStudents(request, adminA, [a.id]);
      await deleteStudents(request, adminB, [b.id]);
      await deleteTagged(request, adminB, `St${tag}BI`);
    }
  });

  test('a forged X-Tenant-ID header never switches the tenant', async ({ request }) => {
    const tag = newTag();
    const adminA = stAdmin(`st-a-admin-${tag}`, TENANT_A);
    const adminB = stAdmin(`st-b-admin-${tag}`, TENANT_B);
    const a = await seedStudent(request, adminA, tag);
    const b = await seedStudent(request, adminB, tag, {
      firstName: `St${tag}B`,
      dateOfBirth: utcDate(-(12 * 365 + 120)),
    });
    try {
      const views: Array<[Persona, SeededStudent, SeededStudent, string]> = [
        [adminB, b, a, TENANT_A],
        [adminA, a, b, TENANT_B],
      ];
      for (const [viewer, own, other, forged] of views) {
        const who = viewer.tenantId === TENANT_A ? 'tenant A' : 'tenant B';
        const extra = { 'X-Tenant-ID': forged };
        const leaked = [other.id, ...secrets(other)];
        const one = await probe(request, viewer, 'GET', `/students/${other.id}`, undefined, extra);
        expect.soft(one.status, `${who} + forged header GET other student`).toBe(404);
        const mine = await probe(request, viewer, 'GET', `/students/${own.id}`, undefined, extra);
        expect.soft(mine.status, `${who} + forged header GET own student`).toBe(200);
        for (const path of [
          `/students?search=St${tag}`,
          `/students/search?q=St${tag}`,
          `/enrollments?studentId=${other.id}`,
        ]) {
          const r = await probe(request, viewer, 'GET', path, undefined, extra);
          expect.soft(r.status, `${who} + forged header GET ${path}`).toBe(200);
          for (const s of leaked) expect.soft(r.body, `${who} forged ${path}`).not.toContain(s);
        }
        const list = await probe(
          request,
          viewer,
          'GET',
          `/students?search=St${tag}`,
          undefined,
          extra,
        );
        expect
          .soft(
            (JSON.parse(list.body) as { data?: Row[] }).data?.map((r) => r.id),
            `${who} + forged header lists only its own student`,
          )
          .toEqual([own.id]);
        const put = await probe(
          request,
          viewer,
          'PUT',
          `/students/${other.id}`,
          { lastName: 'Crossed' },
          extra,
        );
        expect.soft(put.status, `${who} + forged header PUT other student`).toBe(404);
      }
      expect((await getJson<Row>(request, adminA, `/students/${a.id}`)).lastName).toBe(a.lastName);
      expect((await getJson<Row>(request, adminB, `/students/${b.id}`)).lastName).toBe(b.lastName);
    } finally {
      await deleteStudents(request, adminA, [a.id]);
      await deleteStudents(request, adminB, [b.id]);
    }
  });

  test('pickers and saved drafts carry no national ID, document or contact details', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const admin = stAdmin(`st-admin-${tag}`);
    const s = await seedStudent(request, admin, tag);
    try {
      await openAs(page, admin);
      await page.goto(`/students/records?studentId=${s.id}`, { waitUntil: 'load' });
      const picker = page.locator('#transcriptStudent');
      await waitForReact(picker);
      await picker.click();
      const option = page.getByRole('option', { name: new RegExp(`^${s.firstName}`) });
      await expect.soft(option, 'records picker option label').toHaveText(s.name);
      await page.keyboard.press('Escape');

      // A create that fails (national ID already used) keeps the flushed draft.
      await page.goto('/students/new', { waitUntil: 'load' });
      const form = await hydratedForm(page, 'student-form');
      const draftPii = {
        nationalId: s.nationalId,
        contact: `st.${tag.toLowerCase()}@draft.test`,
        phone: `000-${tag}-5`,
        email: `g.${tag.toLowerCase()}@draft.test`,
        document: `ST-${tag}-DRAFTDOC`,
      };
      await form.locator('#firstName').fill(`St${tag}D`);
      await form.locator('#lastName').fill('Drafted');
      await form.locator('#dateOfBirth').fill(utcDate(-4000));
      await chooseOption(page, 'gender', 'Female');
      await form.locator('#nationalId').fill(draftPii.nationalId);
      await form.getByRole('button', { name: 'Add contact' }).click();
      await form.locator('[id="contacts.0.type"]').selectOption('email');
      await form.locator('[id="contacts.0.value"]').fill(draftPii.contact);
      await form.getByRole('button', { name: 'Add guardian' }).click();
      await form.locator('[id="guardians.0.firstName"]').fill(`St${tag}G`);
      await form.locator('[id="guardians.0.lastName"]').fill('Guardian');
      await form.locator('[id="guardians.0.relationship"]').fill('aunt');
      await form.locator('[id="guardians.0.contactPhone"]').fill(draftPii.phone);
      await form.locator('[id="guardians.0.contactEmail"]').fill(draftPii.email);
      await form.getByRole('button', { name: 'Add document' }).click();
      await form.locator('[id="identityDocuments.0.number"]').fill(draftPii.document);
      await form.getByRole('button', { name: 'Save student' }).click();
      await expect(form.getByRole('alert')).toContainText(
        'This conflicts with an existing record.',
        { timeout: 30_000 },
      );
      await expect(form.getByRole('alert')).not.toContainText(s.nationalId);

      const drafts = await page.evaluate(() =>
        Object.keys(window.localStorage)
          .filter((key) => key.includes('student-create'))
          .map((key) => window.localStorage.getItem(key) ?? ''),
      );
      expect(drafts, 'the failed save left one draft').toHaveLength(1);
      expect(drafts[0], 'the draft holds the non-sensitive fields').toContain(`St${tag}D`);
      for (const [field, value] of Object.entries(draftPii)) {
        expect.soft(drafts[0], `draft must not hold ${field}`).not.toContain(value);
      }
    } finally {
      await deleteStudents(request, admin, [s.id]);
      await deleteTagged(request, admin, `St${tag}D`);
    }
  });
});
