/**
 * Students screen coverage — personas, per-run seeding and helpers (specs 100–102).
 *
 * Every test seeds its own students through the live gateway with a unique tag and
 * finds them by that tag (search reads every page), so assertions hold on a reused
 * database. Every test deletes the students it created in `finally` (soft delete), so
 * the tagged rows never show up in later runs.
 *
 * Placement rows (grade, classes, a destination institution) are find-or-create with
 * fixed codes, so a rerun reuses them instead of adding new rows each time.
 *
 * Screen persona: a tenant administrator (`roleId: 'admin'`): gateway `student:manage`
 * and the student package's admin tier. Teacher, staff and nurse are the read-only
 * staff roles; student and parent are portal roles.
 *
 * Strings never look like real people: they start with `St` / `ST` and carry the tag.
 */
import ExcelJS from 'exceljs';
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

import { IMPORT_TEMPLATE_HEADERS } from '../../src/app/(dashboard)/students/import/template/columns';
import {
  GATEWAY_URL,
  TENANT_A,
  apiHeaders,
  postCreated,
  utcDate,
  type Persona,
  type PersonaRole,
  type Row,
} from './hostel-screens';

export {
  BACKEND_READY,
  GATEWAY_URL,
  TENANT_A,
  TENANT_B,
  apiHeaders,
  expectNotInPage,
  hydratedForm,
  newTag,
  openAs,
  utcDate,
  type Persona,
  type Row,
} from './hostel-screens';

/** Seeded by tools/e2e/seed-e2e-tenants.sql (tenant A). */
export const DEMO_SCHOOL = { id: 'a2e96cd1-0232-4cce-97e2-00ebbfb9a374', name: 'E2E Demo School' };
export const E2E_AREA_ID = '00000000-0000-4000-8000-00000000a0ea';
export const E2E_PERIOD = { id: '00000000-0000-4000-8000-00000000ac01', name: 'E2E Academic Year' };

function persona(sub: string, tenantId: string, role: PersonaRole, displayName: string): Persona {
  return { sub, email: `${sub}@tenant.test`, displayName, tenantId, roles: [role] };
}

function role(roleId: string, roleName: string) {
  return (sub: string, tenantId: string = TENANT_A): Persona =>
    persona(sub, tenantId, { roleId, roleName, areaId: null }, `ST ${roleName}`);
}

export const stAdmin = role('admin', 'Administrator');
export const stPrincipal = role('principal', 'Principal');
export const stTeacher = role('teacher', 'Teacher');
export const stStaff = role('staff', 'Staff');
export const stNurse = role('nurse', 'Nurse');
export const stStudent = role('student', 'Student');
export const stParent = role('parent', 'Parent');

/** The nine screens under apps/web/src/app/(dashboard)/students. */
export function studentRoutes(id: string): string[] {
  return [
    '/students',
    `/students/${id}`,
    `/students/${id}/edit`,
    `/students/${id}/enroll`,
    `/students/${id}/transfer`,
    '/students/enroll',
    '/students/import',
    '/students/new',
    '/students/records',
  ];
}

/** "18 Apr 2012": the en-GB date the list and profile render for an ISO date. */
export function enGbDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
}

export interface SeededGuardian {
  firstName: string;
  lastName: string;
  relationship: string;
  contactPhone: string;
  contactEmail: string;
}

export interface SeededStudent {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  dateOfBirth: string;
  nationalId: string;
  documentNumber: string;
  contactEmail: string;
  admissionNo: string;
  guardians: SeededGuardian[];
  /** Child PII that must not reach roles or tenants without access. */
  pii: string[];
}

/** One tagged student with a national ID, one contact and two guardians. */
export async function seedStudent(
  request: APIRequestContext,
  p: Persona,
  tag: string,
  opts: { firstName?: string; lastName?: string; dateOfBirth?: string } = {},
): Promise<SeededStudent> {
  const firstName = opts.firstName ?? `St${tag}`;
  const lastName = opts.lastName ?? 'Learner';
  // 12 years and a month ago: the profile shows "(12 y)" whatever the run date.
  const dateOfBirth = opts.dateOfBirth ?? utcDate(-(12 * 365 + 33));
  const nationalId = `ST-${firstName.toUpperCase()}-NID`;
  const contactEmail = `st.${firstName.toLowerCase()}@student.test`;
  const guardians: SeededGuardian[] = [
    {
      firstName: firstName,
      lastName: 'Guardian',
      relationship: 'mother',
      contactPhone: `000-${firstName.slice(2)}-1`,
      contactEmail: `g1.${firstName.toLowerCase()}@guardian.test`,
    },
    {
      firstName: `${firstName}b`,
      lastName: 'Guardian',
      relationship: 'father',
      contactPhone: `000-${firstName.slice(2)}-2`,
      contactEmail: `g2.${firstName.toLowerCase()}@guardian.test`,
    },
  ];
  const documentNumber = `ST-${firstName.toUpperCase()}-DOC`;
  const created = await postCreated(request, p, '/students', {
    firstName,
    lastName,
    dateOfBirth,
    gender: 'female',
    nationalId,
    nationality: 'ST',
    contacts: [{ type: 'email', value: contactEmail, isPrimary: true }],
    guardians,
    identityDocuments: [{ type: 'passport', number: documentNumber, issuingCountry: 'ST' }],
  });
  const customData = (created.customData ?? {}) as Record<string, unknown>;
  const admissionNo = String(customData.admissionNo ?? '');
  expect(admissionNo, 'the tenant issues an admission number').toMatch(/\S/);
  return {
    id: created.id,
    firstName,
    lastName,
    name: `${firstName} ${lastName}`,
    dateOfBirth,
    nationalId,
    documentNumber,
    contactEmail,
    admissionNo,
    guardians,
    pii: [
      nationalId,
      documentNumber,
      contactEmail,
      ...guardians.flatMap((g) => [g.contactPhone, g.contactEmail]),
    ],
  };
}

async function gatewayJson<T>(request: APIRequestContext, p: Persona, path: string): Promise<T> {
  const res = await request.get(`${GATEWAY_URL}/api/v1${path}`, { headers: apiHeaders(p) });
  expect(res.status(), `GET ${path}: ${await res.text()}`).toBe(200);
  return (await res.json()) as T;
}

export function getJson<T = Row>(request: APIRequestContext, p: Persona, path: string): Promise<T> {
  return gatewayJson<T>(request, p, path);
}

/** Every student matching `search` (reads every page). */
export async function searchStudents(
  request: APIRequestContext,
  p: Persona,
  search: string,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const body = await gatewayJson<{ data: Row[]; meta: { totalPages: number } }>(
      request,
      p,
      `/students?search=${encodeURIComponent(search)}&page=${page}&pageSize=100`,
    );
    rows.push(...body.data);
    if (page >= body.meta.totalPages) break;
  }
  return rows;
}

export async function enrollmentsOf(
  request: APIRequestContext,
  p: Persona,
  studentId: string,
): Promise<Row[]> {
  const body = await gatewayJson<{ data: Row[] }>(
    request,
    p,
    `/enrollments?studentId=${studentId}&pageSize=100`,
  );
  return body.data;
}

/** Soft-delete every student id in `ids` (cleanup; already-deleted ids are fine). */
export async function deleteStudents(
  request: APIRequestContext,
  p: Persona,
  ids: Iterable<string>,
): Promise<void> {
  for (const id of new Set(ids)) {
    const res = await request.delete(`${GATEWAY_URL}/api/v1/students/${id}`, {
      headers: apiHeaders(p),
    });
    expect([204, 404], `DELETE /students/${id}: ${await res.text()}`).toContain(res.status());
  }
}

/** Delete every student whose name or national ID carries `tag` (imported rows). */
export async function deleteTagged(
  request: APIRequestContext,
  p: Persona,
  tag: string,
): Promise<void> {
  const rows = await searchStudents(request, p, tag);
  await deleteStudents(
    request,
    p,
    rows.map((r) => String(r.id)),
  );
}

export interface Placement {
  grade: { id: string; name: string };
  source: { institutionId: string; institutionName: string; classId: string; className: string };
  destination: {
    institutionId: string;
    institutionName: string;
    classId: string;
    className: string;
  };
  period: { id: string; name: string };
}

const GRADE = { code: 'ST-GRADE', name: 'ST Grade' };
const SOURCE_CLASS = 'ST Section A';
const DEST_CLASS = 'ST Section D';
const DEST_SCHOOL = { code: 'E2E-ST-DEST', name: 'ST Destination School' };

async function findOrCreateClass(
  request: APIRequestContext,
  p: Persona,
  institutionId: string,
  gradeId: string,
  name: string,
): Promise<string> {
  const rows = await gatewayJson<Row[]>(
    request,
    p,
    `/classes?institutionId=${institutionId}&academicPeriodId=${E2E_PERIOD.id}`,
  );
  const hit = rows.find((r) => r.name === name && r.gradeId === gradeId);
  if (hit) return String(hit.id);
  const created = await postCreated(request, p, '/classes', {
    institutionId,
    gradeId,
    academicPeriodId: E2E_PERIOD.id,
    name,
    capacity: 5000,
  });
  return created.id;
}

/**
 * Stable placement rows (find-or-create, lesson b): grade `ST Grade`, class
 * `ST Section A` in the seeded E2E Demo School, and `ST Destination School` with its
 * own `ST Section D`, all in the seeded E2E Academic Year.
 */
export async function placement(request: APIRequestContext, p: Persona): Promise<Placement> {
  const grades = await gatewayJson<Row[]>(request, p, '/grades');
  let gradeId = grades.find((g) => g.code === GRADE.code)?.id as string | undefined;
  if (!gradeId) {
    const used = new Set(grades.map((g) => Number(g.order)));
    let order = 32_000;
    while (used.has(order)) order -= 1;
    gradeId = (await postCreated(request, p, '/grades', { ...GRADE, order })).id;
  }
  const institutions = await gatewayJson<{ data: Row[] }>(
    request,
    p,
    `/institutions?search=${encodeURIComponent(DEST_SCHOOL.code)}&pageSize=100`,
  );
  let destId = institutions.data.find((i) => i.code === DEST_SCHOOL.code)?.id as string | undefined;
  if (!destId) {
    // The institution API stores type/sector/ownership ids as given.
    destId = (
      await postCreated(request, p, '/institutions', {
        name: DEST_SCHOOL.name,
        code: DEST_SCHOOL.code,
        areaId: E2E_AREA_ID,
        typeId: '00000000-0000-4000-8000-0000000057a1',
        sectorId: '00000000-0000-4000-8000-0000000057a2',
        ownershipId: '00000000-0000-4000-8000-0000000057a3',
      })
    ).id;
  }
  const sourceClassId = await findOrCreateClass(request, p, DEMO_SCHOOL.id, gradeId, SOURCE_CLASS);
  const destClassId = await findOrCreateClass(request, p, destId, gradeId, DEST_CLASS);
  return {
    grade: { id: gradeId, name: GRADE.name },
    source: {
      institutionId: DEMO_SCHOOL.id,
      institutionName: DEMO_SCHOOL.name,
      classId: sourceClassId,
      className: SOURCE_CLASS,
    },
    destination: {
      institutionId: destId,
      institutionName: DEST_SCHOOL.name,
      classId: destClassId,
      className: DEST_CLASS,
    },
    period: E2E_PERIOD,
  };
}

/** Class label the student screens render (`Grade · Class`). */
export function classLabel(pl: Placement, which: 'source' | 'destination' = 'source'): string {
  return `${pl.grade.name} · ${pl[which].className}`;
}

/** Enroll `studentId` in the source class through the API (seeding). */
export async function enroll(
  request: APIRequestContext,
  p: Persona,
  studentId: string,
  pl: Placement,
): Promise<string> {
  const created = await postCreated(request, p, '/enrollments', {
    studentId,
    institutionId: pl.source.institutionId,
    gradeId: pl.grade.id,
    classId: pl.source.classId,
    academicPeriodId: pl.period.id,
    enrolledAt: utcDate(0),
  });
  return created.id;
}

/** One discipline incident without an action (transfer checklist: outstanding). */
export async function seedDiscipline(
  request: APIRequestContext,
  p: Persona,
  studentId: string,
  tag: string,
): Promise<{ id: string; incidentType: string; description: string }> {
  const incidentType = `ST ${tag} Late`;
  const description = `ST ${tag} arrived after the bell`;
  const created = await postCreated(request, p, `/students/${studentId}/discipline`, {
    incidentType,
    severity: 'low',
    description,
    incidentDate: utcDate(0),
    visibleToParent: false,
  });
  return { id: created.id, incidentType, description };
}

export async function setConsent(
  request: APIRequestContext,
  p: Persona,
  studentId: string,
  kind: 'photo' | 'medical' | 'trips' | 'data_sharing',
  granted: boolean,
): Promise<void> {
  const res = await request.put(`${GATEWAY_URL}/api/v1/students/${studentId}/consents`, {
    headers: apiHeaders(p),
    data: { kind, granted },
  });
  expect(res.ok(), `PUT consents ${kind}: ${await res.text()}`).toBe(true);
}

export interface ImportRow {
  first_name: string;
  last_name: string;
  date_of_birth: string;
  gender?: string;
  national_id?: string;
  nationality?: string;
  contact_phone?: string;
  contact_email?: string;
  guardian_name?: string;
  guardian_phone?: string;
  institution_code?: string;
}

/** `POST /students/import` body the web client sends (base64 file, JSON). */
export function importBody(
  workbook: Buffer,
  duplicateResolution: 'skip' | 'update' | 'create',
): Row {
  return {
    file: {
      buffer: workbook.toString('base64'),
      filename: 'st-import.xlsx',
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
    duplicateResolution,
    async: false,
  };
}

/** An .xlsx with the template header row (`IMPORT_TEMPLATE_HEADERS`) and `rows`. */
export async function buildImportWorkbook(rows: ImportRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Students');
  sheet.addRow([...IMPORT_TEMPLATE_HEADERS]);
  for (const row of rows) {
    sheet.addRow(IMPORT_TEMPLATE_HEADERS.map((key) => row[key as keyof ImportRow] ?? ''));
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/**
 * Wait until React has attached its props to `locator` (hydrated), so a click reaches the
 * client handler. Same probe as fixtures/health-screens.ts, with a longer wait: `next dev`
 * can take over 20 s to hydrate a freshly compiled route on a loaded runner.
 */
export async function waitForReact(locator: Locator): Promise<void> {
  await expect
    .poll(
      () =>
        locator.evaluate((el) => Object.keys(el).some((key) => key.startsWith('__reactProps$'))),
      { message: 'React props attached', timeout: 45_000 },
    )
    .toBe(true);
}

/** Pick `name` in the Radix select whose trigger has id `triggerId`. */
export async function chooseOption(page: Page, triggerId: string, name: string): Promise<void> {
  const trigger = page.locator(`#${triggerId}`);
  await expect(trigger).toBeEnabled({ timeout: 20_000 });
  await trigger.click();
  await page.getByRole('option', { name, exact: true }).click();
  await expect(trigger).toContainText(name);
}

/**
 * Directory reads behind the institution pickers and class labels are cached by Next for
 * 30 s (`next: { revalidate: 30 }` in lib/api/institutions.ts). When this run created a
 * placement row moments ago, reload until the cached directory includes it.
 */
export async function reloadUntil(page: Page, check: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await page.reload({ waitUntil: 'load' });
    await check();
  }).toPass({ timeout: 75_000, intervals: [2_000, 5_000, 10_000] });
}
