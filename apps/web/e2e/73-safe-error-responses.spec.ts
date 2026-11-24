/**
 * PR-4 safe error responses — live gateway + Postgres (nightly).
 *
 * H-D4a: a write whose `studentId` references no student must answer a safe 4xx with no SQL or
 * constraint text (e2e runs the gateway in development mode, where raw text used to pass
 * through). Non-hostel FK writes keep the #739 form: 422 REFERENCE_NOT_FOUND with a fixed
 * message and a correlation id. Hostel writes map a missing parent (id-only or tenant-composite
 * FK) to 404 NOT_FOUND (#736, H-D3), the same for a random id and another tenant's id.
 * P-O1: a parent applying for a linked child who has no enrolment gets the actionable
 * enrolment message on screen, not "Validation failed".
 *
 * Every test creates its own rows (unique tag), so re-runs against the same database stay
 * deterministic. SQL is used only where no API exists: the guardian household membership and
 * custody rows that parent-portal access requires (W1-SEC-03). Values are psql variables
 * (`:'name'`), never spliced into SQL (same pattern as fixtures/student-portal-self.ts).
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { createSignedJwt, setupGatewayTenantSession } from './fixtures/fake-session';
const TENANT_A = '00000000-0000-4000-8000-000000000001';
/** Seeded guardian household (tools/e2e/seed-e2e-tenants.sql). */
const HOUSEHOLD_A = '00000000-0000-4000-8000-00000000a101';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GATEWAY =
  process.env.E2E_GATEWAY_URL ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:3000';
const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
const DB_TEXT = /constraint|foreign key|_fkey|violates|relation "|column "|SQLSTATE/i;
const HOSTEL_FK_TEXT = /_tenant_fk|hostel_leaves|student_id/i;
const ENROLMENT_COPY =
  'This child is not enrolled yet. Contact the school to complete enrolment before applying.';
type Role = { roleId: string; roleName: string; areaId: null };
function headers(sub: string, roles: Role[]): Record<string, string> {
  const token = createSignedJwt({
    sub,
    email: `${sub}@tenant-a.test`,
    displayName: sub,
    tenantId: TENANT_A,
    roles,
  });
  return {
    Authorization: `Bearer ${token}`,
    'X-Tenant-ID': TENANT_A,
    'Content-Type': 'application/json',
  };
}
const ADMIN: Role = { roleId: 'admin', roleName: 'SUPER_ADMIN', areaId: null };
const PARENT: Role = { roleId: 'parent', roleName: 'Parent', areaId: null };
function tag(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
}
function utcDay(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
const CUSTODY_SQL = `
BEGIN;
SELECT set_config('app.tenant_id', :'tenant', true);
INSERT INTO guardian_household_members (id, tenant_id, household_id, parent_user_id, role, status)
VALUES (:'member_id'::uuid, :'tenant'::uuid, :'household'::uuid, :'parent', 'guardian', 'active');
INSERT INTO guardian_student_custody
  (id, tenant_id, student_id, household_id, custody_type, status, effective_from)
VALUES (:'custody_id'::uuid, :'tenant'::uuid, :'student'::uuid, :'household'::uuid, 'sole', 'active',
        now() - interval '1 day');
COMMIT;
`;
/** Household membership + custody for a per-run guardian and student (no API exists). */
function grantCustody(parentSub: string, studentId: string): void {
  if (!UUID_RE.test(studentId)) throw new Error(`Unexpected student id: ${studentId}`);
  if (!/^er-parent-[A-F0-9]{8}$/.test(parentSub)) throw new Error(`Unexpected sub: ${parentSub}`);
  const url = process.env.DATABASE_URL ?? process.env.MIGRATOR_DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL or MIGRATOR_DATABASE_URL is required for SQL setup');
  const vars: Record<string, string> = {
    tenant: TENANT_A,
    household: HOUSEHOLD_A,
    parent: parentSub,
    student: studentId,
    member_id: randomUUID(),
    custody_id: randomUUID(),
  };
  const args = [url, '-v', 'ON_ERROR_STOP=1', '-qAt'];
  for (const [name, value] of Object.entries(vars)) args.push('-v', `${name}=${value}`);
  execFileSync('psql', args, { input: CUSTODY_SQL, encoding: 'utf8', stdio: 'pipe' });
}
async function post(
  request: APIRequestContext,
  path: string,
  h: Record<string, string>,
  data: unknown,
): Promise<{ status: number; body: string }> {
  const res = await request.post(`${GATEWAY}/api/v1${path}`, { headers: h, data });
  return { status: res.status(), body: await res.text() };
}
function expectSafeReferenceError(r: { status: number; body: string }, label: string): void {
  expect(r.status, `${label}: ${r.body.slice(0, 300)}`).toBe(422);
  expect(r.body, `${label} body`).not.toMatch(DB_TEXT);
  const json = JSON.parse(r.body) as { code?: string; message?: string; correlationId?: unknown };
  expect(json.code, label).toBe('REFERENCE_NOT_FOUND');
  expect(json.message, label).toBe('A referenced record does not exist.');
  expect(typeof json.correlationId, `${label} correlationId`).toBe('string');
  expect(String(json.correlationId).length, `${label} correlationId`).toBeGreaterThan(0);
}
function expectSafeNotFound(r: { status: number; body: string }, label: string): void {
  expect(r.status, `${label}: ${r.body.slice(0, 300)}`).toBe(404);
  expect(r.body, `${label} body`).not.toMatch(DB_TEXT);
  expect(r.body, `${label} body`).not.toMatch(HOSTEL_FK_TEXT);
  const json = JSON.parse(r.body) as { code?: string };
  expect(json.code, label).toBe('NOT_FOUND');
}
test.describe('Safe error responses — live (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires the live gateway and Postgres');
  test('H-D4a writes with a random studentId get a safe 4xx without database text', async ({
    request,
  }) => {
    const t = tag();
    const admin = headers(`er-admin-${t}`, [ADMIN]);
    const hostel = await post(request, '/hostel', admin, { name: `ER ${t}`, code: `ER${t}` });
    expect(hostel.status, hostel.body).toBe(201);
    const hostelId = (JSON.parse(hostel.body) as { id: string }).id;
    const missingStudent = randomUUID();
    // Hostel write: real hostel, random student. The hostel repository maps the student FK
    // violation to 404 NOT_FOUND (#736, H-D3), not the gateway FK mapper's 422.
    const leave = await post(request, '/hostel/leaves', admin, {
      studentId: missingStudent,
      hostelId,
      startDate: utcDay(2),
      endDate: utcDay(3),
    });
    expectSafeNotFound(leave, 'POST /hostel/leaves');
    // Non-hostel write: a staff-created guardian link to a random student.
    const link = await post(
      request,
      '/parent-portal/children/links',
      headers(`er-guardian-${t}`, [PARENT, ADMIN]),
      { studentId: missingStudent, relationship: 'guardian' },
    );
    expectSafeReferenceError(link, 'POST /parent-portal/children/links');
  });
  test('P-O1 a parent applying for a non-enrolled child sees the enrolment message', async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const t = tag();
    const admin = headers(`er-admin-${t}`, [ADMIN]);
    // A fresh student has no enrolment of record.
    const student = await post(request, '/students', admin, {
      firstName: `ER${t}`,
      lastName: 'Unenrolled',
      dateOfBirth: '2013-05-05',
      gender: 'female',
    });
    expect(student.status, student.body).toBe(201);
    const studentId = (JSON.parse(student.body) as { id: string }).id;
    // A staff-created link is active (PRC-M531); the guardian identity is the JWT sub.
    const parentSub = `er-parent-${t}`;
    const link = await post(
      request,
      '/parent-portal/children/links',
      headers(parentSub, [PARENT, ADMIN]),
      { studentId, relationship: 'guardian', householdId: HOUSEHOLD_A },
    );
    expect(link.status, link.body).toBe(201);
    grantCustody(parentSub, studentId);
    const program = await post(request, '/scholarships/programs', admin, {
      name: `ER enrolment ${t}`,
      applicationStartDate: '2020-01-01',
      applicationEndDate: '2099-12-31',
      totalSlots: 5,
      amountPerRecipient: 10000,
      currency: 'INR',
      eligibility: { requiredDocuments: [] },
    });
    expect(program.status, program.body).toBe(201);
    const programId = (JSON.parse(program.body) as { id: string }).id;
    const opened = await request.put(`${GATEWAY}/api/v1/scholarships/programs/${programId}`, {
      headers: admin,
      data: { status: 'open' },
    });
    expect(opened.status(), await opened.text()).toBe(200);
    // API: 422 ENROLMENT_REQUIRED with the fixed copy.
    const api = await post(
      request,
      '/parent-portal/scholarships/applications',
      headers(parentSub, [PARENT]),
      {
        programId,
        applicantId: studentId,
        academicRecords: [{ institutionName: 'Any school', educationLevel: 'secondary', gpa: 3.1 }],
        financialInfo: { familyIncome: 150000 },
        documents: [],
        asDraft: true,
      },
    );
    expect(api.status, api.body).toBe(422);
    expect(JSON.parse(api.body)).toMatchObject({
      code: 'ENROLMENT_REQUIRED',
      message: ENROLMENT_COPY,
    });
    // Screen: the form shows the same copy and nothing else from the server.
    await setupGatewayTenantSession(page, {
      sub: parentSub,
      email: `${parentSub}@tenant-a.test`,
      displayName: `ER Parent ${t}`,
      tenantId: TENANT_A,
      roles: [PARENT],
    });
    await page.goto('/parent/scholarships', { waitUntil: 'domcontentloaded' });
    const form = page.getByTestId('parent-scholarships');
    await expect(form).toBeVisible();
    await form.getByLabel('Child', { exact: true }).selectOption(studentId);
    await form.getByLabel('Scholarship program').selectOption(programId);
    await form.getByLabel('Current school or institution').fill('Any school');
    await form.getByLabel('GPA', { exact: true }).fill('3.1');
    await form.getByLabel('Declared annual family income').fill('150000');
    await form.getByRole('button', { name: 'Start application' }).click();
    const alert = form.getByRole('alert');
    await expect(alert).toHaveText(ENROLMENT_COPY);
    await expect(alert).not.toContainText('Validation failed');
  });
});
