/**
 * Attendance ops — regularisation, leave, ingest, EARLY_DEPARTURE (Wave 9 / G-919).
 *
 * Ungated: the ops page renders with a heading.
 * Gated (E2E_BACKEND_READY): mark ABSENT → regularise approve → leave approve
 * → register device → ingest twice (idempotent) → tenant B deny.
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { createSignedJwt, setupGatewayTenantSession } from './fixtures/fake-session';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:3000';
const TENANT_A = '00000000-0000-4000-8000-000000000001';
const TENANT_B = '00000000-0000-4000-8000-0000000000bb';
const INSTITUTION_A = 'a2e96cd1-0232-4cce-97e2-00ebbfb9a374';

function headers(tenantId = TENANT_A, sub = 'e2e-admin') {
  const token = createSignedJwt({
    sub,
    email: `${sub}@tenant-a.test`,
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

function stamp() {
  // Two live tests run back-to-back; a timestamp slice collided on grade codes.
  return randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function weekdayIso(daysBack: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysBack);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return d.toISOString().slice(0, 10);
}

function isoDate(daysFromNow: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

async function postOk(
  request: APIRequestContext,
  path: string,
  data: unknown,
  expected: number,
  tenantId = TENANT_A,
  extraHeaders: Record<string, string> = {},
) {
  const res = await request.post(`${GATEWAY_URL}/api/v1${path}`, {
    headers: { ...headers(tenantId), ...extraHeaders },
    data,
  });
  expect(res.status(), `${path}: ${await res.text()}`).toBe(expected);
  return res.json();
}

interface AttendanceFixture {
  periodId: string;
  classId: string;
  studentId: string;
}

async function buildClassStudent(request: APIRequestContext): Promise<AttendanceFixture> {
  const tag = stamp();
  const period = await postOk(
    request,
    '/academic-periods',
    {
      name: `Att AY ${tag}`,
      code: `AT-${tag}`,
      startDate: weekdayIso(40),
      endDate: isoDate(300),
      status: 'active',
    },
    201,
  );
  const grade = await postOk(
    request,
    '/grades',
    { name: `Att-${tag}`, code: `A${tag.slice(0, 4)}`, order: 6 },
    201,
  );
  const klass = await postOk(
    request,
    '/classes',
    {
      institutionId: INSTITUTION_A,
      gradeId: grade.id,
      academicPeriodId: period.id,
      name: `C${tag}`,
      capacity: 30,
    },
    201,
  );
  const student = await postOk(
    request,
    '/students',
    {
      firstName: 'Ops',
      lastName: `Att ${tag}`,
      dateOfBirth: '2011-04-12',
      gender: 'female',
    },
    201,
  );
  return {
    periodId: period.id as string,
    classId: klass.id as string,
    studentId: student.id as string,
  };
}

async function hydrated(page: Page, testId: string) {
  const el = page.getByTestId(testId);
  await expect(el).toHaveAttribute('data-hydrated', 'true', { timeout: 20_000 });
  return el;
}

test.describe('Attendance ops — pages render (ungated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('/attendance/ops lists with a heading', async ({ page }) => {
    await page.goto('/attendance/ops', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /regularisation and leave/i })).toBeVisible();
  });
});

test.describe('Attendance ops — live chain (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1 and a live gateway + Postgres');

  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('regularise approve, leave approve, ingest idempotent', async ({ page, request }) => {
    const fx = await buildClassStudent(request);
    const markDate = weekdayIso(2);
    const marked = await postOk(
      request,
      '/attendance/student',
      {
        studentId: fx.studentId,
        institutionId: INSTITUTION_A,
        classId: fx.classId,
        academicPeriodId: fx.periodId,
        date: markDate,
        status: 'ABSENT',
      },
      201,
    );

    const reg = await postOk(
      request,
      '/attendance/regularisation',
      {
        attendanceId: marked.id,
        studentId: fx.studentId,
        institutionId: INSTITUTION_A,
        classId: fx.classId,
        attendanceDate: markDate,
        fromStatus: 'ABSENT',
        toStatus: 'PRESENT',
        reason: 'bus delay',
      },
      201,
    );
    const approved = await postOk(request, `/attendance/regularisation/${reg.id}/approve`, {}, 200);
    expect(approved.status).toBe('approved');

    const leave = await postOk(
      request,
      '/attendance/leave-requests',
      {
        studentId: fx.studentId,
        institutionId: INSTITUTION_A,
        classId: fx.classId,
        academicPeriodId: fx.periodId,
        fromDate: weekdayIso(5),
        toDate: weekdayIso(5),
        reason: 'family',
      },
      201,
    );
    const leaveApproved = await postOk(
      request,
      `/attendance/leave-requests/${leave.id}/approve`,
      {},
      200,
    );
    expect(leaveApproved.status).toBe('approved');

    const device = await postOk(
      request,
      '/attendance/devices',
      {
        institutionId: INSTITUTION_A,
        deviceId: `gate-${stamp()}`,
        label: 'E2E gate',
      },
      201,
    );
    const ingestBody = {
      deviceId: device.device.deviceId as string,
      institutionId: INSTITUTION_A,
      events: [
        {
          eventId: `evt-${stamp()}`,
          studentId: fx.studentId,
          punchedAt: `${todayIso()}T08:05:00.000Z`,
          type: 'IN',
          classId: fx.classId,
          academicPeriodId: fx.periodId,
        },
      ],
    };
    const first = await postOk(request, '/attendance/ingest', ingestBody, 202, TENANT_A, {
      'X-Device-Api-Key': device.apiKey as string,
    });
    expect(first.accepted).toBe(1);
    expect(first.duplicates).toBe(0);
    const second = await postOk(request, '/attendance/ingest', ingestBody, 202, TENANT_A, {
      'X-Device-Api-Key': device.apiKey as string,
    });
    expect(second.duplicates).toBe(1);
    expect(second.accepted).toBe(0);

    const pct = await request.get(
      `${GATEWAY_URL}/api/v1/attendance/percentage?scope=class&classId=${fx.classId}&startDate=${weekdayIso(10)}&endDate=${todayIso()}`,
      { headers: headers() },
    );
    expect(pct.status(), await pct.text()).toBe(200);
    const pctJson = (await pct.json()) as { studentRows?: unknown[] };
    expect(Array.isArray(pctJson.studentRows)).toBe(true);

    await page.goto('/attendance/ops', { waitUntil: 'domcontentloaded' });
    await hydrated(page, 'attendance-ops-page');
    await expect(page.getByTestId('attendance-ops-panel')).toBeVisible();
  });

  test('cross-tenant: tenant B cannot approve tenant A regularisation', async ({ request }) => {
    const fx = await buildClassStudent(request);
    const markDate = weekdayIso(1);
    const marked = await postOk(
      request,
      '/attendance/student',
      {
        studentId: fx.studentId,
        institutionId: INSTITUTION_A,
        classId: fx.classId,
        academicPeriodId: fx.periodId,
        date: markDate,
        status: 'ABSENT',
      },
      201,
    );
    const reg = await postOk(
      request,
      '/attendance/regularisation',
      {
        attendanceId: marked.id,
        studentId: fx.studentId,
        institutionId: INSTITUTION_A,
        classId: fx.classId,
        attendanceDate: markDate,
        fromStatus: 'ABSENT',
        toStatus: 'EXCUSED',
      },
      201,
    );
    const foreign = await request.post(
      `${GATEWAY_URL}/api/v1/attendance/regularisation/${reg.id}/approve`,
      { headers: headers(TENANT_B), data: {} },
    );
    expect([403, 404], `regularisation approve → ${foreign.status()}`).toContain(foreign.status());
  });
});
