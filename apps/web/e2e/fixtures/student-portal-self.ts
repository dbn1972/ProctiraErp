/**
 * Student portal screen coverage — per-run students (specs 60–61).
 *
 * Each test creates its own students through `POST /students` (unique names)
 * and signs in with `sub = students.id`. That binds the student portal
 * (`PgAcademicVisibilityStore.resolveStudentId`: `students.id = sub`) and the
 * library patron pin (the library screen passes `session.user.sub` as
 * `studentId`), so no identity rows are needed. Fresh students mean every
 * per-student read starts empty on every run; tenant-wide lists are handled
 * per helper below, so re-runs against the same database stay deterministic
 * (UAT-ENV-012).
 *
 * SQL is used only where no API exists: one completed report-card job (no
 * route completes a job in the harness) and a read of the earliest published
 * homework due date. Precedent for test-only psql: helpers/library-loans.ts.
 * Values are passed as psql variables (`:'name'`), never spliced into SQL.
 *
 * Helpers copied (not imported) from the parent-portal screen-coverage work so
 * this branch does not depend on it.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { expect, type APIRequestContext, type Page } from '@playwright/test';

import { createSignedJwt, setupGatewayTenantSession } from './fake-session';
import { ensureSharedAcademicYear, uniqueGradeOrder } from './test-data';

export const TENANT_A = '00000000-0000-4000-8000-000000000001';
export const TENANT_B = '00000000-0000-4000-8000-0000000000bb';
/** Seeded by tools/e2e/seed-e2e-tenants.sql. */
export const INSTITUTION_A = 'a2e96cd1-0232-4cce-97e2-00ebbfb9a374';
/** Seeded PUBLISHED section E2E-SEC-A (tools/e2e/seed-e2e-tenants.sql). */
export const SECTION_A = '00000000-0000-4000-8000-00000000eec1';
export const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:3000';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TAG_RE = /^[A-Z0-9]{1,16}$/;

export type Json = Record<string, unknown>;

function bearer(token: string, tenantId: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Tenant-ID': tenantId,
  };
}

export function adminHeaders(tenantId: string = TENANT_A): Record<string, string> {
  const token = createSignedJwt({
    sub: 'e2e-admin',
    email: 'admin@tenant-a.test',
    displayName: 'E2E Admin',
    tenantId,
    roles: [{ roleId: 'admin', roleName: 'SUPER_ADMIN', areaId: null }],
    institutions: [],
  });
  return bearer(token, tenantId);
}

export function teacherHeaders(): Record<string, string> {
  const token = createSignedJwt({
    sub: 'e2e-teacher',
    email: 'e2e-teacher@tenant.test',
    displayName: 'e2e-teacher',
    tenantId: TENANT_A,
    roles: [{ roleId: 'teacher', roleName: 'teacher', areaId: null }],
    institutions: [INSTITUTION_A],
  });
  return bearer(token, TENANT_A);
}

/**
 * Student principal bound by `students.id = sub`. `extra` adds client headers
 * (e.g. forged actor or tenant headers the gateway must ignore).
 */
export function studentHeaders(
  studentId: string,
  tenantId: string = TENANT_A,
  extra: Record<string, string> = {},
): Record<string, string> {
  const token = createSignedJwt({
    sub: studentId,
    email: `${studentId}@tenant.test`,
    displayName: studentId,
    tenantId,
    roles: [{ roleId: 'student', roleName: 'Student', areaId: null }],
    institutions: [INSTITUTION_A],
  });
  return { ...bearer(token, tenantId), ...extra };
}

/** 8 upper-case hex characters, unique per call. */
export function newTag(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
}

export interface Student {
  id: string;
  firstName: string;
  lastName: string;
  tenantId: string;
}

/** `POST /students` as the tenant admin; first name `SP<tag>`, last name `Student<n>`. */
export async function createStudent(
  request: APIRequestContext,
  options: { tag: string; n: number; tenantId?: string },
): Promise<Student> {
  if (!TAG_RE.test(options.tag)) throw new Error(`Unexpected tag: ${options.tag}`);
  const tenantId = options.tenantId ?? TENANT_A;
  const firstName = `SP${options.tag}`;
  const lastName = `Student${options.n}`;
  const res = await request.post(`${GATEWAY_URL}/api/v1/students`, {
    headers: adminHeaders(tenantId),
    data: {
      firstName,
      lastName,
      dateOfBirth: `2012-06-${String(options.n).padStart(2, '0')}`,
      gender: 'female',
    },
  });
  expect(res.status(), `POST /students: ${await res.text()}`).toBe(201);
  const id = (await res.json()).id as string;
  return { id, firstName, lastName, tenantId };
}

/** Session cookies for a student-only principal (`sub = students.id`). */
export async function openAsStudent(
  page: Page,
  student: { id: string; tenantId: string },
): Promise<void> {
  await setupGatewayTenantSession(page, {
    sub: student.id,
    email: `${student.id}@tenant.test`,
    displayName: `SP Student ${student.id}`,
    tenantId: student.tenantId,
    roles: [{ roleId: 'student', roleName: 'Student', areaId: null }],
  });
}

/** Session cookies for a guardian-only principal. */
export async function openAsGuardianOnly(page: Page, sub: string): Promise<void> {
  await setupGatewayTenantSession(page, {
    sub,
    email: `${sub}@tenant.test`,
    displayName: `SP Guardian ${sub}`,
    tenantId: TENANT_A,
    roles: [{ roleId: 'parent', roleName: 'Parent', areaId: null }],
  });
}

/** POST/PUT through the gateway and assert the status; returns the JSON body. */
export async function send(
  request: APIRequestContext,
  method: 'post' | 'put',
  path: string,
  data: unknown,
  expected: number,
  headers: Record<string, string> = adminHeaders(),
): Promise<Json> {
  const res = await request[method](`${GATEWAY_URL}/api/v1${path}`, { headers, data });
  expect(res.status(), `${method.toUpperCase()} ${path}: ${await res.text()}`).toBe(expected);
  return (await res.json()) as Json;
}

/** GET through the gateway; returns status and raw body text. */
export async function call(
  request: APIRequestContext,
  path: string,
  headers: Record<string, string>,
): Promise<{ status: number; text: string }> {
  const res = await request.get(`${GATEWAY_URL}/api/v1${path}`, { headers });
  return { status: res.status(), text: await res.text() };
}

/** GET that must return 200; returns the parsed body. */
export async function getOk(
  request: APIRequestContext,
  path: string,
  headers: Record<string, string>,
): Promise<Json & { data: Json[] }> {
  const res = await call(request, path, headers);
  expect(res.status, `GET ${path}: ${res.text}`).toBe(200);
  return JSON.parse(res.text) as Json & { data: Json[] };
}

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The `count` most recent distinct weekdays strictly before today (UTC). */
export function pastWeekdays(count: number): string[] {
  const days: string[] = [];
  const d = new Date();
  while (days.length < count) {
    d.setUTCDate(d.getUTCDate() - 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) days.push(isoDay(d));
  }
  return days;
}

/** A due date that moves one second earlier for every second of wall time. */
export function rerunSafeDueAt(): string {
  const anchor = Date.UTC(2026, 0, 1);
  return new Date(anchor - (Date.now() - anchor)).toISOString();
}

function databaseUrl(): string {
  const url = process.env.DATABASE_URL ?? process.env.MIGRATOR_DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL or MIGRATOR_DATABASE_URL is required for SQL setup');
  return url;
}

function assertUuid(value: string, what: string): void {
  if (!UUID_RE.test(value)) throw new Error(`Unexpected ${what}: ${value}`);
}

/**
 * Run one SQL script on stdin with psql variables (`:'name'` quoting), so no
 * value is spliced into the SQL text. Returns the non-empty output lines.
 */
function psql(sql: string, vars: Record<string, string>): string[] {
  const args = [databaseUrl(), '-v', 'ON_ERROR_STOP=1', '-qAt'];
  for (const [name, value] of Object.entries(vars)) args.push('-v', `${name}=${value}`);
  const out = execFileSync('psql', args, { input: sql, encoding: 'utf8', stdio: 'pipe' });
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

const EARLIEST_DUE_SQL = `
BEGIN;
SELECT 'tenant:' || set_config('app.tenant_id', :'tenant', true);
SELECT 'min:' || COALESCE(to_char(min(due_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '')
  FROM lms_assignments
 WHERE tenant_id = :'tenant'::uuid AND status = 'published';
COMMIT;
`;

/** Earliest `due_at` of any published assignment in the tenant, or null. */
export function earliestPublishedDueAt(tenantId: string): string | null {
  assertUuid(tenantId, 'tenant id');
  const line = psql(EARLIEST_DUE_SQL, { tenant: tenantId }).find((l) => l.startsWith('min:'));
  if (line === undefined) throw new Error('earliest due date query returned no row');
  const value = line.slice('min:'.length);
  return value ? value : null;
}

/**
 * The student homework list is tenant-wide, `ORDER BY due_at NULLS LAST
 * LIMIT 50`. A due date strictly before every published row already in the
 * tenant sorts this run's homework first, whatever earlier runs or other specs
 * left behind.
 */
export function homeworkDueAt(tenantId: string = TENANT_A): string {
  const earliest = earliestPublishedDueAt(tenantId);
  const candidates = [Date.parse(rerunSafeDueAt())];
  if (earliest) candidates.push(Date.parse(earliest) - 60_000);
  return new Date(Math.min(...candidates)).toISOString();
}

const REPORT_CARD_SQL = `
BEGIN;
SELECT 'tenant:' || set_config('app.tenant_id', :'tenant', true);
INSERT INTO report_card_templates (id, tenant_id, name, template_content)
VALUES (:'template'::uuid, :'tenant'::uuid, :'name', '<p>SP template</p>')
RETURNING 'template:' || id;
INSERT INTO report_card_jobs
  (id, tenant_id, student_id, academic_period_id, template_id, institution_id, status, completed_at)
VALUES (:'job'::uuid, :'tenant'::uuid, :'student'::uuid, :'period'::uuid, :'template'::uuid,
        :'institution'::uuid, 'completed', now())
RETURNING 'job:' || id;
COMMIT;
`;

/** One template and one completed report-card job for the student; returns the job id. */
export function seedCompletedReportCard(input: {
  tenantId: string;
  studentId: string;
  academicPeriodId: string;
  institutionId: string;
  tag: string;
}): string {
  assertUuid(input.tenantId, 'tenant id');
  assertUuid(input.studentId, 'student id');
  assertUuid(input.academicPeriodId, 'academic period id');
  assertUuid(input.institutionId, 'institution id');
  if (!TAG_RE.test(input.tag)) throw new Error(`Unexpected tag: ${input.tag}`);
  const template = randomUUID();
  const job = randomUUID();
  const lines = psql(REPORT_CARD_SQL, {
    tenant: input.tenantId,
    template,
    name: `SP template ${input.tag}`,
    job,
    student: input.studentId,
    period: input.academicPeriodId,
    institution: input.institutionId,
  });
  for (const line of [`template:${template}`, `job:${job}`]) {
    if (!lines.includes(line))
      throw new Error(`Report card seed missing ${line}: ${lines.join(' | ')}`);
  }
  return job;
}

/**
 * Per-run grade + class in the shared tenant-A year, with the given students
 * enrolled (`POST /enrollments`), so attendance and calendar resolve a period.
 */
export async function enrolInSharedYear(
  request: APIRequestContext,
  tag: string,
  studentIds: string[],
): Promise<{ periodId: string; classId: string }> {
  if (!TAG_RE.test(tag)) throw new Error(`Unexpected tag: ${tag}`);
  const period = await ensureSharedAcademicYear(request, GATEWAY_URL, adminHeaders());
  const grade = await send(
    request,
    'post',
    '/grades',
    { name: `SP Grade ${tag}`, code: `S${tag.slice(0, 6)}`, order: uniqueGradeOrder() },
    201,
  );
  const cls = await send(
    request,
    'post',
    '/classes',
    {
      institutionId: INSTITUTION_A,
      gradeId: grade.id,
      academicPeriodId: period.id,
      name: `SP Class ${tag}`,
      capacity: 30,
    },
    201,
  );
  for (const studentId of studentIds) {
    await send(
      request,
      'post',
      '/enrollments',
      {
        studentId,
        institutionId: INSTITUTION_A,
        gradeId: grade.id,
        classId: cls.id,
        academicPeriodId: period.id,
        enrolledAt: isoDay(new Date()),
      },
      201,
    );
  }
  return { periodId: period.id, classId: cls.id as string };
}

/** Mark one attendance day per `[studentId, date, status]` in the given class/period. */
export async function markAttendance(
  request: APIRequestContext,
  input: { periodId: string; classId: string },
  marks: Array<[string, string, string]>,
): Promise<void> {
  for (const [studentId, date, status] of marks) {
    await send(
      request,
      'post',
      '/attendance/student',
      {
        studentId,
        institutionId: INSTITUTION_A,
        classId: input.classId,
        academicPeriodId: input.periodId,
        date,
        status,
      },
      201,
    );
  }
}

/** Enrol in SECTION_A (tenant A) and publish one grade (as e2e/42); returns the entry id. */
export async function publishGrade(
  request: APIRequestContext,
  studentId: string,
  assessmentCode: string,
): Promise<string> {
  assertUuid(studentId, 'student id');
  await send(request, 'post', `/timetable/sections/${SECTION_A}/enrollments`, { studentId }, 201);
  const entry = await send(
    request,
    'put',
    '/gradebook/entries',
    { sectionId: SECTION_A, studentId, assessmentCode, numericScore: 88 },
    200,
  );
  for (const action of ['submit', 'approve', 'lock', 'publish']) {
    await send(
      request,
      'post',
      `/gradebook/entries/${String(entry.id)}/transition`,
      { action },
      200,
    );
  }
  return entry.id as string;
}

/** Published school-scope homework (teacher JWT); `sectionId` restricts it to one section. */
export async function createHomework(
  request: APIRequestContext,
  input: { title: string; dueAt: string; sectionId?: string },
): Promise<string> {
  const body = await send(
    request,
    'post',
    '/lms/assignments',
    {
      scope: 'school',
      institutionId: INSTITUTION_A,
      kind: 'homework',
      title: input.title,
      subject: 'Mathematics',
      dueAt: input.dueAt,
      maxScore: 10,
      publish: true,
      ...(input.sectionId ? { sectionId: input.sectionId } : {}),
    },
    201,
    teacherHeaders(),
  );
  expect(body.status, `homework ${input.title} published`).toBe('published');
  return body.id as string;
}

/** School skill plus one correct practice attempt by the student (student JWT). */
export async function practiseSkill(
  request: APIRequestContext,
  input: { tag: string; name: string; studentId: string },
): Promise<string> {
  const skill = await send(
    request,
    'post',
    '/lms/skills',
    {
      scope: 'school',
      institutionId: INSTITUTION_A,
      code: `SP-${input.tag}`,
      name: input.name,
      subject: 'Mathematics',
    },
    201,
  );
  await send(
    request,
    'post',
    `/lms/pal/students/${input.studentId}/attempts`,
    { skillId: skill.id, correct: true },
    201,
    studentHeaders(input.studentId),
  );
  return skill.id as string;
}

/**
 * Per-run published section with one weekly meeting (day 1, `SP P <tag>`
 * 08:00–08:45) and the given students enrolled (the parent spec 57 chain).
 */
export async function createTimetableMeeting(
  request: APIRequestContext,
  input: { tag: string; sectionName: string; periodName: string; studentIds: string[] },
): Promise<{ sectionId: string }> {
  const { tag } = input;
  const period = await ensureSharedAcademicYear(request, GATEWAY_URL, adminHeaders());
  const bell = await send(
    request,
    'post',
    '/timetable/bell-schedules',
    {
      institutionId: INSTITUTION_A,
      academicPeriodId: period.id,
      name: `SP Bell ${tag}`,
      code: `SB${tag.slice(0, 6)}`,
      dayPattern: '1,2,3,4,5',
    },
    201,
  );
  const bellPeriod = await send(
    request,
    'post',
    `/timetable/bell-schedules/${String(bell.id)}/periods`,
    { name: input.periodName, periodOrder: 1, startTime: '08:00', endTime: '08:45' },
    201,
  );
  const staff = await send(
    request,
    'post',
    '/staff',
    {
      firstName: 'SP',
      lastName: `Teacher ${tag}`,
      dateOfBirth: '1984-03-12',
      identityNumber: `SP-${tag}`,
      contactPhone: '+10000000001',
      contactEmail: `sp-${tag.toLowerCase()}@tenant-a.test`,
      position: 'Teacher',
    },
    201,
  );
  // Meetings require the teacher to be assigned to the institution (as e2e/50).
  await send(
    request,
    'post',
    '/staff/assignments',
    {
      staffId: staff.id,
      institutionId: INSTITUTION_A,
      subjectId: '00000000-0000-4000-8000-0000000005b1',
      classId: '00000000-0000-4000-8000-0000000005c1',
      role: 'Teacher',
      allocationPercentage: 100,
      startDate: isoDay(new Date(Date.now() - 86_400_000)),
    },
    201,
  );
  const section = await send(
    request,
    'post',
    '/timetable/sections',
    {
      institutionId: INSTITUTION_A,
      academicPeriodId: period.id,
      name: input.sectionName,
      code: `SS${tag.slice(0, 6)}`,
      capacity: 30,
    },
    201,
  );
  await send(
    request,
    'post',
    '/timetable/meetings',
    {
      institutionId: INSTITUTION_A,
      academicPeriodId: period.id,
      sectionId: section.id,
      staffId: staff.id,
      periodId: bellPeriod.id,
      roomId: null,
      dayOfWeek: 1,
      status: 'active',
    },
    201,
  );
  await send(request, 'post', `/timetable/sections/${String(section.id)}/publish`, {}, 200);
  for (const studentId of input.studentIds) {
    await send(
      request,
      'post',
      `/timetable/sections/${String(section.id)}/enrollments`,
      { studentId },
      201,
    );
  }
  return { sectionId: section.id as string };
}

/** Library item with `copies` copies (tenant admin). */
export async function createLibraryItem(
  request: APIRequestContext,
  title: string,
  tenantId: string = TENANT_A,
): Promise<string> {
  const item = await send(
    request,
    'post',
    '/library/items',
    { title, copies: 1, author: 'SP' },
    201,
    adminHeaders(tenantId),
  );
  return item.id as string;
}

export async function checkoutItem(
  request: APIRequestContext,
  itemId: string,
  studentId: string,
  tenantId: string = TENANT_A,
): Promise<Json> {
  return send(
    request,
    'post',
    '/library/circulation/checkout',
    { itemId, studentId },
    201,
    adminHeaders(tenantId),
  );
}

export async function placeHold(
  request: APIRequestContext,
  itemId: string,
  studentId: string,
): Promise<Json> {
  return send(request, 'post', '/library/holds', { itemId, studentId }, 201);
}

/** Sent school-wide (`scope: all`) campaign; returns the campaign id. */
export async function sendBroadcastCampaign(
  request: APIRequestContext,
  input: { name: string; body: string; tenantId?: string },
): Promise<string> {
  const headers = adminHeaders(input.tenantId ?? TENANT_A);
  const campaign = await send(
    request,
    'post',
    '/communication/campaigns',
    {
      name: input.name,
      body: input.body,
      channels: ['email'],
      audienceJson: { scope: 'all' },
      createdBy: 'e2e-admin',
    },
    201,
    headers,
  );
  const sent = await send(
    request,
    'post',
    `/communication/campaigns/${String(campaign.id)}/send`,
    {},
    200,
    headers,
  );
  expect(sent.status).toBe('sent');
  return campaign.id as string;
}
