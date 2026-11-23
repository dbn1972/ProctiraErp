/**
 * Health screen coverage — shared personas, per-run seeding and helpers (specs 63–65).
 *
 * Every test seeds its own students and health rows through the live gateway with a
 * unique tag, so assertions find this run's rows regardless of leftovers on a reused
 * database. Student / staff last names come from `pickerSortKey()` so the newest
 * rows sort first in the 20-row form pickers (`load-health-directory.ts`).
 *
 * Screen persona: a tenant health administrator. `roleId: 'admin'` drives gateway RBAC
 * for the students / staff / institutions lists; `roleName: 'HEALTH_ADMIN'` is what
 * grants health access (web gates + health domain). No SUPER_ADMIN.
 *
 * Strings never look like real PHI: they start with `HL ` / `Hl` and carry the tag.
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

/**
 * Digit-led last name that decreases every millisecond: `0` sorts before letters and
 * other digit-led names, and the newest row sorts first by `lastName` asc.
 */
export function pickerSortKey(): string {
  return '0' + String(9_999_999_999_999 - Date.now()).padStart(13, '0');
}

/** UTC calendar date (the health service rejects dates after UTC today). */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
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

export function healthAdmin(sub: string, tenantId: string = TENANT_A): Persona {
  return persona(
    sub,
    tenantId,
    { roleId: 'admin', roleName: 'HEALTH_ADMIN', areaId: null },
    'HL Health Admin',
  );
}

export function nurse(sub: string, tenantId: string = TENANT_A): Persona {
  return persona(sub, tenantId, { roleId: 'nurse', roleName: 'Nurse', areaId: null }, 'HL Nurse');
}

export function counsellor(sub: string, tenantId: string = TENANT_A): Persona {
  return persona(
    sub,
    tenantId,
    { roleId: 'counsellor', roleName: 'Counsellor', areaId: null },
    'HL Counsellor',
  );
}

export function teacher(sub: string, tenantId: string = TENANT_A): Persona {
  return persona(
    sub,
    tenantId,
    { roleId: 'teacher', roleName: 'Teacher', areaId: null },
    'HL Teacher',
  );
}

export function administrator(sub: string, tenantId: string = TENANT_A): Persona {
  return persona(
    sub,
    tenantId,
    { roleId: 'admin', roleName: 'Administrator', areaId: null },
    'HL Administrator',
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

export interface SeededPerson {
  id: string;
  firstName: string;
  lastName: string;
  /** Directory label the health screens render. */
  label: string;
}

type Body = Record<string, unknown>;

async function postCreated(
  request: APIRequestContext,
  p: Persona,
  path: string,
  data: Body,
): Promise<Body & { id: string }> {
  const res = await request.post(`${GATEWAY_URL}/api/v1${path}`, {
    headers: apiHeaders(p),
    data,
  });
  expect(res.status(), `POST ${path}: ${await res.text()}`).toBe(201);
  return (await res.json()) as Body & { id: string };
}

export async function createStudent(
  request: APIRequestContext,
  p: Persona,
  tag: string,
): Promise<SeededPerson> {
  const firstName = `Hl${tag}`;
  const lastName = pickerSortKey();
  const created = await postCreated(request, p, '/students', {
    firstName,
    lastName,
    dateOfBirth: '2014-05-05',
    gender: 'female',
  });
  return { id: created.id, firstName, lastName, label: `${firstName} ${lastName}` };
}

export async function createCounsellor(
  request: APIRequestContext,
  p: Persona,
  tag: string,
): Promise<SeededPerson> {
  const firstName = `Hc${tag}`;
  const lastName = pickerSortKey();
  const created = await postCreated(request, p, '/staff', {
    firstName,
    lastName,
    dateOfBirth: '1985-03-03',
    identityNumber: `HL-${tag}`,
    contactPhone: '+15550100',
    position: 'Counsellor',
  });
  return {
    id: created.id,
    firstName,
    lastName,
    label: `Counsellor · ${firstName} ${lastName}`,
  };
}

export function seedAllergy(
  request: APIRequestContext,
  p: Persona,
  data: { studentId: string; description: string } & Body,
): Promise<Body & { id: string }> {
  return postCreated(request, p, '/health/allergies', {
    allergyType: 'food',
    severity: 'moderate',
    ...data,
  });
}

export function seedCondition(
  request: APIRequestContext,
  p: Persona,
  data: { studentId: string; conditionName: string } & Body,
): Promise<Body & { id: string }> {
  return postCreated(request, p, '/health/conditions', {
    conditionType: 'chronic',
    status: 'active',
    ...data,
  });
}

export function seedVaccination(
  request: APIRequestContext,
  p: Persona,
  data: { studentId: string; vaccineName: string } & Body,
): Promise<Body & { id: string }> {
  return postCreated(request, p, '/health/vaccinations', {
    doseNumber: 1,
    dateAdministered: todayUtc(),
    ...data,
  });
}

export function seedIncident(
  request: APIRequestContext,
  p: Persona,
  data: { studentId: string; category: string } & Body,
): Promise<Body & { id: string }> {
  return postCreated(request, p, '/health/incidents', {
    incidentAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    severity: 'medium',
    reportedBy: p.sub,
    ...data,
  });
}

export function seedCounselling(
  request: APIRequestContext,
  p: Persona,
  data: { studentId: string; counsellorId: string; reason: string } & Body,
): Promise<Body & { id: string }> {
  return postCreated(request, p, '/health/counselling/sessions', {
    sessionDate: todayUtc(),
    sessionType: 'individual',
    caseNotes: `HL case notes ${data.reason}`,
    followUpRequired: false,
    status: 'scheduled',
    ...data,
  });
}

export function seedDiagnosis(
  request: APIRequestContext,
  p: Persona,
  data: { studentId: string; category: string } & Body,
): Promise<Body & { id: string }> {
  return postCreated(request, p, '/health/special-needs/diagnoses', {
    diagnosisDate: todayUtc(),
    diagnosedBy: 'HL clinician',
    condition: `HL condition ${data.category}`,
    severity: 'moderate',
    ...data,
  });
}

export function seedAccommodationPlan(
  request: APIRequestContext,
  p: Persona,
  data: { studentId: string; accommodations: Array<{ type: string; description: string }> } & Body,
): Promise<Body & { id: string }> {
  return postCreated(request, p, '/health/special-needs/accommodation-plans', {
    planName: 'HL plan',
    startDate: todayUtc(),
    status: 'active',
    ...data,
  });
}

export function seedScreeningProgram(
  request: APIRequestContext,
  p: Persona,
  data: { name: string; gradeLevel: string; assessmentTypes: string[] } & Body,
): Promise<Body & { id: string }> {
  return postCreated(request, p, '/health/screening-programs', {
    academicPeriodId: randomUUID(),
    scheduledDate: todayUtc(),
    status: 'planned',
    ...data,
  });
}

/**
 * Wait until React has attached its props to `locator` (hydrated). Marker-less forms
 * would otherwise submit natively before hydration; fails loudly if React changes.
 */
export async function waitForReact(locator: Locator): Promise<void> {
  await expect
    .poll(
      () =>
        locator.evaluate((el) => Object.keys(el).some((key) => key.startsWith('__reactProps$'))),
      { message: 'React props attached', timeout: 20_000 },
    )
    .toBe(true);
}

/**
 * Hard-delete every dose of `studentId` (a student this run created). The vaccination
 * register shows the first 100 rows by date_administered DESC and rejects future dates,
 * so a test that needs a today-dated dose removes it afterwards to keep today's count flat.
 */
export async function deleteStudentVaccinations(
  request: APIRequestContext,
  p: Persona,
  studentId: string,
): Promise<void> {
  const path = `/health/vaccinations/student/${studentId}`;
  const res = await request.get(`${GATEWAY_URL}/api/v1${path}`, { headers: apiHeaders(p) });
  expect(res.status(), `GET ${path}: ${await res.text()}`).toBe(200);
  const doses = ((await res.json()) as { data?: Array<{ id: string }> }).data ?? [];
  for (const dose of doses) {
    const del = await request.delete(`${GATEWAY_URL}/api/v1/health/vaccinations/${dose.id}`, {
      headers: apiHeaders(p),
    });
    expect(del.status(), `DELETE /health/vaccinations/${dose.id}: ${await del.text()}`).toBe(204);
  }
}
