/**
 * Hostel screen coverage — shared personas, per-run seeding and helpers (specs 69–71).
 *
 * Every test seeds its own hostel, structure, student and hostel rows through the live
 * gateway with a unique tag, so assertions find this run's rows regardless of leftovers
 * on a reused database. The hostel API has no delete routes, so rows from earlier runs
 * stay; the hostel lists the screens read are uncapped (every page is read), and the
 * student pickers are searched by tag, so leftovers never hide this run's rows.
 *
 * Screen persona: a tenant administrator (`roleId: 'admin'`). Gateway RBAC and the hostel
 * domain (`hostel-access.ts`) both allow it. The hostel staff roles (warden, registrar)
 * are refused by gateway RBAC today (H-D2, defects.md), so they are not used here.
 *
 * Strings never look like real people: they start with `HO ` / `Ho` and carry the tag.
 */
import { randomUUID } from 'node:crypto';

import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

import { createSignedJwt, setupGatewayTenantSession } from './fake-session';

export const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
export const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:3000';

/** Seeded by tools/e2e/seed-e2e-tenants.sql. */
export const TENANT_A = '00000000-0000-4000-8000-000000000001';
export const TENANT_B = '00000000-0000-4000-8000-0000000000bb';

/** 8 upper-case hex characters, unique per call. */
export function newTag(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
}

/** UTC calendar date `days` from now (derived from the run, never hard-coded). */
export function utcDate(days = 0): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
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

function persona(sub: string, tenantId: string, role: PersonaRole, displayName: string): Persona {
  return { sub, email: `${sub}@tenant.test`, displayName, tenantId, roles: [role] };
}

/** Tenant administrator: the staff persona with hostel access. */
export function hostelAdmin(sub: string, tenantId: string = TENANT_A): Persona {
  return persona(
    sub,
    tenantId,
    { roleId: 'admin', roleName: 'Administrator', areaId: null },
    'HO Administrator',
  );
}

/** Staff without hostel access (gateway grants hostel read; the hostel domain refuses). */
export function teacher(sub: string, tenantId: string = TENANT_A): Persona {
  return persona(
    sub,
    tenantId,
    { roleId: 'teacher', roleName: 'Teacher', areaId: null },
    'HO Teacher',
  );
}

export function studentUser(sub: string, tenantId: string = TENANT_A): Persona {
  return persona(
    sub,
    tenantId,
    { roleId: 'student', roleName: 'Student', areaId: null },
    'HO Student',
  );
}

export function parentUser(sub: string, tenantId: string = TENANT_A): Persona {
  return persona(
    sub,
    tenantId,
    { roleId: 'parent', roleName: 'Parent', areaId: null },
    'HO Parent',
  );
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

export async function postCreated(
  request: APIRequestContext,
  p: Persona,
  path: string,
  data: Row,
): Promise<Row & { id: string }> {
  const res = await request.post(`${GATEWAY_URL}/api/v1${path}`, { headers: apiHeaders(p), data });
  expect(res.status(), `POST ${path}: ${await res.text()}`).toBe(201);
  return (await res.json()) as Row & { id: string };
}

export async function getRows(
  request: APIRequestContext,
  p: Persona,
  path: string,
): Promise<Row[]> {
  const res = await request.get(`${GATEWAY_URL}/api/v1${path}`, { headers: apiHeaders(p) });
  expect(res.status(), `GET ${path}: ${await res.text()}`).toBe(200);
  const body = (await res.json()) as { data?: Row[] };
  expect(Array.isArray(body.data), `GET ${path} returns { data: [] }`).toBe(true);
  return body.data ?? [];
}

/**
 * Every row of a paged hostel list (`/hostel/assignments`, `/leaves`, `/visitors`), so a
 * row is found however many earlier runs left behind.
 */
export async function getAllPages(
  request: APIRequestContext,
  p: Persona,
  path: string,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let page = 1; page <= 200; page += 1) {
    const res = await request.get(`${GATEWAY_URL}/api/v1${path}?page=${page}&pageSize=100`, {
      headers: apiHeaders(p),
    });
    expect(res.status(), `GET ${path} page ${page}`).toBe(200);
    const body = (await res.json()) as { data?: Row[]; meta?: { totalPages?: number } };
    rows.push(...(body.data ?? []));
    if (page >= (body.meta?.totalPages ?? 0)) break;
  }
  return rows;
}

export interface SeededStudent {
  id: string;
  /** Directory label the hostel screens render (`First Last`). */
  label: string;
}

export async function createStudent(
  request: APIRequestContext,
  p: Persona,
  tag: string,
  prefix = 'Ho',
): Promise<SeededStudent> {
  const firstName = `${prefix}${tag}`;
  const lastName = 'Resident';
  const created = await postCreated(request, p, '/students', {
    firstName,
    lastName,
    dateOfBirth: '2012-04-04',
    gender: 'female',
  });
  // The tenant assigns an admission number; the directory label is `CODE · First Last`
  // (`toStudentOption` in apps/web/src/lib/load-entity-labels.ts).
  const data = (created.customData ?? {}) as Record<string, unknown>;
  const code = ['admissionNumber', 'admissionNo', 'rollNumber', 'studentCode']
    .map((key) => data[key])
    .find((value) => (typeof value === 'string' && value.trim()) || typeof value === 'number');
  const name = `${firstName} ${lastName}`;
  return { id: created.id, label: code === undefined ? name : `${String(code).trim()} · ${name}` };
}

export interface SeededStructure {
  hostel: { id: string; name: string; code: string };
  block: { id: string; name: string };
  room: { id: string; roomNumber: string };
  bed: { id: string; bedLabel: string };
}

/** One hostel with one block, room and bed, all named after `tag`. */
export async function seedStructure(
  request: APIRequestContext,
  p: Persona,
  tag: string,
  prefix = 'HO',
): Promise<SeededStructure> {
  const name = `${prefix} hall ${tag}`;
  const code = `${prefix}-${tag}`;
  const hostel = await postCreated(request, p, '/hostel', { name, code, capacity: 40 });
  const blockName = `${prefix} block ${tag}`;
  const block = await postCreated(request, p, '/hostel/blocks', {
    hostelId: hostel.id,
    name: blockName,
    floor: 2,
  });
  const roomNumber = `${prefix}R${tag}`;
  const room = await postCreated(request, p, '/hostel/rooms', {
    blockId: block.id,
    roomNumber,
    capacity: 3,
  });
  const bedLabel = `${prefix}B${tag}`;
  const bed = await postCreated(request, p, '/hostel/beds', { roomId: room.id, bedLabel });
  return {
    hostel: { id: hostel.id, name, code },
    block: { id: block.id, name: blockName },
    room: { id: room.id, roomNumber },
    bed: { id: bed.id, bedLabel },
  };
}

export interface SeededHostelData extends SeededStructure {
  student: SeededStudent;
  assignment: { id: string; startDate: string };
  leave: { id: string; reason: string; startDate: string; endDate: string };
  visitor: { id: string; visitorName: string; visitDate: string };
  gatePass: { id: string; reason: string; expectedOutAt: string; expectedInAt: string };
  fee: { id: string; roomType: string; termLabel: string; amountCents: number };
  plan: { id: string; name: string };
  menu: { id: string; itemName: string };
  subscription: { id: string };
  attendance: { id: string; onDate: string; reason: string };
  /** Every hostel string seeded above (not the student label). */
  strings: string[];
  /** Every hostel row id seeded above. */
  ids: string[];
}

/** A full hostel data set for one student: one row on every hostel surface. */
export async function seedHostelData(
  request: APIRequestContext,
  p: Persona,
  tag: string,
  prefix = 'HO',
): Promise<SeededHostelData> {
  const s = await seedStructure(request, p, tag, prefix);
  const student = await createStudent(request, p, tag, prefix === 'HO' ? 'Ho' : 'Hob');
  const startDate = utcDate(0);
  const assignment = await postCreated(request, p, '/hostel/assignments', {
    studentId: student.id,
    bedId: s.bed.id,
    startDate,
  });
  const leaveReason = `${prefix} leave reason ${tag}`;
  const leave = await postCreated(request, p, '/hostel/leaves', {
    studentId: student.id,
    hostelId: s.hostel.id,
    startDate: utcDate(3),
    endDate: utcDate(5),
    reason: leaveReason,
  });
  const visitorName = `${prefix} visitor ${tag}`;
  const visitor = await postCreated(request, p, '/hostel/visitors', {
    hostelId: s.hostel.id,
    visitorName,
    studentId: student.id,
    visitDate: utcDate(1),
  });
  const gateReason = `${prefix} gate reason ${tag}`;
  const out = new Date(Date.now() + 2 * 86_400_000);
  out.setUTCHours(8, 0, 0, 0);
  const expectedOutAt = out.toISOString();
  const expectedInAt = new Date(out.getTime() + 10 * 3_600_000).toISOString();
  const gatePass = await postCreated(request, p, '/hostel/gate-passes', {
    hostelId: s.hostel.id,
    studentId: student.id,
    requestedBy: 'resident',
    reason: gateReason,
    expectedOutAt,
    expectedInAt,
  });
  const roomType = `${prefix} room type ${tag}`;
  const termLabel = `${prefix} term ${tag}`;
  const amountCents = 1_234_500;
  const fee = await postCreated(request, p, '/hostel/fee-structures', {
    hostelId: s.hostel.id,
    roomType,
    termLabel,
    amountCents,
  });
  const planName = `${prefix} mess plan ${tag}`;
  const plan = await postCreated(request, p, '/hostel/mess/plans', {
    hostelId: s.hostel.id,
    name: planName,
    mealCount: 4,
  });
  const itemName = `${prefix} dish ${tag}`;
  const menu = await postCreated(request, p, '/hostel/mess/menu', {
    planId: plan.id,
    weekday: 2,
    meal: 'dinner',
    itemName,
  });
  const subscription = await postCreated(request, p, '/hostel/mess/subscriptions', {
    planId: plan.id,
    studentId: student.id,
    startDate,
  });
  const attendanceReason = `${prefix} roll reason ${tag}`;
  const onDate = utcDate(0);
  const markRes = await request.put(`${GATEWAY_URL}/api/v1/hostel/attendance`, {
    headers: apiHeaders(p),
    data: {
      blockId: s.block.id,
      studentId: student.id,
      onDate,
      status: 'absent',
      reason: attendanceReason,
    },
  });
  expect(markRes.ok(), `PUT /hostel/attendance: ${await markRes.text()}`).toBe(true);
  const mark = (await markRes.json()) as { id: string };
  return {
    ...s,
    student,
    assignment: { id: assignment.id, startDate },
    leave: { id: leave.id, reason: leaveReason, startDate: utcDate(3), endDate: utcDate(5) },
    visitor: { id: visitor.id, visitorName, visitDate: utcDate(1) },
    gatePass: { id: gatePass.id, reason: gateReason, expectedOutAt, expectedInAt },
    fee: { id: fee.id, roomType, termLabel, amountCents },
    plan: { id: plan.id, name: planName },
    menu: { id: menu.id, itemName },
    subscription: { id: subscription.id },
    attendance: { id: mark.id, onDate, reason: attendanceReason },
    strings: [
      s.hostel.name,
      s.hostel.code,
      s.block.name,
      s.room.roomNumber,
      s.bed.bedLabel,
      leaveReason,
      visitorName,
      gateReason,
      roomType,
      termLabel,
      planName,
      itemName,
      attendanceReason,
    ],
    ids: [
      s.hostel.id,
      s.block.id,
      s.room.id,
      s.bed.id,
      assignment.id,
      leave.id,
      visitor.id,
      gatePass.id,
      fee.id,
      plan.id,
      menu.id,
      subscription.id,
      mark.id,
    ],
  };
}

/** The nine hostel screens (routes under apps/web/src/app/(dashboard)/hostel). */
export const HOSTEL_ROUTES = [
  '/hostel',
  '/hostel/structure',
  '/hostel/assignments',
  '/hostel/leaves',
  '/hostel/visitors',
  '/hostel/gate-passes',
  '/hostel/mess',
  '/hostel/fees',
  '/hostel/attendance',
] as const;

/**
 * Exactly one `[data-testid=testId]` node with `data-hydrated="true"`. `next start` can
 * briefly stream a duplicate node during hydration, so wait on the count first (the
 * strict-mode violation does not retry); see 49-hostel-ops-write-smoke.spec.ts.
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
 * Choose `studentId` in an EntitySearchSelect (`presentation: 'select'`). The picker shows
 * at most 50 options, so filter by the student's unique label first.
 */
export async function pickStudent(
  form: Locator,
  selectId: string,
  student: SeededStudent,
): Promise<void> {
  await form.locator(`#${selectId}-search`).fill(student.label);
  const select = form.locator(`#${selectId}`);
  await expect(select.locator(`option[value="${student.id}"]`)).toHaveCount(1);
  await select.selectOption(student.id);
}

/**
 * `main li` rows whose text starts with `text` (case-sensitive). Structure rows nest
 * parent names (a room row names its block, a bed row its room), so a plain `hasText`
 * filter would match the parent's row too.
 */
export function rowStartingWith(page: Page, text: string): Locator {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page.locator('main li').filter({ hasText: new RegExp(`^${escaped}`) });
}

/** Soft-assert none of `strings` is in the page HTML (rendered DOM and RSC payload). */
export async function expectNotInPage(page: Page, where: string, strings: string[]): Promise<void> {
  const html = await page.content();
  for (const s of strings) {
    expect.soft(html, `${where}: "${s}" must not be sent to the browser`).not.toContain(s);
  }
}
