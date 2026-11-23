/**
 * Admissions defect fixes (spec 107) — personas, per-run seeding and probes.
 *
 * Self-contained: imports only the domain-neutral primitives in `./hostel-screens` and
 * `./test-data`. Each test seeds its own academic period and grade in each tenant with a
 * unique tag, so assertions find this run's rows whatever earlier runs left behind; the
 * admissions CRM has no delete routes, so tests assert only on tagged rows and never on
 * counts.
 *
 * Tenant B's institution (`AD107 Tenant B School`, code `AD107-B-SCH`) is found or created
 * once by its fixed code, so re-runs reuse one row instead of adding one per run.
 *
 * Strings never look like real people: names start with `AD` and carry the tag, phone
 * numbers use the unassigned +1 555 area code, dates derive from the run.
 */
import { randomBytes } from 'node:crypto';

import { expect, type APIRequestContext } from '@playwright/test';

import {
  GATEWAY_URL,
  TENANT_A,
  apiHeaders,
  postCreated,
  utcDate,
  type Persona,
  type Row,
} from './hostel-screens';
import { uniqueFarFutureYearWindow, uniqueGradeOrder } from './test-data';

export {
  BACKEND_READY,
  TENANT_A,
  TENANT_B,
  newTag,
  type Persona,
  type Row,
} from './hostel-screens';

/** Seeded by tools/e2e/seed-e2e-tenants.sql ("E2E Demo School", tenant A). */
export const INSTITUTION_A = 'a2e96cd1-0232-4cce-97e2-00ebbfb9a374';

/** Tenant B's fixture institution (found or created by this code). */
export const INSTITUTION_B_CODE = 'AD107-B-SCH';
const AREA_B_CODE = 'AD107-B-AREA';
/** Institution type / sector / ownership catalogue ids (apps/web/src/lib/institutions/lookups.ts). */
const PRIMARY_SCHOOL_TYPE = '00000000-0000-4000-8000-000000000010';
const PRIVATE_SECTOR = '00000000-0000-4000-8000-000000000021';
const PRIVATE_OWNERSHIP = '00000000-0000-4000-8000-000000000031';

/** #739 safe-form body text never carries database internals. */
export const DB_TEXT = /constraint|foreign key|_fkey|violates|relation "|column "|SQLSTATE/i;

/** Tenant administrator (`roleId: 'admin'`), allowed by the gateway and the package. */
export function admissionsAdmin(tag: string, tenantId: string = TENANT_A): Persona {
  const sub = `ad107-admin-${tag}-${tenantId.slice(-2)}`;
  return {
    sub,
    email: `${sub}@tenant.test`,
    displayName: 'AD Administrator',
    tenantId,
    roles: [{ roleId: 'admin', roleName: 'Administrator', areaId: null }],
  };
}

export interface Probe {
  status: number;
  body: string;
}

export async function probe(
  request: APIRequestContext,
  p: Persona,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  path: string,
  data?: Row,
): Promise<Probe> {
  const res = await request.fetch(`${GATEWAY_URL}/api/v1${path}`, {
    method,
    headers: apiHeaders(p),
    ...(data === undefined ? {} : { data }),
  });
  return { status: res.status(), body: await res.text() };
}

export async function getJson<T = Row>(
  request: APIRequestContext,
  p: Persona,
  path: string,
): Promise<T> {
  const r = await probe(request, p, 'GET', path);
  expect(r.status, `GET ${path}: ${r.body.slice(0, 300)}`).toBe(200);
  return JSON.parse(r.body) as T;
}

export async function sendJson<T = Row>(
  request: APIRequestContext,
  p: Persona,
  method: 'POST' | 'PUT' | 'PATCH',
  path: string,
  data: Row | undefined,
  expected: number,
): Promise<T> {
  const r = await probe(request, p, method, path, data);
  expect(r.status, `${method} ${path}: ${r.body.slice(0, 300)}`).toBe(expected);
  return JSON.parse(r.body) as T;
}

/** Every row of an offset-paged admissions list (`limit`/`offset`/`pagination.hasMore`). */
export async function getAllOffsetPages(
  request: APIRequestContext,
  p: Persona,
  path: string,
): Promise<Row[]> {
  const rows: Row[] = [];
  const sep = path.includes('?') ? '&' : '?';
  for (let page = 0; page < 200; page += 1) {
    const body = await getJson<{ data?: Row[]; pagination?: { hasMore?: boolean } }>(
      request,
      p,
      `${path}${sep}limit=200&offset=${page * 200}`,
    );
    rows.push(...(body.data ?? []));
    if (!body.pagination?.hasMore) break;
  }
  return rows;
}

/** POST that may hit a unique-window/order collision (409): redraw up to three times. */
async function createWithRedraw(
  request: APIRequestContext,
  p: Persona,
  path: string,
  draw: () => Row,
): Promise<Row & { id: string }> {
  let last = '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const r = await probe(request, p, 'POST', path, draw());
    if (r.status === 201) return JSON.parse(r.body) as Row & { id: string };
    last = `${r.status} ${r.body.slice(0, 300)}`;
    if (r.status !== 409) break;
  }
  throw new Error(`POST ${path} failed: ${last}`);
}

export interface SeededScope {
  periodId: string;
  gradeId: string;
}

/** A fresh academic period and grade in `admin`'s tenant. */
export async function seedScope(
  request: APIRequestContext,
  admin: Persona,
  tag: string,
): Promise<SeededScope> {
  const period = await createWithRedraw(request, admin, '/academic-periods', () => ({
    name: `AD ${tag} Year`,
    code: `AY-AD-${tag}`,
    ...uniqueFarFutureYearWindow(),
    status: 'inactive',
  }));
  const grade = await createWithRedraw(request, admin, '/grades', () => ({
    name: `Grade AD${tag}`,
    code: `AD${tag}`,
    order: uniqueGradeOrder(),
  }));
  return { periodId: period.id, gradeId: grade.id };
}

/** Fictional guardian phone: unassigned +1 555 area code, 7 digits from fresh entropy. */
export function fictionalPhone(): string {
  return `+1555${String(randomBytes(4).readUInt32BE(0) % 10_000_000).padStart(7, '0')}`;
}

/** Date of birth about 10 years before today (derived from the run). */
export function childDob(): string {
  return utcDate(-3650);
}

/** Enquiry body for `scope` at `institutionId` (names carry the tag). */
export function enquiryBody(
  institutionId: string,
  scope: SeededScope,
  firstName: string,
  tag: string,
): Row {
  return {
    institutionId,
    academicPeriodId: scope.periodId,
    gradeId: scope.gradeId,
    firstName,
    lastName: 'Applicant',
    dateOfBirth: childDob(),
    guardianName: `AD ${tag} Guardian`,
    guardianPhone: fictionalPhone(),
  };
}

/** Enquiry at INSTITUTION_A on `scope`, converted to an application (placement on `scope`). */
export async function seedApplication(
  request: APIRequestContext,
  admin: Persona,
  scope: SeededScope,
  tag: string,
): Promise<{ enquiryId: string; applicationId: string }> {
  const enquiry = await postCreated(
    request,
    admin,
    '/admissions/enquiries',
    enquiryBody(INSTITUTION_A, scope, `AD${tag}`, tag),
  );
  const converted = await sendJson<{ application: { id: string } }>(
    request,
    admin,
    'POST',
    `/admissions/enquiries/${enquiry.id}/convert`,
    undefined,
    201,
  );
  return { enquiryId: enquiry.id, applicationId: converted.application.id };
}

interface AreaNode {
  id: string;
  code?: string;
  children?: AreaNode[];
}

function findArea(nodes: AreaNode[], code: string): AreaNode | undefined {
  for (const node of nodes) {
    if (node.code === code) return node;
    const child = findArea(node.children ?? [], code);
    if (child) return child;
  }
  return undefined;
}

/** Tenant B's fixture institution id: found by its fixed code, created on first use. */
export async function ensureInstitutionB(
  request: APIRequestContext,
  adminB: Persona,
): Promise<string> {
  for (let page = 1; page <= 50; page += 1) {
    const body = await getJson<{ data: Array<{ id: string; code: string }>; meta?: Row }>(
      request,
      adminB,
      `/institutions?search=${INSTITUTION_B_CODE}&pageSize=100&page=${page}`,
    );
    const found = body.data.find((row) => row.code === INSTITUTION_B_CODE);
    if (found) return found.id;
    if (body.data.length < 100) break;
  }
  const tree = await getJson<AreaNode[] | { data: AreaNode[] }>(request, adminB, '/areas/tree');
  let area = findArea(Array.isArray(tree) ? tree : tree.data, AREA_B_CODE);
  if (!area) {
    area = (await postCreated(request, adminB, '/areas', {
      name: 'AD107 Tenant B District',
      code: AREA_B_CODE,
    })) as unknown as AreaNode;
  }
  const created = await postCreated(request, adminB, '/institutions', {
    name: 'AD107 Tenant B School',
    code: INSTITUTION_B_CODE,
    areaId: area.id,
    typeId: PRIMARY_SCHOOL_TYPE,
    sectorId: PRIVATE_SECTOR,
    ownershipId: PRIVATE_OWNERSHIP,
  });
  return created.id;
}

/** #739 safe form: 422 REFERENCE_NOT_FOUND, fixed copy, correlation id, no DB text. */
export function expectSafeReferenceError(r: Probe, label: string): void {
  expect.soft(r.status, `${label}: ${r.status} ${r.body.slice(0, 300)}`).toBe(422);
  if (r.status !== 422) return;
  expect.soft(r.body, `${label} body`).not.toMatch(DB_TEXT);
  const json = JSON.parse(r.body) as { code?: string; message?: string; correlationId?: unknown };
  expect.soft(json.code, label).toBe('REFERENCE_NOT_FOUND');
  expect.soft(json.message, label).toBe('A referenced record does not exist.');
  expect.soft(typeof json.correlationId, `${label} correlationId`).toBe('string');
  expect.soft(String(json.correlationId).length, `${label} correlationId`).toBeGreaterThan(0);
}
