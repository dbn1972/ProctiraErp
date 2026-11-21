/**
 * Assessments + gradebook defect fixes (spec 115) — per-run seeding and probes.
 *
 * Self-contained: it imports only fixtures already on main (`./hostel-screens`,
 * `./test-data`). Every row carries the `AS` prefix and a per-run tag; tests find their rows
 * by id or tag and never count. SQL is used only where no API exists (values are psql
 * variables, never spliced): one fixed board in tenant B, upserted with a fixed id so re-runs
 * add no rows (the same id and values as the M4 P2 patch for spec 114).
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { expect, type APIRequestContext } from '@playwright/test';

import {
  GATEWAY_URL,
  TENANT_A,
  TENANT_B,
  apiHeaders,
  getRows,
  postCreated,
  utcDate,
  type Persona,
  type Row,
} from './hostel-screens';
import { ensureSharedAcademicYear } from './test-data';

export {
  BACKEND_READY,
  TENANT_A,
  TENANT_B,
  newTag,
  type Persona,
  type Row,
} from './hostel-screens';

/** E2E-AY, tenant A's rolling academic year (tools/e2e/seed-e2e-tenants.sql, SP-R2). */
export const PERIOD_A = '00000000-0000-4000-8000-00000000ac01';
/** Seeded area of tenant A and the static institution type/sector/ownership ids. */
const AREA_A = '00000000-0000-4000-8000-00000000a0ea';
const TYPE_ID = '00000000-0000-4000-8000-000000000010';
const SECTOR_ID = '00000000-0000-4000-8000-000000000020';
const OWNERSHIP_ID = '00000000-0000-4000-8000-000000000030';
/** Tenant B's board (no API creates boards). */
export const BOARD_B = '00000000-0000-4000-8000-0000000a5c01';

/** The #739 safe body for a reference that is not in the caller's tenant. */
export const REFERENCE_NOT_FOUND = {
  code: 'REFERENCE_NOT_FOUND',
  message: 'A referenced record does not exist.',
} as const;
/** Database internals that must never reach a response body. */
export const DB_TEXT =
  /constraint|foreign key|_fkey|_tenant_fk|violates|relation "|column "|SQLSTATE|board_export_jobs/i;

/** Tenant administrator. `sub` is a UUID: report-card jobs store it in a UUID column. */
export function asAdmin(tenantId: string): Persona {
  const sub = randomUUID();
  return {
    sub,
    email: `${sub}@tenant.test`,
    displayName: 'AS Administrator',
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
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  data?: Row,
): Promise<Probe> {
  const res = await request.fetch(`${GATEWAY_URL}/api/v1${path}`, {
    method,
    headers: apiHeaders(p),
    data,
  });
  return { status: res.status(), body: await res.text() };
}

/** 422, the fixed copy, a correlation id, and no database text (spec 73 form). */
export function expectSafeReferenceError(r: Probe, label: string): void {
  expect(r.status, `${label}: ${r.body.slice(0, 300)}`).toBe(422);
  expect(r.body, `${label} body`).not.toMatch(DB_TEXT);
  const json = JSON.parse(r.body) as { code?: string; message?: string; correlationId?: unknown };
  expect({ code: json.code, message: json.message }, label).toEqual(REFERENCE_NOT_FOUND);
  expect(typeof json.correlationId, `${label} correlationId`).toBe('string');
  expect(String(json.correlationId).length, `${label} correlationId`).toBeGreaterThan(0);
}

// ─── SQL (no API exists) ─────────────────────────────────────────────────────

const BOARD_SQL = `
BEGIN;
SELECT set_config('app.tenant_id', :'tenant', true);
INSERT INTO boards (id, tenant_id, name, code, type, status)
VALUES (:'board'::uuid, :'tenant'::uuid, 'AS E2E Board', 'AS-E2E-BOARD', 'NATIONAL', 'active')
ON CONFLICT (id) DO UPDATE SET status = 'active', deleted_at = NULL;
SELECT 'board:' || id FROM boards WHERE id = :'board'::uuid;
COMMIT;
`;

/** Idempotent: tenant B's board with a fixed id. */
export function ensureTenantBBoard(): string {
  const url = process.env.DATABASE_URL ?? process.env.MIGRATOR_DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL or MIGRATOR_DATABASE_URL is required for SQL setup');
  const args = [url, '-v', 'ON_ERROR_STOP=1', '-qAt', '-v', `tenant=${TENANT_B}`];
  args.push('-v', `board=${BOARD_B}`);
  const out = execFileSync('psql', args, { input: BOARD_SQL, encoding: 'utf8', stdio: 'pipe' });
  if (!out.includes(`board:${BOARD_B}`)) throw new Error(`Board seed failed: ${out}`);
  return BOARD_B;
}

// ─── Seeds ───────────────────────────────────────────────────────────────────

export interface TenantASet {
  admin: Persona;
  student: { id: string };
  institution: { id: string };
  subject: { id: string };
}

/** Tenant A: one student, one institution and one subject, all named `AS<tag> …`. */
export async function seedTenantA(request: APIRequestContext, tag: string): Promise<TenantASet> {
  const admin = asAdmin(TENANT_A);
  const student = await postCreated(request, admin, '/students', {
    firstName: `AS${tag}`,
    lastName: 'Defect Learner',
    dateOfBirth: utcDate(-12 * 365),
    gender: 'female',
  });
  const institution = await postCreated(request, admin, '/institutions', {
    name: `AS ${tag} Defect School`,
    code: `AS${tag}D`,
    areaId: AREA_A,
    typeId: TYPE_ID,
    sectorId: SECTOR_ID,
    ownershipId: OWNERSHIP_ID,
  });
  const subject = await postCreated(request, admin, '/subjects', {
    code: `AS${tag}A`,
    name: `AS ${tag} A Maths`,
  });
  return {
    admin,
    student: { id: student.id },
    institution: { id: institution.id },
    subject: { id: subject.id },
  };
}

export interface TenantBSet {
  admin: Persona;
  board: string;
  student: { id: string };
  subject: { id: string };
  scheme: { id: string };
  periodId: string;
}

/** Tenant B: its board, a student, a subject, a grading scheme and its own academic year. */
export async function seedTenantB(request: APIRequestContext, tag: string): Promise<TenantBSet> {
  const admin = asAdmin(TENANT_B);
  const board = ensureTenantBBoard();
  const student = await postCreated(request, admin, '/students', {
    firstName: `AS${tag}`,
    lastName: 'Defect B Learner',
    dateOfBirth: utcDate(-12 * 365 - 1),
    gender: 'female',
  });
  const subject = await postCreated(request, admin, '/subjects', {
    code: `AS${tag}B`,
    name: `AS ${tag} B Maths`,
  });
  const scheme = await postCreated(request, admin, '/grading-schemes', {
    name: `AS ${tag} B Defect Scheme`,
    type: 'numeric',
    minValue: 0,
    maxValue: 100,
    thresholds: [
      { grade: 'A', minScore: 90, maxScore: 100 },
      { grade: 'B', minScore: 75, maxScore: 89.99 },
      { grade: 'C', minScore: 0, maxScore: 74.99 },
    ],
  });
  const period = await ensureSharedAcademicYear(request, GATEWAY_URL, apiHeaders(admin));
  return {
    admin,
    board,
    student: { id: student.id },
    subject: { id: subject.id },
    scheme: { id: scheme.id },
    periodId: period.id,
  };
}

/** Report-card jobs of `p`'s tenant whose metadata names `studentId` (whole list, by id). */
export async function reportCardJobsFor(
  request: APIRequestContext,
  p: Persona,
  studentId: string,
): Promise<Row[]> {
  const rows = await getRows(request, p, '/gradebook/report-cards');
  return rows.filter((job) => (job.metadata as Row | undefined)?.studentId === studentId);
}
