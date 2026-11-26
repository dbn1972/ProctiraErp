/**
 * Staff / HR screen coverage — shared personas, per-run seeding and helpers (specs 93–95).
 *
 * Every test seeds its own staff and HR rows through the live gateway with a unique tag, so
 * assertions find this run's rows however many earlier runs left behind. The staff API has
 * no delete for HR rows, so rows stay. Several staff screens read only the first page of a
 * list (S-D4 in the task's defects.md), so seeded rows are made to sort first:
 * - `/staff/attendance` lists the first 100 staff by last name: attendance staff get a last
 *   name from `firstSortingLastName()`, which sorts newer runs before older ones.
 * - `/staff/contracts` shows the 50 contracts with the latest start date: seeded contracts
 *   start `CONTRACT_START_DAYS` after the run date.
 * - `/staff/leaves` shows the 50 newest requests: seeded leave is created during the test.
 * - qualifications are ordered by year: seeded ones use the schema maximum (2100). Only these
 *   specs write year-2100 rows (two or three per run), so a reused database needs more than
 *   about 16 runs before the first page can fill up; CI starts from a fresh database.
 *
 * Payroll (S-D1): the first export of a month posts that month's run and later exports return
 * it unchanged. Each payroll test therefore uses its own random past month (years 1000–1899,
 * 10 800 months; nothing else in the suite exports them) and asserts the run it posted.
 * Amounts are the seed's: a contract of `PAYROLL_DAILY_CENTS` × days in the month, one
 * absent day and one half day. Under the DR37 loss-of-pay rule (PRC-M370) with the default
 * `calendar_days` divisor (`PAYROLL_LOP_DIVISOR` unset, as in CI) the per-day rate is exactly
 * `PAYROLL_DAILY_CENTS`, the absent day is 1 LOP day, the half day is 0.5 and the paid leave
 * day is 0, so the deduction is 1.5 daily rates.
 *
 * Screen persona: a tenant administrator (`roleId: 'admin'`); gateway RBAC, the web guard and
 * staff-access.ts all allow it. Strings never look like real people: they start with `St` /
 * `ST` and carry the tag.
 */
import { randomInt, randomUUID } from 'node:crypto';

import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

import { createSignedJwt, setupGatewayTenantSession } from './fake-session';
import { ensureSharedAcademicYear, uniqueGradeOrder } from './test-data';

export const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
export const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:3000';

/** Seeded by tools/e2e/seed-e2e-tenants.sql. */
export const TENANT_A = '00000000-0000-4000-8000-000000000001';
export const TENANT_B = '00000000-0000-4000-8000-0000000000bb';
/** Tenant A's seeded school ("E2E Demo School"). */
export const INSTITUTION_A = 'a2e96cd1-0232-4cce-97e2-00ebbfb9a374';
export const INSTITUTION_A_NAME = 'E2E Demo School';

/** Seeded contracts start this many days after the run date (sorts them first). */
export const CONTRACT_START_DAYS = 4000;
/** Payroll contracts pay this many cents per calendar day of the month. */
export const PAYROLL_DAILY_CENTS = 100_000;
/** DR37 LOP for the seeded marks: absent (1) + half day (0.5) = 1.5 daily rates. */
export const PAYROLL_LOP_CENTS = (PAYROLL_DAILY_CENTS * 3) / 2;

/** 8 upper-case hex characters, unique per call. */
export function newTag(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
}

/** UTC calendar date `days` from now (derived from the run, never hard-coded). */
export function utcDate(days = 0): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * A last name that sorts before every earlier run's (`Aaa` + 13 digits that shrink as time
 * passes), so the run's staff are on the first page of last-name-ordered lists.
 */
export function firstSortingLastName(): string {
  return `Aaa${String(9_999_999_999_999 - Date.now()).padStart(13, '0')}`;
}

export interface PersonaRole {
  roleId: string;
  roleName: string;
  areaId: string | null;
}

export interface Persona {
  sub: string;
  email: string;
  displayName: string;
  tenantId: string;
  roles: PersonaRole[];
}

function persona(sub: string, tenantId: string, roleId: string, roleName: string): Persona {
  return {
    sub,
    email: `${sub}@tenant.test`,
    displayName: `ST ${roleName}`,
    tenantId,
    roles: [{ roleId, roleName, areaId: null }],
  };
}

/** Tenant administrator: the HR persona for every staff screen. */
export function hrAdmin(sub: string, tenantId: string = TENANT_A): Persona {
  return persona(sub, tenantId, 'admin', 'Administrator');
}

/** Roles without staff access (web guard, gateway RBAC and staff-access.ts all refuse). */
export function teacher(sub: string, tenantId: string = TENANT_A): Persona {
  return persona(sub, tenantId, 'teacher', 'Teacher');
}
export function officeStaff(sub: string, tenantId: string = TENANT_A): Persona {
  return persona(sub, tenantId, 'staff', 'Staff');
}
export function studentUser(sub: string, tenantId: string = TENANT_A): Persona {
  return persona(sub, tenantId, 'student', 'Student');
}
export function parentUser(sub: string, tenantId: string = TENANT_A): Persona {
  return persona(sub, tenantId, 'parent', 'Parent');
}

/** Gateway headers for `persona` (HS256 JWT accepted by the live gateway). */
export function apiHeaders(p: Persona, extra: Record<string, string> = {}): Record<string, string> {
  const token = createSignedJwt({ ...p, institutions: [] });
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Tenant-ID': p.tenantId,
    ...extra,
  };
}

/** Browser session cookies for `persona`. */
export async function openAs(page: Page, p: Persona): Promise<void> {
  await setupGatewayTenantSession(page, p);
}

export type Row = Record<string, unknown>;

/** POST expecting 200 or 201; returns the JSON body. */
export async function postOk(
  request: APIRequestContext,
  p: Persona,
  path: string,
  data: unknown,
): Promise<Row & { id: string }> {
  const res = await request.post(`${GATEWAY_URL}/api/v1${path}`, { headers: apiHeaders(p), data });
  expect([200, 201], `POST ${path}: ${await res.text()}`).toContain(res.status());
  return (await res.json()) as Row & { id: string };
}

export async function getJson<T = Row>(
  request: APIRequestContext,
  p: Persona,
  path: string,
): Promise<T> {
  const res = await request.get(`${GATEWAY_URL}/api/v1${path}`, { headers: apiHeaders(p) });
  expect(res.status(), `GET ${path}: ${await res.text()}`).toBe(200);
  return (await res.json()) as T;
}

/** Every row of a paged staff list (`page`/`pageSize`, `meta.totalPages`). */
export async function getAllPages(
  request: APIRequestContext,
  p: Persona,
  path: string,
): Promise<Row[]> {
  const sep = path.includes('?') ? '&' : '?';
  const rows: Row[] = [];
  for (let page = 1; page <= 500; page += 1) {
    const body = await getJson<{ data?: Row[]; meta?: { totalPages?: number } }>(
      request,
      p,
      `${path}${sep}page=${page}&pageSize=100`,
    );
    rows.push(...(body.data ?? []));
    if (page >= (body.meta?.totalPages ?? 0)) break;
  }
  return rows;
}

export interface SeededStaff {
  id: string;
  firstName: string;
  lastName: string;
  identityNumber: string;
  contactPhone: string;
  contactEmail: string;
  position: string;
  /** `First Last` (staff list, attendance, payroll rows). */
  name: string;
  /** Picker / directory label (`Position · First Last`, formatPersonLabel). */
  label: string;
}

export async function createStaff(
  request: APIRequestContext,
  p: Persona,
  tag: string,
  opts: { lastName?: string; suffix?: string; prefix?: string } = {},
): Promise<SeededStaff> {
  const prefix = opts.prefix ?? 'St';
  const suffix = opts.suffix ?? '';
  const firstName = `${prefix}${tag}${suffix}`;
  const lastName = opts.lastName ?? 'Staffer';
  const identityNumber = `${prefix.toUpperCase()}-${tag}${suffix}`;
  const contactPhone = `+1555${String(randomInt(1_000_000, 9_999_999))}`;
  const contactEmail = `${prefix.toLowerCase()}-${tag.toLowerCase()}${suffix.toLowerCase()}@staff.test`;
  const position = 'Teacher';
  const created = await postOk(request, p, '/staff', {
    firstName,
    lastName,
    dateOfBirth: '1984-06-15',
    identityNumber,
    contactPhone,
    contactEmail,
    position,
  });
  const name = `${firstName} ${lastName}`;
  return {
    id: created.id,
    firstName,
    lastName,
    identityNumber,
    contactPhone,
    contactEmail,
    position,
    name,
    label: `${position} · ${name}`,
  };
}

export interface PayrollMonth {
  month: string;
  days: number;
  grossCents: number;
}

/** A random past month nothing else exports (see the header), with the seed's gross. */
export function randomPayrollMonth(): PayrollMonth {
  const year = 1000 + randomInt(900);
  const mon = 1 + randomInt(12);
  const days = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return {
    month: `${year}-${String(mon).padStart(2, '0')}`,
    days,
    grossCents: days * PAYROLL_DAILY_CENTS,
  };
}

export interface SeededPayroll extends PayrollMonth {
  band: string;
  contractId: string;
  /** Seeded marks: present 1, half-day 1, absent 1, leave 1. */
  daysPresent: number;
  leaveDays: number;
  absentDays: number;
  payableDays: number;
  deductionsCents: number;
  netCents: number;
}

/** A contract covering one random past month plus one mark of each status in it. */
export async function seedPayrollMonth(
  request: APIRequestContext,
  p: Persona,
  staff: SeededStaff,
  tag: string,
  prefix = 'ST',
): Promise<SeededPayroll> {
  const m = randomPayrollMonth();
  const band = `${prefix}P${tag}`;
  const contract = await postOk(request, p, '/staff/contracts', {
    staffId: staff.id,
    contractType: 'permanent',
    startDate: `${m.month}-01`,
    endDate: `${m.month}-${String(m.days).padStart(2, '0')}`,
    salaryBand: band,
    monthlyGrossCents: m.grossCents,
  });
  const marks: Array<[string, string]> = [
    ['01', 'present'],
    ['02', 'half_day'],
    ['03', 'absent'],
    ['04', 'leave'],
  ];
  for (const [day, status] of marks) {
    await postOk(request, p, '/staff/attendance', {
      staffId: staff.id,
      date: `${m.month}-${day}`,
      status,
    });
  }
  return {
    ...m,
    band,
    contractId: contract.id,
    daysPresent: 1,
    leaveDays: 1,
    absentDays: 1,
    payableDays: 1.5,
    deductionsCents: PAYROLL_LOP_CENTS,
    netCents: m.grossCents - PAYROLL_LOP_CENTS,
  };
}

export interface PayrollRow {
  staffId: string;
  name: string;
  salaryBand: string;
  daysPresent: number;
  leaveDays: number;
  absentDays: number;
  grossCents: number;
  deductionsCents: number;
  netCents: number;
  payableDays: number;
}

export interface PayrollExportBody {
  month: string;
  idempotent: boolean;
  rows: PayrollRow[];
}

export async function exportPayroll(
  request: APIRequestContext,
  p: Persona,
  month: string,
): Promise<PayrollExportBody> {
  return getJson<PayrollExportBody>(request, p, `/staff/payroll/export?month=${month}`);
}

export interface SeededSchool {
  subject: { id: string; name: string; code: string; label: string };
  klass: { id: string; name: string };
  academicPeriodId: string;
}

/** A subject and a class at tenant A's school, named after `tag`. */
export async function seedClassAndSubject(
  request: APIRequestContext,
  p: Persona,
  tag: string,
): Promise<SeededSchool> {
  const period = await ensureSharedAcademicYear(request, GATEWAY_URL, apiHeaders(p));
  const code = `STS${tag}`;
  const subjectName = `ST subject ${tag}`;
  const subject = await postOk(request, p, '/subjects', { name: subjectName, code });
  const grade = await postOk(request, p, '/grades', {
    name: `ST grade ${tag}`,
    code: `STG${tag}`,
    order: uniqueGradeOrder(),
  });
  const className = `ST class ${tag}`;
  const klass = await postOk(request, p, '/classes', {
    institutionId: INSTITUTION_A,
    gradeId: grade.id,
    academicPeriodId: period.id,
    name: className,
    capacity: 30,
  });
  return {
    subject: { id: subject.id, name: subjectName, code, label: `${code} · ${subjectName}` },
    klass: { id: klass.id, name: className },
    academicPeriodId: period.id,
  };
}

export interface SeededTemplate {
  id: string;
  name: string;
  criteria: Array<{ name: string; weight: number; maxScore: number }>;
}

/** An appraisal template on a 0–5 scale with two equally weighted criteria. */
export async function seedTemplate(
  request: APIRequestContext,
  p: Persona,
  tag: string,
): Promise<SeededTemplate> {
  const period = await ensureSharedAcademicYear(request, GATEWAY_URL, apiHeaders(p));
  const name = `ST template ${tag}`;
  const criteria = [
    { name: `ST planning ${tag}`, weight: 50, maxScore: 5 },
    { name: `ST delivery ${tag}`, weight: 50, maxScore: 5 },
  ];
  const t = await postOk(request, p, '/staff/appraisals/templates', {
    name,
    academicPeriodId: period.id,
    criteria,
    scoreMin: 0,
    scoreMax: 5,
  });
  return { id: t.id, name, criteria };
}

/** Next date on or after `fromDays` from now that falls on ISO weekday `isoDay` (1 = Mon). */
export function nextIsoWeekday(isoDay: number, fromDays = 0): string {
  const d = new Date(Date.now() + fromDays * 86_400_000);
  while (((d.getUTCDay() + 6) % 7) + 1 !== isoDay) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export interface SeededMeeting {
  meetingId: string;
  /** Next meeting weekday about 120 days out (the substitutions list shows latest first). */
  date: string;
  original: SeededStaff;
  substitute: SeededStaff;
}

/**
 * Two new staff members at tenant A's school and a Wednesday timetable meeting taught by
 * the first; the second is free to substitute.
 */
export async function seedMeeting(
  request: APIRequestContext,
  p: Persona,
  tag: string,
): Promise<SeededMeeting> {
  const period = await ensureSharedAcademicYear(request, GATEWAY_URL, apiHeaders(p));
  const original = await createStaff(request, p, tag, { suffix: 'T', lastName: 'Taught' });
  const substitute = await createStaff(request, p, tag, { suffix: 'S', lastName: 'Cover' });
  for (const s of [original, substitute]) {
    // PRC-M101: meetings and substitutes need an active assignment at the school.
    await postOk(request, p, '/staff/assignments', {
      staffId: s.id,
      institutionId: INSTITUTION_A,
      subjectId: '00000000-0000-4000-8000-0000000005b1',
      classId: '00000000-0000-4000-8000-0000000005c1',
      role: 'Teacher',
      allocationPercentage: 10,
      startDate: utcDate(-1),
    });
  }
  const bell = await postOk(request, p, '/timetable/bell-schedules', {
    institutionId: INSTITUTION_A,
    academicPeriodId: period.id,
    name: `ST bell ${tag}`,
    code: `STB${tag}`,
    dayPattern: '1,2,3,4,5',
  });
  const slot = await postOk(request, p, `/timetable/bell-schedules/${bell.id}/periods`, {
    name: 'P1',
    periodOrder: 1,
    startTime: '08:00',
    endTime: '08:45',
  });
  const section = await postOk(request, p, '/timetable/sections', {
    institutionId: INSTITUTION_A,
    academicPeriodId: period.id,
    name: `ST sec ${tag}`,
    code: `STC${tag}`,
    capacity: 30,
  });
  const meeting = await postOk(request, p, '/timetable/meetings', {
    institutionId: INSTITUTION_A,
    academicPeriodId: period.id,
    sectionId: section.id,
    staffId: original.id,
    periodId: slot.id,
    dayOfWeek: 3,
    status: 'active',
  });
  return { meetingId: meeting.id, date: nextIsoWeekday(3, 120), original, substitute };
}

export interface SeededSubstitution extends SeededMeeting {
  id: string;
  reason: string;
  /** Status the API stored (the screen prints it unchanged). */
  status: string;
}

/** {@link seedMeeting} plus one substitution of its meeting by the second staff member. */
export async function seedSubstitution(
  request: APIRequestContext,
  p: Persona,
  tag: string,
): Promise<SeededSubstitution> {
  const m = await seedMeeting(request, p, tag);
  const reason = `ST cover reason ${tag}`;
  const sub = await postOk(request, p, '/timetable/substitutions', {
    sectionMeetingId: m.meetingId,
    substituteStaffId: m.substitute.id,
    substitutionDate: m.date,
    reason,
  });
  return { ...m, id: sub.id, reason, status: String(sub.status) };
}

export interface SeededStaffData {
  staff: SeededStaff;
  contract: {
    id: string;
    band: string;
    startDate: string;
    endDate: string;
    notes: string;
  };
  qualification: { id: string; degree: string; institution: string; documentRef: string };
  /** Approved one-day sick leave today and a pending casual leave tomorrow-ish, same year. */
  approvedLeave: { id: string; reason: string; date: string };
  pendingLeave: { id: string; reason: string; date: string };
  attendance: { id: string; date: string };
  payroll: SeededPayroll;
  /** Every HR string seeded above (staff PII included). */
  strings: string[];
  /** Every HR row id seeded above. */
  ids: string[];
}

/** PRC-H091: approving balance-tracked leave needs an opening balance for that type. */
export async function setLeaveBalance(
  request: APIRequestContext,
  p: Persona,
  staffId: string,
  leaveType: 'annual' | 'sick' | 'casual' | 'other',
  balanceDays: number,
): Promise<void> {
  const res = await request.put(`${GATEWAY_URL}/api/v1/staff/${staffId}/leave-balances`, {
    headers: apiHeaders(p),
    data: { leaveType, balanceDays },
  });
  expect(res.ok(), `PUT leave-balances: ${await res.text()}`).toBe(true);
}

/** One date in the current UTC year at or after today (Dec 31 stays Dec 31). */
function sameYearDate(days: number): string {
  const today = utcDate(0);
  const later = utcDate(days);
  return later.slice(0, 4) === today.slice(0, 4) ? later : today;
}

/**
 * A full HR data set for one staff member: contract, qualification, two leaves (one
 * approved), one attendance mark `attendanceOffset` days ago and a posted payroll month.
 */
export async function seedStaffData(
  request: APIRequestContext,
  p: Persona,
  tag: string,
  opts: { prefix?: string; attendanceOffset?: number } = {},
): Promise<SeededStaffData> {
  const prefix = opts.prefix ?? 'St';
  // Upper-case prefix for every HR string, so two tenants seeded with one tag differ.
  const P = prefix.toUpperCase();
  const staff = await createStaff(request, p, tag, { prefix, lastName: firstSortingLastName() });
  const band = `${P}B${tag}`;
  const startDate = utcDate(CONTRACT_START_DAYS);
  const endDate = utcDate(CONTRACT_START_DAYS + 400);
  const notes = `${P} contract note ${tag}`;
  const contract = await postOk(request, p, '/staff/contracts', {
    staffId: staff.id,
    contractType: 'fixed_term',
    startDate,
    endDate,
    salaryBand: band,
    notes,
  });
  const degree = `${P} degree ${tag}`;
  const university = `${P} university ${tag}`;
  const documentRef = `${P}-DOC-${tag}`;
  const qualification = await postOk(request, p, '/staff/qualifications', {
    staffId: staff.id,
    degree,
    institution: university,
    year: 2100,
    documentRef,
  });
  const approvedDate = sameYearDate(0);
  const approvedReason = `${P} sick reason ${tag}`;
  const approved = await postOk(request, p, '/staff/leaves', {
    staffId: staff.id,
    leaveType: 'sick',
    startDate: approvedDate,
    endDate: approvedDate,
    reason: approvedReason,
  });
  await setLeaveBalance(request, p, staff.id, 'sick', 10);
  await postOk(request, p, `/staff/leaves/${approved.id}/decide`, { status: 'approved' });
  const pendingDate = sameYearDate(1);
  const pendingReason = `${P} casual reason ${tag}`;
  const pending = await postOk(request, p, '/staff/leaves', {
    staffId: staff.id,
    leaveType: 'casual',
    startDate: pendingDate,
    endDate: pendingDate,
    reason: pendingReason,
  });
  const attendanceDate = utcDate(-(opts.attendanceOffset ?? 333));
  const mark = await postOk(request, p, '/staff/attendance', {
    staffId: staff.id,
    date: attendanceDate,
    status: 'half_day',
  });
  const payroll = await seedPayrollMonth(request, p, staff, tag, P);
  const posted = await exportPayroll(request, p, payroll.month);
  expect(posted.idempotent, `payroll ${payroll.month} was not exported before`).toBe(false);
  return {
    staff,
    contract: { id: contract.id, band, startDate, endDate, notes },
    qualification: { id: qualification.id, degree, institution: university, documentRef },
    approvedLeave: { id: approved.id, reason: approvedReason, date: approvedDate },
    pendingLeave: { id: pending.id, reason: pendingReason, date: pendingDate },
    attendance: { id: mark.id, date: attendanceDate },
    payroll,
    strings: [
      staff.firstName,
      staff.identityNumber,
      staff.contactPhone,
      staff.contactEmail,
      band,
      notes,
      degree,
      university,
      documentRef,
      approvedReason,
      pendingReason,
      payroll.band,
    ],
    ids: [
      staff.id,
      contract.id,
      qualification.id,
      approved.id,
      pending.id,
      mark.id,
      payroll.contractId,
    ],
  };
}

/** The twelve staff screens (routes under apps/web/src/app/(dashboard)/staff). */
export function staffRoutes(staffId: string): string[] {
  return [
    '/staff',
    `/staff/${staffId}`,
    `/staff/${staffId}/appraisals/new`,
    `/staff/${staffId}/assignments/new`,
    `/staff/${staffId}/edit`,
    '/staff/attendance',
    '/staff/contracts',
    '/staff/import',
    '/staff/leaves',
    '/staff/new',
    '/staff/payroll',
    '/staff/substitutions',
  ];
}

/**
 * Exactly one `[data-testid=testId]` node with `data-hydrated="true"`. `next start` can
 * briefly stream a duplicate node during hydration, so wait on the count first (the
 * strict-mode violation does not retry); see 52-staff-hr-write-smoke.spec.ts.
 */
export async function hydratedForm(page: Page, testId: string): Promise<Locator> {
  const el = page.getByTestId(testId);
  await expect(async () => {
    await expect(el).toHaveCount(1, { timeout: 2_000 });
    await expect(el).toHaveAttribute('data-hydrated', 'true', { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  return el;
}

/**
 * Choose `staff` in an EntitySearchSelect (`presentation: 'select'`). The picker shows at
 * most 50 options, so filter by the staff member's unique label first.
 */
export async function pickStaff(form: Locator, selectId: string, staff: SeededStaff) {
  await form.locator(`#${selectId}-search`).fill(staff.firstName);
  const select = form.locator(`#${selectId}`);
  await expect(select.locator(`option[value="${staff.id}"]`)).toHaveCount(1);
  await select.selectOption(staff.id);
}

/** Choose `name` in a Radix Select whose trigger has id `triggerId`. */
export async function pickRadixOption(page: Page, triggerId: string, name: string) {
  await page.locator(`#${triggerId}`).click();
  await page.getByRole('option', { name, exact: true }).click();
  await expect(page.locator(`#${triggerId}`)).toContainText(name);
}

/** Soft-assert none of `strings` is in the page HTML (rendered DOM and RSC payload). */
export async function expectNotInPage(page: Page, where: string, strings: string[]): Promise<void> {
  const html = await page.content();
  for (const s of strings) {
    expect.soft(html, `${where}: "${s}" must not be sent to the browser`).not.toContain(s);
  }
}

/** Rows of a CSV with a header line, as objects keyed by the header. */
export function parseCsv(text: string): Array<Record<string, string>> {
  const [head, ...lines] = text.trim().split(/\r?\n/);
  const cols = (head ?? '').split(',').map((c) => c.replace(/^"|"$/g, ''));
  return lines.map((line) => {
    const cells = line.split(',').map((c) => c.replace(/^"|"$/g, ''));
    return Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? '']));
  });
}
