/**
 * Transport screen coverage — per-run seeding helpers (specs 66–68).
 *
 * The transport staff user is a `principal` session: the least-privileged
 * built-in role that passes both the gateway RBAC (`transport: manage`) and the
 * package guard (`TRANSPORT_STAFF_ROLES`). Students and staff are created with
 * the tenant admin JWT; every transport row is written with the principal JWT.
 *
 * Leftover rows from other runs must never decide an assertion:
 * - `GET /transport/routes` and `/vehicles` return the first 20 rows by name /
 *   registration. `rank()` prefixes names with a 14-digit number that falls
 *   every millisecond, so a newer row sorts before every older row and before
 *   every name that starts with a letter.
 * - Driver and student assignments return the first 20 by `start_date DESC`.
 *   `nextStartDate()` returns a date after the newest stored start date, so the
 *   new row is the newest. Dates are derived from the run, never fixed.
 * - `nextStartDate()` can be after today, so a trip date is never "today" by
 *   default: attendance tests use the latest rider start date, and alert tests
 *   evaluate on a trip date on or after the driver assignment's start date.
 *   The tests then hold whether or not the roster and the alert evaluator
 *   check `start_date` (defect T-D4).
 *
 * Helpers are copied, not imported, from the other screen-coverage branches.
 * Device keys are returned to the caller and never logged.
 */
import { randomUUID } from 'node:crypto';

import { expect, type APIRequestContext, type Page } from '@playwright/test';

import { createSignedJwt, setupGatewayTenantSession } from './fake-session';

export const TENANT_A = '00000000-0000-4000-8000-000000000001';
export const TENANT_B = '00000000-0000-4000-8000-0000000000bb';
export const ZERO_UUID = '00000000-0000-4000-8000-000000000000';
export const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:3000';

const TAG_RE = /^[A-Z0-9]{1,16}$/;

export type Json = Record<string, unknown>;
export type Headers = Record<string, string>;
type Role = { roleId: string; roleName: string; areaId: string | null };

const PRINCIPAL_ROLES: Role[] = [{ roleId: 'principal', roleName: 'Principal', areaId: null }];
const TEACHER_ROLES: Role[] = [{ roleId: 'teacher', roleName: 'Teacher', areaId: null }];
const STUDENT_ROLES: Role[] = [{ roleId: 'student', roleName: 'Student', areaId: null }];

// ─── Identity ────────────────────────────────────────────────────────────────

/** 8 upper-case hex characters, unique per call. */
export function newTag(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
}

/**
 * 14-digit sort key that decreases every millisecond. A name that starts with
 * it sorts before every earlier `rank()` name and before every name that starts
 * with a letter (digits collate before letters).
 */
export function rank(): string {
  return `0${String(9_999_999_999_999 - Date.now()).padStart(13, '0')}`;
}

/** Today's UTC date, `YYYY-MM-DD`. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function bearer(token: string, tenantId: string): Headers {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Tenant-ID': tenantId,
  };
}

function headersFor(sub: string, tenantId: string, roles: Role[], displayName: string): Headers {
  const token = createSignedJwt({
    sub,
    email: `${sub}@transport.test`,
    displayName,
    tenantId,
    roles,
    institutions: [],
  });
  return bearer(token, tenantId);
}

/** Tenant admin (spec 54 shape). Used only to create students and staff. */
export function adminHeaders(tenantId: string = TENANT_A): Headers {
  return headersFor(
    'e2e-admin',
    tenantId,
    [{ roleId: 'admin', roleName: 'SUPER_ADMIN', areaId: null }],
    'E2E Admin',
  );
}

/** The transport staff user (principal). `sub` should be a fresh UUID per test. */
export function principalHeaders(tenantId: string, sub: string): Headers {
  return headersFor(sub, tenantId, PRINCIPAL_ROLES, 'TR Principal');
}

/** A staff role without transport access. */
export function teacherHeaders(sub: string, tenantId: string = TENANT_A): Headers {
  return headersFor(sub, tenantId, TEACHER_ROLES, 'TR Teacher');
}

/** A student principal bound by `sub = students.id`. */
export function studentHeaders(studentId: string, tenantId: string = TENANT_A): Headers {
  return headersFor(studentId, tenantId, STUDENT_ROLES, 'TR Student');
}

export interface SessionUser {
  sub: string;
  tenantId: string;
  roles: Role[];
  displayName: string;
}

export const principalUser = (sub: string, tenantId: string = TENANT_A): SessionUser => ({
  sub,
  tenantId,
  roles: PRINCIPAL_ROLES,
  displayName: 'TR Principal',
});

export const teacherUser = (sub: string, tenantId: string = TENANT_A): SessionUser => ({
  sub,
  tenantId,
  roles: TEACHER_ROLES,
  displayName: 'TR Teacher',
});

export const studentUser = (studentId: string, tenantId: string = TENANT_A): SessionUser => ({
  sub: studentId,
  tenantId,
  roles: STUDENT_ROLES,
  displayName: 'TR Student',
});

/** Session cookies for `user` (signed for both Next middleware and the gateway). */
export async function openAs(page: Page, user: SessionUser): Promise<void> {
  await setupGatewayTenantSession(page, {
    sub: user.sub,
    email: `${user.sub}@transport.test`,
    displayName: user.displayName,
    tenantId: user.tenantId,
    roles: user.roles,
  });
}

// ─── HTTP ────────────────────────────────────────────────────────────────────

/** Calls the gateway and asserts the status; the failure message carries the body. */
export async function send<T = Json>(
  request: APIRequestContext,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  data: unknown,
  expected: number,
  headers: Headers,
): Promise<T> {
  const res = await request.fetch(`${GATEWAY_URL}/api/v1${path}`, {
    method,
    headers,
    data: method === 'GET' || method === 'DELETE' ? undefined : (data ?? {}),
  });
  const text = await res.text();
  expect(res.status(), `${method} ${path}: ${text.slice(0, 400)}`).toBe(expected);
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

export function getJson<T = Json>(
  request: APIRequestContext,
  path: string,
  headers: Headers,
  expected = 200,
): Promise<T> {
  return send<T>(request, 'GET', path, undefined, expected, headers);
}

/** Status and raw body of a call, for negatives that record the actual status. */
export async function attempt(
  request: APIRequestContext,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  data: unknown,
  headers: Headers,
): Promise<{ status: number; body: string }> {
  const res = await request.fetch(`${GATEWAY_URL}/api/v1${path}`, {
    method,
    headers,
    data: method === 'GET' || method === 'DELETE' ? undefined : (data ?? {}),
  });
  return { status: res.status(), body: await res.text() };
}

// ─── People (tenant admin) ───────────────────────────────────────────────────

export interface Person {
  id: string;
  firstName: string;
  lastName: string;
  /** `First Last`, contained in every on-screen label for this person. */
  name: string;
}

/** `POST /students`: first name `TR<tag>`, last name `Rider<n>`. */
export async function createStudent(
  request: APIRequestContext,
  options: { tag: string; n: number; tenantId?: string },
): Promise<Person> {
  if (!TAG_RE.test(options.tag)) throw new Error(`Unexpected tag: ${options.tag}`);
  const firstName = `TR${options.tag}`;
  const lastName = `Rider${options.n}`;
  const body = await send(
    request,
    'POST',
    '/students',
    { firstName, lastName, dateOfBirth: '2012-04-01', gender: 'male' },
    201,
    adminHeaders(options.tenantId ?? TENANT_A),
  );
  return { id: String(body.id), firstName, lastName, name: `${firstName} ${lastName}` };
}

/**
 * `POST /staff`: last name `<rank()> Driver`, so the driver sorts first in the
 * driver picker (`/staff` first 100 by last name).
 */
export async function createStaff(
  request: APIRequestContext,
  options: { tag: string; tenantId?: string },
): Promise<Person> {
  if (!TAG_RE.test(options.tag)) throw new Error(`Unexpected tag: ${options.tag}`);
  const firstName = `TR${options.tag}`;
  const lastName = `${rank()} Driver`;
  const body = await send(
    request,
    'POST',
    '/staff',
    {
      firstName,
      lastName,
      dateOfBirth: '1984-03-12',
      identityNumber: `TRD-${options.tag}`,
      contactPhone: '+10000000002',
      contactEmail: `trd-${options.tag.toLowerCase()}@tenant-a.test`,
      position: 'Driver',
    },
    201,
    adminHeaders(options.tenantId ?? TENANT_A),
  );
  return { id: String(body.id), firstName, lastName, name: `${firstName} ${lastName}` };
}

// ─── Transport (principal) ───────────────────────────────────────────────────

export interface RouteRow {
  id: string;
  name: string;
  startLocation: string;
  endLocation: string;
  operatingDays: string[];
  departureTime: string | null;
  distanceKm: number | null;
  estimatedDurationMinutes: number | null;
  status: string;
}

export async function createRoute(
  request: APIRequestContext,
  headers: Headers,
  tag: string,
  extra: Json = {},
): Promise<RouteRow> {
  return send<RouteRow>(
    request,
    'POST',
    '/transport/routes',
    {
      name: `${rank()} TR Route ${tag}`,
      startLocation: `Depot ${tag}`,
      endLocation: `School ${tag}`,
      operatingDays: ['monday', 'wednesday', 'friday'],
      departureTime: '07:30',
      ...extra,
    },
    201,
    headers,
  );
}

export interface StopRow {
  id: string;
  routeId: string;
  name: string;
  stopOrder: number;
  latitude: number | null;
  longitude: number | null;
  pickupTime: string | null;
}

export async function createStop(
  request: APIRequestContext,
  headers: Headers,
  input: {
    routeId: string;
    name: string;
    stopOrder: number;
    latitude?: number;
    longitude?: number;
    pickupTime?: string;
  },
): Promise<StopRow> {
  return send<StopRow>(request, 'POST', '/transport/stops', input, 201, headers);
}

export interface VehicleRow {
  id: string;
  registrationNumber: string;
  make: string | null;
  model: string | null;
  year: number | null;
  capacity: number;
  status: string;
}

export async function createVehicle(
  request: APIRequestContext,
  headers: Headers,
  tag: string,
  extra: Json = {},
): Promise<VehicleRow> {
  return send<VehicleRow>(
    request,
    'POST',
    '/transport/vehicles',
    { registrationNumber: `${rank()}-TR${tag}`, capacity: 40, ...extra },
    201,
    headers,
  );
}

/** Registers a GPS device. The key is returned to the caller only; never log it. */
export async function registerDevice(
  request: APIRequestContext,
  headers: Headers,
  vehicleId: string,
  deviceId?: string,
): Promise<{ deviceId: string; deviceKey: string }> {
  const body = await send(
    request,
    'POST',
    `/transport/vehicles/${vehicleId}/device`,
    deviceId ? { deviceId } : {},
    201,
    headers,
  );
  return { deviceId: String(body.deviceId), deviceKey: String(body.deviceKey) };
}

export async function sendPing(
  request: APIRequestContext,
  headers: Headers,
  device: { deviceId: string; deviceKey: string },
  ping: { pingId: string; latitude: number; longitude: number },
): Promise<void> {
  await send(request, 'POST', '/transport/gps', { deviceId: device.deviceId, pings: [ping] }, 201, {
    ...headers,
    'X-Transport-Device-Key': device.deviceKey,
  });
}

export type AssignmentKind = 'driver-assignments' | 'student-assignments';

/**
 * A start date after the newest stored start date in every tenant listed (the
 * list is ordered `start_date DESC`), and never before today. A row created
 * with it is the newest, so it is inside the first-20 list the screen shows.
 */
export async function nextStartDate(
  request: APIRequestContext,
  kind: AssignmentKind,
  tenants: Array<{ headers: Headers }>,
): Promise<string> {
  let next = todayIso();
  for (const tenant of tenants) {
    const body = await getJson<{ data: Array<{ startDate: string }> }>(
      request,
      `/transport/${kind}?page=1&pageSize=1`,
      tenant.headers,
    );
    const newest = body.data[0]?.startDate?.slice(0, 10);
    if (newest) {
      const after = addDaysIso(newest, 1);
      if (after > next) next = after;
    }
  }
  return next;
}

export interface DriverAssignmentRow {
  id: string;
  vehicleId: string;
  driverId: string;
  routeId: string | null;
  startDate: string;
  isActive: boolean;
}

export async function createDriverAssignment(
  request: APIRequestContext,
  headers: Headers,
  input: { vehicleId: string; driverId: string; routeId?: string; startDate: string },
): Promise<DriverAssignmentRow> {
  return send<DriverAssignmentRow>(
    request,
    'POST',
    '/transport/driver-assignments',
    input,
    201,
    headers,
  );
}

export interface StudentAssignmentRow {
  id: string;
  studentId: string;
  routeId: string;
  stopId: string | null;
  startDate: string;
  isActive: boolean;
}

export async function createStudentAssignment(
  request: APIRequestContext,
  headers: Headers,
  input: { studentId: string; routeId: string; stopId?: string; startDate: string },
): Promise<StudentAssignmentRow> {
  return send<StudentAssignmentRow>(
    request,
    'POST',
    '/transport/student-assignments',
    input,
    201,
    headers,
  );
}

export async function markTrip(
  request: APIRequestContext,
  headers: Headers,
  input: {
    routeId: string;
    tripDate: string;
    direction: 'pickup' | 'drop';
    studentId: string;
    status: 'boarded' | 'alighted' | 'absent';
  },
): Promise<Json> {
  return send(request, 'POST', '/transport/attendance', input, 200, headers);
}

export interface AlertRuleRow {
  id: string;
  kind: string;
  threshold: number;
  routeId: string | null;
  channels: string[];
  isActive: boolean;
}

export async function createGeofenceRule(
  request: APIRequestContext,
  headers: Headers,
  input: { routeId: string; threshold: number },
): Promise<AlertRuleRow> {
  return send<AlertRuleRow>(
    request,
    'POST',
    '/transport/alert-rules',
    { kind: 'geofence_exit', channels: ['in_app'], ...input },
    201,
    headers,
  );
}

export interface AlertRow {
  id: string;
  ruleId: string;
  kind: string;
  message: string;
  routeId: string | null;
  vehicleId: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
}

/** `tripDate` must be on or after the start date of the route's driver assignment. */
export async function evaluateAlerts(
  request: APIRequestContext,
  headers: Headers,
  routeId: string,
  tripDate: string,
): Promise<{ data: AlertRow[]; evaluated: number }> {
  return send(request, 'POST', '/transport/alerts/evaluate', { routeId, tripDate }, 200, headers);
}

/** A per-tag geofence threshold in metres (1000–50999). */
export function geofenceThreshold(tag: string): number {
  return 1000 + (parseInt(tag.slice(0, 4), 16) % 50_000);
}

export interface FeeBandRow {
  id: string;
  name: string;
  routeId: string | null;
  stopId: string | null;
  amountCents: number;
  currency: string;
  feesStructureId: string | null;
}

export async function createFeeBand(
  request: APIRequestContext,
  headers: Headers,
  input: { name: string; routeId: string; stopId: string; amountCents: number },
): Promise<FeeBandRow> {
  return send<FeeBandRow>(
    request,
    'POST',
    '/transport/fee-structures',
    { currency: 'INR', ...input },
    201,
    headers,
  );
}

export interface FeeLinkRow {
  id: string;
  assignmentId: string;
  studentId: string;
  status: string;
  feesInvoiceId: string | null;
  reason: string | null;
}

// ─── Page helpers ────────────────────────────────────────────────────────────

/**
 * Waits for exactly one `[data-testid=testId]` node, then for hydration
 * (copied from spec 54: during the streamed SSR swap the node can briefly
 * appear twice, and `toHaveAttribute` does not retry past strict mode).
 */
export async function hydrated(page: Page, testId: string) {
  const el = page.getByTestId(testId);
  await expect(async () => {
    await expect(el).toHaveCount(1, { timeout: 2_000 });
    await expect(el).toHaveAttribute('data-hydrated', 'true', { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  return el;
}

/** The page rendered its own heading and no error frame or raw server text. */
export async function expectScreen(page: Page, heading: string | RegExp): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 })).toContainText(heading, {
    timeout: 20_000,
  });
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
  await expect(page.getByText('Internal Server Error')).toHaveCount(0);
  await expect(page.getByText(/Forbidden:/)).toHaveCount(0);
}
