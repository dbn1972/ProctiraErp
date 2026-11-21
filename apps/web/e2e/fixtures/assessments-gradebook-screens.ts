/**
 * Assessments + gradebook screen coverage — personas, per-run seeding and helpers
 * (specs 112–114).
 *
 * Every spec seeds its own rows through the live gateway with a unique tag (`AS <tag> …`),
 * so assertions find this run's rows regardless of what earlier runs left behind:
 * - Grading schemes (S2 picker loads the first 100 by name), institutions (S4 loads the
 *   first 50 by name), sections (S4 shows the first 20 by code) and students (the S8
 *   pickers load the first 100 by last name) start with `rank()`, a 14-digit key that
 *   falls every millisecond, so this run's row sorts before every older row and every
 *   name that starts with a letter. The caps themselves are defects X1/X2 (defects.md).
 * - Subjects, outcomes, items, results, grade entries and report-card jobs are found by
 *   this run's ids.
 * - Outcomes and schemes without items are deleted in `finally` where the test creates
 *   them; results, grade entries, jobs, sections and institutions have no delete API and
 *   are never counted.
 *
 * SQL is used only where no API exists (values are psql variables, never spliced):
 * - one fixed board with one default grading scale in tenant A (idempotent upsert, so
 *   re-runs add no rows). The scale code sorts first among default scales, so the
 *   gradebook screens pick it (`ORDER BY is_default DESC, code`).
 * - `staff.user_id` for per-run teachers (PRC-H066 grade-write scope, db/sql/098).
 *
 * Strings never look like real people: they start with `AS` and carry the tag.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

import {
  GATEWAY_URL,
  TENANT_A,
  apiHeaders,
  getRows,
  postCreated,
  utcDate,
  type Persona,
  type Row,
} from './hostel-screens';

export {
  BACKEND_READY,
  GATEWAY_URL,
  TENANT_A,
  TENANT_B,
  apiHeaders,
  expectNotInPage,
  getAllPages,
  getRows,
  hydratedForm,
  newTag,
  openAs,
  postCreated,
  utcDate,
  type Persona,
  type Row,
} from './hostel-screens';

/** E2E-AY, the rolling academic year in tools/e2e/seed-e2e-tenants.sql (SP-R2). */
export const PERIOD_A = '00000000-0000-4000-8000-00000000ac01';
/** Seeded area and the static institution type/sector/ownership ids (lib/institutions/lookups.ts). */
const AREA_A = '00000000-0000-4000-8000-00000000a0ea';
const TYPE_ID = '00000000-0000-4000-8000-000000000010';
const SECTOR_ID = '00000000-0000-4000-8000-000000000020';
const OWNERSHIP_ID = '00000000-0000-4000-8000-000000000030';
/** Seeded class in tenant A, used for teacher staff assignments (as fixtures/student-portal-self.ts). */
const SEEDED_CLASS_A = '00000000-0000-4000-8000-0000000005c1';

/** Fixed board + default grading scale this module seeds in tenant A (no API exists). */
export const BOARD_A = '00000000-0000-4000-8000-0000000a5b01';
export const SCALE_A = '00000000-0000-4000-8000-0000000a5b02';
/** Bands of SCALE_A; grade points drive the GPA / CGPA expectations (evidence/expected-values.md). */
export const SCALE_A_BANDS = [
  { id: '00000000-0000-4000-8000-0000000a5b11', label: 'A', min: 90, max: 100, points: 10 },
  { id: '00000000-0000-4000-8000-0000000a5b12', label: 'B', min: 80, max: 89.99, points: 8 },
  { id: '00000000-0000-4000-8000-0000000a5b13', label: 'C', min: 0, max: 79.99, points: 6 },
] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 14-digit sort key that decreases every millisecond (copy of transport-screens `rank()`).
 * A name that starts with it sorts before every earlier `rank()` name and before every
 * name that starts with a letter.
 */
export function rank(): string {
  return `0${String(9_999_999_999_999 - Date.now()).padStart(13, '0')}`;
}

// ─── Personas ────────────────────────────────────────────────────────────────

function persona(
  sub: string,
  tenantId: string,
  roleId: string,
  roleName: string,
  displayName: string,
): Persona {
  return {
    sub,
    email: `${sub}@tenant.test`,
    displayName,
    tenantId,
    roles: [{ roleId, roleName, areaId: null }],
  };
}

/** Tenant administrator. `sub` is a UUID: report-card jobs store it in a UUID column. */
export const asAdmin = (tenantId: string = TENANT_A, sub: string = randomUUID()) =>
  persona(sub, tenantId, 'admin', 'Administrator', 'AS Administrator');
export const asTeacher = (sub: string = randomUUID()) =>
  persona(sub, TENANT_A, 'teacher', 'Teacher', 'AS Teacher');
export const asStaff = (sub: string) => persona(sub, TENANT_A, 'staff', 'Staff', 'AS Staff');
export const asParent = (sub: string) => persona(sub, TENANT_A, 'parent', 'Parent', 'AS Parent');
/** Student principal bound by `students.id = sub`. */
export const asStudent = (studentId: string) =>
  persona(studentId, TENANT_A, 'student', 'Student', 'AS Student');

// ─── Gateway helpers ─────────────────────────────────────────────────────────

export interface Probe {
  method: string;
  path: string;
  status: number;
  body: string;
}

export async function probe(
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
  return { method, path, status: res.status(), body: await res.text() };
}

/** Send and assert the status; returns the JSON body. */
export async function send(
  request: APIRequestContext,
  p: Persona,
  method: 'POST' | 'PUT',
  path: string,
  data: Row,
  expected: number,
): Promise<Row> {
  const r = await probe(request, p, method, path, data);
  expect(r.status, `${method} ${path}: ${r.body.slice(0, 400)}`).toBe(expected);
  return JSON.parse(r.body) as Row;
}

/** GET that must return 200; returns the parsed JSON body. */
export async function getJson(request: APIRequestContext, p: Persona, path: string): Promise<Row> {
  const r = await probe(request, p, 'GET', path);
  expect(r.status, `GET ${path}: ${r.body.slice(0, 400)}`).toBe(200);
  return JSON.parse(r.body) as Row;
}

// ─── SQL (no API exists) ─────────────────────────────────────────────────────

function databaseUrl(): string {
  const url = process.env.DATABASE_URL ?? process.env.MIGRATOR_DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL or MIGRATOR_DATABASE_URL is required for SQL setup');
  return url;
}

function psql(sql: string, vars: Record<string, string>): string[] {
  for (const [name, value] of Object.entries(vars)) {
    if (!/^[A-Za-z0-9 .:_-]{1,80}$/.test(value)) throw new Error(`Unexpected ${name}: ${value}`);
  }
  const args = [databaseUrl(), '-v', 'ON_ERROR_STOP=1', '-qAt'];
  for (const [name, value] of Object.entries(vars)) args.push('-v', `${name}=${value}`);
  const out = execFileSync('psql', args, { input: sql, encoding: 'utf8', stdio: 'pipe' });
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

const BOARD_SQL = `
BEGIN;
SELECT set_config('app.tenant_id', :'tenant', true);
INSERT INTO boards (id, tenant_id, name, code, type, status)
VALUES (:'board'::uuid, :'tenant'::uuid, 'AS E2E Board', 'AS-E2E-BOARD', 'NATIONAL', 'active')
ON CONFLICT (id) DO UPDATE SET status = 'active', deleted_at = NULL;
INSERT INTO grading_scales (id, tenant_id, board_id, code, name, scale_type, is_default)
VALUES (:'scale'::uuid, :'tenant'::uuid, :'board'::uuid, '000-AS-E2E', 'AS E2E scale',
        'PERCENT_BAND', TRUE)
ON CONFLICT (id) DO UPDATE SET is_default = TRUE, deleted_at = NULL;
INSERT INTO grading_scale_bands
  (id, tenant_id, grading_scale_id, label, min_percent, max_percent, grade_points, sort_order)
VALUES
  (:'band1'::uuid, :'tenant'::uuid, :'scale'::uuid, :'label1', :'min1'::numeric, :'max1'::numeric, :'gp1'::numeric, 1),
  (:'band2'::uuid, :'tenant'::uuid, :'scale'::uuid, :'label2', :'min2'::numeric, :'max2'::numeric, :'gp2'::numeric, 2),
  (:'band3'::uuid, :'tenant'::uuid, :'scale'::uuid, :'label3', :'min3'::numeric, :'max3'::numeric, :'gp3'::numeric, 3)
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, min_percent = EXCLUDED.min_percent,
  max_percent = EXCLUDED.max_percent, grade_points = EXCLUDED.grade_points,
  sort_order = EXCLUDED.sort_order;
SELECT 'board:' || id FROM boards WHERE id = :'board'::uuid;
COMMIT;
`;

/** Idempotent: one board, one default scale and three bands in tenant A (fixed ids). */
export function ensureGradingBoard(): void {
  const vars: Record<string, string> = { tenant: TENANT_A, board: BOARD_A, scale: SCALE_A };
  SCALE_A_BANDS.forEach((b, i) => {
    vars[`band${i + 1}`] = b.id;
    vars[`label${i + 1}`] = b.label;
    vars[`min${i + 1}`] = String(b.min);
    vars[`max${i + 1}`] = String(b.max);
    vars[`gp${i + 1}`] = String(b.points);
  });
  const lines = psql(BOARD_SQL, vars);
  if (!lines.includes(`board:${BOARD_A}`)) throw new Error(`Board seed failed: ${lines.join('|')}`);
}

const LINK_STAFF_SQL = `
BEGIN;
SELECT set_config('app.tenant_id', :'tenant', true);
UPDATE staff SET user_id = :'sub'::uuid
 WHERE id = :'staff'::uuid AND tenant_id = :'tenant'::uuid
RETURNING 'linked:' || id;
COMMIT;
`;

function linkStaffUser(staffId: string, sub: string): void {
  if (!UUID_RE.test(staffId) || !UUID_RE.test(sub)) throw new Error('Unexpected staff/user id');
  const lines = psql(LINK_STAFF_SQL, { tenant: TENANT_A, staff: staffId, sub });
  if (!lines.includes(`linked:${staffId}`))
    throw new Error(`Staff link failed: ${lines.join('|')}`);
}

// ─── Seed builders ───────────────────────────────────────────────────────────

export interface SeededStudent {
  id: string;
  firstName: string;
  lastName: string;
  /** `First Last`; every label the screens render contains it. */
  name: string;
  dateOfBirth: string;
  nationalId: string | null;
  guardianPhone: string | null;
}

/**
 * `POST /students`: first name `AS<tag>`, last name `<rank()> <role>`, so the student sorts
 * first in every last-name-ordered picker. `pii` adds a national id and a guardian phone
 * (obviously fake) for the PII checks.
 */
export async function createStudent(
  request: APIRequestContext,
  admin: Persona,
  tag: string,
  role: string,
  n: number,
  pii = false,
): Promise<SeededStudent> {
  const firstName = `AS${tag}`;
  const lastName = `${rank()} ${role}`;
  const dateOfBirth = utcDate(-(12 * 365 + n));
  const nationalId = pii ? `AS${tag}NID${n}` : null;
  const guardianPhone = pii ? `+00-${tag}-${n}` : null;
  const body: Row = { firstName, lastName, dateOfBirth, gender: 'female' };
  if (pii) {
    body.nationalId = nationalId;
    body.guardians = [
      {
        firstName: 'AS',
        lastName: `${tag} Guardian${n}`,
        relationship: 'guardian',
        contactPhone: guardianPhone,
      },
    ];
  }
  const created = await postCreated(request, admin, '/students', body);
  return {
    id: created.id,
    firstName,
    lastName,
    name: `${firstName} ${lastName}`,
    dateOfBirth,
    nationalId,
    guardianPhone,
  };
}

export async function createSubject(
  request: APIRequestContext,
  admin: Persona,
  code: string,
  name: string,
): Promise<{ id: string; code: string; name: string }> {
  const s = await postCreated(request, admin, '/subjects', { code, name });
  return { id: s.id, code, name };
}

/** Per-run institution `<rank()> AS <tag> School` (sorts first in the S4 picker). */
export async function createInstitution(
  request: APIRequestContext,
  admin: Persona,
  tag: string,
): Promise<{ id: string; name: string }> {
  const name = `${rank()} AS ${tag} School`;
  const inst = await postCreated(request, admin, '/institutions', {
    name,
    code: `AS${tag}`,
    areaId: AREA_A,
    typeId: TYPE_ID,
    sectorId: SECTOR_ID,
    ownershipId: OWNERSHIP_ID,
  });
  return { id: inst.id, name };
}

export interface SeededTeacher {
  persona: Persona;
  staffId: string;
}

/**
 * A teacher staff row linked to a per-run user id (`staff.user_id`) with an active staff
 * assignment at `institutionId` (both needed for PRC-H066 grade writes).
 */
export async function createTeacher(
  request: APIRequestContext,
  admin: Persona,
  tag: string,
  label: string,
  institutionId: string,
  subjectId: string,
): Promise<SeededTeacher> {
  const staff = await postCreated(request, admin, '/staff', {
    firstName: 'AS',
    lastName: `${tag} ${label}`,
    dateOfBirth: utcDate(-35 * 365),
    identityNumber: `AS-${tag}-${label}`,
    contactPhone: `+00-${tag}`,
    contactEmail: `as-${tag.toLowerCase()}-${label.toLowerCase()}@tenant-a.test`,
    position: 'Teacher',
  });
  await postCreated(request, admin, '/staff/assignments', {
    staffId: staff.id,
    institutionId,
    subjectId,
    classId: SEEDED_CLASS_A,
    role: 'Teacher',
    allocationPercentage: 100,
    startDate: utcDate(-1),
  });
  const sub = randomUUID();
  linkStaffUser(staff.id, sub);
  return { persona: asTeacher(sub), staffId: staff.id };
}

export interface SeededSection {
  id: string;
  code: string;
  name: string;
}

export async function createSection(
  request: APIRequestContext,
  admin: Persona,
  tag: string,
  institutionId: string,
  primaryTeacherId: string,
  studentIds: string[],
): Promise<SeededSection> {
  const code = `${rank()}AS${tag}`;
  const name = `AS ${tag} Section`;
  const section = await postCreated(request, admin, '/timetable/sections', {
    institutionId,
    academicPeriodId: PERIOD_A,
    name,
    code,
    primaryTeacherId,
    capacity: 50,
  });
  for (const studentId of studentIds) {
    await postCreated(request, admin, `/timetable/sections/${section.id}/enrollments`, {
      studentId,
    });
  }
  return { id: section.id, code, name };
}

export interface SchemeBand {
  grade: string;
  minScore: number;
  maxScore: number;
}

export const READ_BANDS: SchemeBand[] = [
  { grade: 'A', minScore: 90, maxScore: 100 },
  { grade: 'B', minScore: 75, maxScore: 89.99 },
  { grade: 'C', minScore: 0, maxScore: 74.99 },
];

export async function createScheme(
  request: APIRequestContext,
  admin: Persona,
  name: string,
  thresholds: SchemeBand[] = READ_BANDS,
): Promise<{ id: string; name: string }> {
  const s = await postCreated(request, admin, '/grading-schemes', {
    name,
    type: 'numeric',
    minValue: 0,
    maxValue: 100,
    thresholds,
  });
  return { id: s.id, name };
}

export interface SeededItem {
  id: string;
  name: string;
  weight: number;
  minScore: number;
  maxScore: number;
}

/** Midterm (weight 40, 0–50) and Final (weight 60, 0–100) for `subjectId` in the period. */
export async function defineItems(
  request: APIRequestContext,
  admin: Persona,
  tag: string,
  subjectId: string,
  gradingSchemeId: string,
  academicPeriodId: string = PERIOD_A,
): Promise<{ midterm: SeededItem; final: SeededItem }> {
  const want = [
    { name: `AS ${tag} Midterm`, weight: 40, minScore: 0, maxScore: 50 },
    { name: `AS ${tag} Final`, weight: 60, minScore: 0, maxScore: 100 },
  ];
  const res = await send(
    request,
    admin,
    'POST',
    '/assessment-items',
    { subjectId, academicPeriodId, gradingSchemeId, items: want },
    201,
  );
  const items = res.items as Array<SeededItem>;
  const byName = (n: string) => {
    const it = items.find((i) => i.name === n);
    if (!it) throw new Error(`item ${n} missing`);
    return it;
  };
  return { midterm: byName(want[0]!.name), final: byName(want[1]!.name) };
}

export async function enterResults(
  request: APIRequestContext,
  admin: Persona,
  subjectId: string,
  results: Array<{ studentId: string; assessmentItemId: string; score: number }>,
): Promise<void> {
  const res = await send(
    request,
    admin,
    'POST',
    '/results/bulk',
    { subjectId, academicPeriodId: PERIOD_A, results },
    200,
  );
  expect(res.successCount, JSON.stringify(res)).toBe(results.length);
}

/** `GET /results/grades` for one student: the computed weighted average and grade. */
export async function studentGrade(
  request: APIRequestContext,
  p: Persona,
  subjectId: string,
  studentId: string,
): Promise<Row> {
  const body = await getJson(
    request,
    p,
    `/results/grades?subjectId=${subjectId}&academicPeriodId=${PERIOD_A}&studentId=${studentId}`,
  );
  const rows = body.data as Row[];
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

export async function putEntry(
  request: APIRequestContext,
  p: Persona,
  input: {
    sectionId: string;
    studentId: string;
    assessmentCode: string;
    numericScore: number;
    remark?: string;
  },
): Promise<{ id: string }> {
  const row = await send(request, p, 'PUT', '/gradebook/entries', input as unknown as Row, 200);
  return { id: String(row.id) };
}

/** Submit → approve → lock → publish as `p` (an institution-wide moderator). */
export async function publishEntry(
  request: APIRequestContext,
  p: Persona,
  entryId: string,
): Promise<void> {
  for (const action of ['submit', 'approve', 'lock', 'publish']) {
    await send(request, p, 'POST', `/gradebook/entries/${entryId}/transition`, { action }, 200);
  }
}

/** The report-card jobs for `studentId` (whole tenant list, newest first). */
export async function reportCardJobsFor(
  request: APIRequestContext,
  p: Persona,
  studentId: string,
): Promise<Row[]> {
  const rows = await getRows(request, p, '/gradebook/report-cards');
  return rows.filter((job) => (job.metadata as Row | undefined)?.studentId === studentId);
}

/** Staff-created active guardian link (parent identity = JWT sub), as spec 73. */
export async function linkParent(
  request: APIRequestContext,
  parentSub: string,
  studentId: string,
): Promise<void> {
  const linker: Persona = {
    sub: parentSub,
    email: `${parentSub}@tenant.test`,
    displayName: 'AS Parent',
    tenantId: TENANT_A,
    roles: [
      { roleId: 'parent', roleName: 'Parent', areaId: null },
      { roleId: 'admin', roleName: 'Administrator', areaId: null },
    ],
  };
  await send(
    request,
    linker,
    'POST',
    '/parent-portal/children/links',
    { studentId, relationship: 'guardian' },
    201,
  );
}

// ─── The read data set (specs 112, 114) ──────────────────────────────────────

export interface SeededReadSet {
  tag: string;
  admin: Persona;
  institution: { id: string; name: string };
  subject: { id: string; code: string; name: string };
  scheme: { id: string; name: string };
  items: { midterm: SeededItem; final: SeededItem };
  outcome: { id: string; code: string; name: string };
  l1: SeededStudent;
  l2: SeededStudent;
  teacher: SeededTeacher;
  section: SeededSection;
  /** L1 `AS<tag>-MATH` 88 published. */
  l1Math: { id: string; code: string };
  /** L2 `AS<tag>-MATH` 72 draft (114: published). */
  l2Math: { id: string; code: string };
  /** 114 only: L1 `AS<tag>-DRAFT` 50 draft. */
  l1Draft: { id: string; code: string } | null;
  remark: string;
  job: { id: string; createdAt: string };
  /** Every seeded string a role without access must never receive. */
  strings: string[];
}

/**
 * The read-path data set: scheme, items, outcome, results, a section with two students,
 * gradebook entries, class rank and one report-card job for L1.
 * `privacy` (spec 114) adds national ids and guardian phones, publishes L2's entry and
 * adds a draft entry for L1, so self-scope can prove drafts and other students are hidden.
 */
export async function seedReadSet(
  request: APIRequestContext,
  tag: string,
  privacy = false,
): Promise<SeededReadSet> {
  ensureGradingBoard();
  const admin = asAdmin();
  const institution = await createInstitution(request, admin, tag);
  const subject = await createSubject(request, admin, `AS${tag}M`, `AS ${tag} Maths`);
  const scheme = await createScheme(request, admin, `${rank()} AS ${tag} Read Scheme`);
  const items = await defineItems(request, admin, tag, subject.id, scheme.id);
  const outcome = { code: `AS${tag}O1`, name: `AS ${tag} Fractions` };
  const createdOutcome = await postCreated(request, admin, '/outcomes', {
    subjectId: subject.id,
    ...outcome,
  });
  const l1 = await createStudent(request, admin, tag, 'Learner', 1, privacy);
  const l2 = await createStudent(request, admin, tag, 'Peer', 2, privacy);
  await enterResults(request, admin, subject.id, [
    { studentId: l1.id, assessmentItemId: items.midterm.id, score: 45 },
    { studentId: l1.id, assessmentItemId: items.final.id, score: 80 },
    { studentId: l2.id, assessmentItemId: items.midterm.id, score: 20 },
  ]);
  const teacher = await createTeacher(request, admin, tag, 'Teacher', institution.id, subject.id);
  const section = await createSection(request, admin, tag, institution.id, teacher.staffId, [
    l1.id,
    l2.id,
  ]);
  const remark = `AS ${tag} remark`;
  const mathCode = `AS${tag}-MATH`;
  const l1Math = await putEntry(request, admin, {
    sectionId: section.id,
    studentId: l1.id,
    assessmentCode: mathCode,
    numericScore: 88,
    remark,
  });
  await publishEntry(request, admin, l1Math.id);
  const l2Math = await putEntry(request, admin, {
    sectionId: section.id,
    studentId: l2.id,
    assessmentCode: mathCode,
    numericScore: 72,
  });
  let l1Draft: { id: string; code: string } | null = null;
  if (privacy) {
    await publishEntry(request, admin, l2Math.id);
    const draftCode = `AS${tag}-DRAFT`;
    const draft = await putEntry(request, admin, {
      sectionId: section.id,
      studentId: l1.id,
      assessmentCode: draftCode,
      numericScore: 50,
    });
    l1Draft = { id: draft.id, code: draftCode };
  } else {
    await send(
      request,
      admin,
      'POST',
      '/gradebook/rank/compute',
      { sectionId: section.id, academicPeriodId: PERIOD_A, boardId: BOARD_A },
      201,
    );
  }
  const job = await send(
    request,
    admin,
    'POST',
    '/gradebook/report-cards',
    { studentId: l1.id, boardId: BOARD_A, institutionId: institution.id },
    201,
  );
  expect(job.status, JSON.stringify(job)).toBe('SUCCEEDED');
  const strings = [
    scheme.name,
    items.midterm.name,
    items.final.name,
    outcome.code,
    outcome.name,
    l1.lastName,
    l2.lastName,
    mathCode,
    remark,
    section.name,
    ...(l1Draft ? [l1Draft.code] : []),
    ...[l1.nationalId, l2.nationalId].filter((v): v is string => v !== null),
  ];
  return {
    tag,
    admin,
    institution,
    subject,
    scheme,
    items,
    outcome: { id: createdOutcome.id, ...outcome },
    l1,
    l2,
    teacher,
    section,
    l1Math: { id: l1Math.id, code: mathCode },
    l2Math: { id: l2Math.id, code: mathCode },
    l1Draft,
    remark,
    job: { id: String(job.id), createdAt: String(job.createdAt) },
    strings,
  };
}

// ─── Screens ─────────────────────────────────────────────────────────────────

/** The nine M4 screens for a data set (dynamic segments filled in). */
export function screenUrls(d: SeededReadSet): Array<{ screen: string; url: string }> {
  const pair = `subjectId=${d.subject.id}&academicPeriodId=${PERIOD_A}`;
  return [
    { screen: 'S1 /assessments', url: `/assessments?search=${d.tag}` },
    { screen: 'S2 /assessments/items', url: `/assessments/items?${pair}` },
    { screen: 'S3 /assessments/outcomes', url: `/assessments/outcomes?subjectId=${d.subject.id}` },
    {
      screen: 'S4 /assessments/report-cards',
      url: `/assessments/report-cards?institutionId=${d.institution.id}`,
    },
    { screen: 'S5 /assessments/results', url: `/assessments/results?${pair}` },
    {
      screen: 'S6 /assessments/schemes/[id]/edit',
      url: `/assessments/schemes/${d.scheme.id}/edit`,
    },
    { screen: 'S7 /assessments/schemes/new', url: '/assessments/schemes/new' },
    {
      screen: 'S8 /institutions/[id]/gradebook',
      url: `/institutions/${d.institution.id}/gradebook?sectionId=${d.section.id}`,
    },
    {
      screen: 'S9 /institutions/[id]/gradebook/report-cards/[jobId]',
      url: `/institutions/${d.institution.id}/gradebook/report-cards/${d.job.id}`,
    },
  ];
}

/** Navigate and let the streamed server render finish (named `goto` for the page matrix). */
export async function goto(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toBeVisible();
  // Server components stream; let the response finish before reading the HTML.
  await page.waitForLoadState('load');
}

/** True once React attached its props to `locator` (forms without `data-hydrated`). */
export async function waitForReact(locator: Locator): Promise<void> {
  await expect
    .poll(
      () =>
        locator.evaluate((el) => Object.keys(el).some((key) => key.startsWith('__reactProps$'))),
      { message: 'React props attached', timeout: 30_000 },
    )
    .toBe(true);
}

/** Run `trigger` and wait for the server-action POST it fires to return 200. */
export async function serverAction(page: Page, trigger: () => Promise<void>): Promise<void> {
  const path = new URL(page.url()).pathname;
  const response = page.waitForResponse(
    async (res) =>
      res.request().method() === 'POST' &&
      new URL(res.url()).pathname === path &&
      (await res.request().headerValue('next-action')) !== null,
    { timeout: 60_000 },
  );
  await trigger();
  const res = await response;
  expect(res.status(), `server action POST ${path}`).toBe(200);
}

/** RSC refreshes can replace a node between actionability checks; click in-page. */
export async function clickDom(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  await locator.evaluate((el) => {
    (el as HTMLElement).click();
  });
}

/** Choose `studentId` in an EntitySearchSelect by filtering on the student's unique name. */
export async function pickStudent(
  scope: Locator,
  selectId: string,
  student: SeededStudent,
): Promise<void> {
  const search = scope.locator(`#${selectId}-search`);
  await waitForReact(search);
  await search.fill(student.lastName);
  const select = scope.locator(`#${selectId}`);
  await expect(select.locator(`option[value="${student.id}"]`)).toHaveCount(1);
  await select.selectOption(student.id);
  await expect(select).toHaveValue(student.id);
}

/** Radix Select: open the trigger and click the option whose text starts with `text`. */
export async function chooseRadixOption(page: Page, triggerId: string, text: string) {
  await page.locator(`#${triggerId}`).click();
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await page.getByRole('option', { name: new RegExp(`^${escaped}`) }).click();
  await expect(page.locator(`#${triggerId}`)).toContainText(text);
}

export const PERMISSION_DENIED_COPY =
  'You do not have permission to make this change. Contact your administrator if you need access.';
