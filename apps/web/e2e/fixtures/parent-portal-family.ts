/**
 * Parent portal screen coverage — per-run guardian families (specs 57–59).
 *
 * Each test creates its own children through `POST /students` (unique names) and
 * then provisions the guardian identity rows by psql, because no HTTP route
 * writes households or custody and `POST /parent-portal/children/links` only
 * links the caller's own JWT subject. Guardian access fails closed without a
 * household + member + active custody + active link
 * (parent-portal-service.ts `hasHouseholdCustodyAccess`), so all four rows are
 * written in one transaction. Fresh children mean every per-child read starts
 * empty on every run, so re-runs against the same database never see leftover
 * rows (UAT-ENV-012). Precedent for test-only psql setup: helpers/library-loans.ts.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { expect, type APIRequestContext, type Page } from '@playwright/test';

import { createSignedJwt, setupGatewayTenantSession } from './fake-session';
import { parentPortalJwtHeaders } from './parent-portal-auth';
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
const SUB_RE = /^[a-z0-9-]{1,64}$/;
const TAG_RE = /^[A-Z0-9]{1,16}$/;

export function adminHeaders(tenantId: string = TENANT_A): Record<string, string> {
  const token = createSignedJwt({
    sub: 'e2e-admin',
    email: 'admin@tenant-a.test',
    displayName: 'E2E Admin',
    tenantId,
    roles: [{ roleId: 'admin', roleName: 'SUPER_ADMIN', areaId: null }],
    institutions: [],
  });
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Tenant-ID': tenantId,
  };
}

export function guardianHeaders(sub: string, tenantId: string = TENANT_A): Record<string, string> {
  return parentPortalJwtHeaders(sub, { tenantId });
}

/** Student principal bound by `students.id = sub` (as in e2e/26). */
export function studentHeaders(
  studentId: string,
  tenantId: string = TENANT_A,
): Record<string, string> {
  const token = createSignedJwt({
    sub: studentId,
    email: `${studentId}@tenant.test`,
    displayName: studentId,
    tenantId,
    roles: [{ roleId: 'student', roleName: 'student', areaId: null }],
    institutions: [INSTITUTION_A],
  });
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Tenant-ID': tenantId,
  };
}

/** 8 upper-case hex characters, unique per call. */
export function newTag(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
}

export interface Child {
  id: string;
  firstName: string;
  lastName: string;
  /** `First Last` as the parent screens label a child. */
  label: string;
}

export interface Family {
  tenantId: string;
  guardianSub: string;
  guardianEmail: string;
  householdId: string;
  children: Child[];
}

function databaseUrl(): string {
  const url = process.env.DATABASE_URL ?? process.env.MIGRATOR_DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL or MIGRATOR_DATABASE_URL is required for family setup');
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

const PROVISION_SQL = `
BEGIN;
SELECT 'tenant:' || set_config('app.tenant_id', :'tenant', true);
INSERT INTO guardian_households (id, tenant_id, label, status)
VALUES (:'household'::uuid, :'tenant'::uuid, :'label', 'active')
RETURNING 'household:' || id;
INSERT INTO guardian_household_members (id, tenant_id, household_id, parent_user_id, role, status)
VALUES (gen_random_uuid(), :'tenant'::uuid, :'household'::uuid, :'sub', 'primary', 'active')
RETURNING 'member:' || parent_user_id;
INSERT INTO guardian_student_custody
  (id, tenant_id, student_id, household_id, custody_type, status, effective_from)
SELECT gen_random_uuid(), :'tenant'::uuid, s::uuid, :'household'::uuid, 'sole', 'active',
       now() - interval '1 day'
  FROM unnest(string_to_array(:'students', ',')) AS s
RETURNING 'custody:' || student_id;
INSERT INTO parent_child_links
  (id, tenant_id, parent_user_id, student_id, relationship, status,
   is_primary, can_consent_medical, can_view_fees, household_id)
SELECT gen_random_uuid(), :'tenant'::uuid, :'sub', s::uuid, 'guardian', 'active',
       true, true, true, :'household'::uuid
  FROM unnest(string_to_array(:'students', ',')) AS s
RETURNING 'link:' || student_id;
COMMIT;
`;

/** Household, primary member, sole active custody and an active link per student, in one transaction. */
export function provisionGuardianLinks(input: {
  tenantId: string;
  guardianSub: string;
  householdId: string;
  studentIds: string[];
}): void {
  assertUuid(input.tenantId, 'tenant id');
  assertUuid(input.householdId, 'household id');
  if (!SUB_RE.test(input.guardianSub)) throw new Error(`Unexpected sub: ${input.guardianSub}`);
  if (input.studentIds.length === 0) throw new Error('At least one student id is required');
  for (const id of input.studentIds) assertUuid(id, 'student id');
  const lines = psql(PROVISION_SQL, {
    tenant: input.tenantId,
    household: input.householdId,
    label: `PP household ${input.guardianSub}`,
    sub: input.guardianSub,
    students: input.studentIds.join(','),
  });
  const expected = [
    `household:${input.householdId}`,
    `member:${input.guardianSub}`,
    ...input.studentIds.flatMap((id) => [`custody:${id}`, `link:${id}`]),
  ];
  for (const line of expected) {
    if (!lines.includes(line)) {
      throw new Error(`Guardian provisioning missing ${line}: ${lines.join(' | ')}`);
    }
  }
}

/** Create `childCount` students through the API, then link them to one guardian. */
export async function createFamily(
  request: APIRequestContext,
  options: { tenantId?: string; childCount: number; guardianSub?: string; tag: string },
): Promise<Family> {
  const tenantId = options.tenantId ?? TENANT_A;
  if (!TAG_RE.test(options.tag)) throw new Error(`Unexpected tag: ${options.tag}`);
  const guardianSub = options.guardianSub ?? `pp-g-${options.tag.toLowerCase()}`;
  const children: Child[] = [];
  for (let n = 1; n <= options.childCount; n += 1) {
    const firstName = `PP${options.tag}`;
    const lastName = `Child${n}`;
    const res = await request.post(`${GATEWAY_URL}/api/v1/students`, {
      headers: adminHeaders(tenantId),
      data: {
        firstName,
        lastName,
        dateOfBirth: `2014-05-${String(n).padStart(2, '0')}`,
        gender: 'female',
      },
    });
    expect(res.status(), `POST /students: ${await res.text()}`).toBe(201);
    const id = (await res.json()).id as string;
    children.push({ id, firstName, lastName, label: `${firstName} ${lastName}` });
  }
  const householdId = randomUUID();
  provisionGuardianLinks({
    tenantId,
    guardianSub,
    householdId,
    studentIds: children.map((child) => child.id),
  });
  return {
    tenantId,
    guardianSub,
    guardianEmail: `${guardianSub}@tenant.test`,
    householdId,
    children,
  };
}

async function adminPost(request: APIRequestContext, path: string, data: unknown): Promise<string> {
  const res = await request.post(`${GATEWAY_URL}/api/v1${path}`, { headers: adminHeaders(), data });
  expect(res.status(), `POST ${path}: ${await res.text()}`).toBe(201);
  return (await res.json()).id as string;
}

/**
 * Per-run grade + class in the shared tenant-A year, with the given children
 * enrolled (`POST /enrollments`, so each child has a current institution).
 */
export async function enrolInSharedYear(
  request: APIRequestContext,
  tag: string,
  studentIds: string[],
): Promise<{ periodId: string; classId: string }> {
  if (!TAG_RE.test(tag)) throw new Error(`Unexpected tag: ${tag}`);
  const period = await ensureSharedAcademicYear(request, GATEWAY_URL, adminHeaders());
  const gradeId = await adminPost(request, '/grades', {
    name: `PP Grade ${tag}`,
    code: `P${tag.slice(0, 6)}`,
    order: uniqueGradeOrder(),
  });
  const classId = await adminPost(request, '/classes', {
    institutionId: INSTITUTION_A,
    gradeId,
    academicPeriodId: period.id,
    name: `PP Class ${tag}`,
    capacity: 30,
  });
  for (const studentId of studentIds) {
    await adminPost(request, '/enrollments', {
      studentId,
      institutionId: INSTITUTION_A,
      gradeId,
      classId,
      academicPeriodId: period.id,
      enrolledAt: new Date().toISOString().slice(0, 10),
    });
  }
  return { periodId: period.id, classId };
}

/** Enrol in SECTION_A (tenant A) and publish one grade (as e2e/42); returns the entry id. */
export async function publishGrade(
  request: APIRequestContext,
  studentId: string,
  assessmentCode: string,
): Promise<string> {
  assertUuid(studentId, 'student id');
  await adminPost(request, `/timetable/sections/${SECTION_A}/enrollments`, { studentId });
  const res = await request.put(`${GATEWAY_URL}/api/v1/gradebook/entries`, {
    headers: adminHeaders(),
    data: { sectionId: SECTION_A, studentId, assessmentCode, numericScore: 88 },
  });
  expect(res.status(), `PUT /gradebook/entries: ${await res.text()}`).toBe(200);
  const entryId = (await res.json()).id as string;
  for (const action of ['submit', 'approve', 'lock', 'publish']) {
    const step = await request.post(
      `${GATEWAY_URL}/api/v1/gradebook/entries/${entryId}/transition`,
      { headers: adminHeaders(), data: { action } },
    );
    expect(step.status(), `transition ${action}: ${await step.text()}`).toBe(200);
  }
  return entryId;
}

export async function openAsGuardian(page: Page, family: Family): Promise<void> {
  await setupGatewayTenantSession(page, {
    sub: family.guardianSub,
    email: family.guardianEmail,
    displayName: `PP Guardian ${family.guardianSub}`,
    tenantId: family.tenantId,
    roles: [{ roleId: 'parent', roleName: 'Parent', areaId: null }],
  });
}

/** Minimal valid PDF (same bytes as e2e/56). */
export function pdfBuffer(): Buffer {
  return Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  );
}
