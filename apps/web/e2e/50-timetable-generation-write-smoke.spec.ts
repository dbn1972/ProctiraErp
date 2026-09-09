/**
 * Timetable generation + substitution desk (Wave 9 / G-917).
 *
 * Ungated: generate and substitution pages render with headings.
 * Gated (E2E_BACKEND_READY): period → bell schedule → periods → room →
 * section → generation job (clashCount 0) → teacher absence → tenant B deny.
 */
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
  sub = 'e2e-admin',
) {
  const res = await request.post(`${GATEWAY_URL}/api/v1${path}`, {
    headers: headers(tenantId, sub),
    data,
  });
  expect(res.status(), `${path}: ${await res.text()}`).toBe(expected);
  return res.json();
}

interface TimetableFixture {
  periodId: string;
  bellScheduleId: string;
  sectionId: string;
  staffId: string;
  roomId: string;
}

async function buildTimetableInputs(request: APIRequestContext): Promise<TimetableFixture> {
  const stamp = Date.now().toString(36);
  const period = await postOk(
    request,
    '/academic-periods',
    {
      name: `TT AY ${stamp}`,
      code: `TT-${stamp}`,
      startDate: isoDate(-30),
      endDate: isoDate(300),
      status: 'active',
    },
    201,
  );
  const bell = await postOk(
    request,
    '/timetable/bell-schedules',
    {
      institutionId: INSTITUTION_A,
      academicPeriodId: period.id,
      name: `Bell ${stamp}`,
      code: `B${stamp.slice(-6)}`,
      dayPattern: '1,2,3,4,5',
    },
    201,
  );
  await postOk(
    request,
    `/timetable/bell-schedules/${bell.id}/periods`,
    { name: 'P1', periodOrder: 1, startTime: '08:00', endTime: '08:45' },
    201,
  );
  await postOk(
    request,
    `/timetable/bell-schedules/${bell.id}/periods`,
    { name: 'P2', periodOrder: 2, startTime: '09:00', endTime: '09:45' },
    201,
  );
  const room = await postOk(
    request,
    '/timetable/rooms',
    {
      institutionId: INSTITUTION_A,
      code: `R${stamp.slice(-6)}`,
      name: `Room ${stamp}`,
      capacity: 40,
    },
    201,
  );
  const staff = await postOk(
    request,
    '/staff',
    {
      firstName: 'Gen',
      lastName: `Teacher ${stamp}`,
      dateOfBirth: '1984-03-12',
      identityNumber: `TT-${stamp}`,
      contactPhone: '+10000000001',
      contactEmail: `tt-${stamp}@tenant-a.test`,
      position: 'Teacher',
    },
    201,
  );
  const section = await postOk(
    request,
    '/timetable/sections',
    {
      institutionId: INSTITUTION_A,
      academicPeriodId: period.id,
      name: `Sec ${stamp}`,
      code: `S${stamp.slice(-6)}`,
      capacity: 30,
    },
    201,
  );
  return {
    periodId: period.id as string,
    bellScheduleId: bell.id as string,
    sectionId: section.id as string,
    staffId: staff.id as string,
    roomId: room.id as string,
  };
}

async function hydrated(page: Page, testId: string) {
  const el = page.getByTestId(testId);
  await expect(el).toHaveAttribute('data-hydrated', 'true', { timeout: 20_000 });
  return el;
}

test.describe('Timetable generation — pages render (ungated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('/institutions/[id]/timetable/generate lists with a heading', async ({ page }) => {
    await page.goto(`/institutions/${INSTITUTION_A}/timetable/generate`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByRole('heading', { name: /generate timetable/i })).toBeVisible();
  });

  test('/institutions/[id]/timetable/substitutions lists with a heading', async ({ page }) => {
    await page.goto(`/institutions/${INSTITUTION_A}/timetable/substitutions`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByRole('heading', { level: 1, name: /substitutions/i })).toBeVisible();
  });
});

test.describe('Timetable generation — live chain (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1 and a live gateway + Postgres');

  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('generation job clashCount 0 then teacher absence lists affected periods', async ({
    page,
    request,
  }) => {
    const fx = await buildTimetableInputs(request);
    const job = await postOk(
      request,
      '/timetable/generation-jobs',
      {
        institutionId: INSTITUTION_A,
        academicPeriodId: fx.periodId,
        bellScheduleId: fx.bellScheduleId,
        persistMeetings: false,
        demands: [
          {
            sectionId: fx.sectionId,
            subjectId: 'math',
            staffId: fx.staffId,
            periodsPerWeek: 2,
            preferredRoomId: fx.roomId,
            enrollmentCount: 20,
          },
        ],
      },
      201,
    );
    expect(job.status).toBe('done');
    expect(job.clashCount).toBe(0);

    const absence = await postOk(
      request,
      '/timetable/teacher-absences',
      {
        institutionId: INSTITUTION_A,
        staffId: fx.staffId,
        absenceDate: isoDate(0),
        reason: 'e2e cover',
      },
      201,
    );
    expect(absence.absence.staffId).toBe(fx.staffId);

    const affected = await request.get(
      `${GATEWAY_URL}/api/v1/timetable/teacher-absences/affected?institutionId=${INSTITUTION_A}&staffId=${fx.staffId}&date=${isoDate(0)}`,
      { headers: headers() },
    );
    expect(affected.status(), await affected.text()).toBe(200);
    expect((await affected.json()).data).toBeDefined();

    await page.goto(`/institutions/${INSTITUTION_A}/timetable/generate`, {
      waitUntil: 'domcontentloaded',
    });
    await hydrated(page, 'timetable-generate-page');
  });

  test('cross-tenant: tenant B cannot read tenant A generation jobs', async ({ request }) => {
    const fx = await buildTimetableInputs(request);
    const job = await postOk(
      request,
      '/timetable/generation-jobs',
      {
        institutionId: INSTITUTION_A,
        academicPeriodId: fx.periodId,
        bellScheduleId: fx.bellScheduleId,
        persistMeetings: false,
        demands: [
          {
            sectionId: fx.sectionId,
            subjectId: 'math',
            staffId: fx.staffId,
            periodsPerWeek: 1,
          },
        ],
      },
      201,
    );
    const res = await request.get(`${GATEWAY_URL}/api/v1/timetable/generation-jobs/${job.id}`, {
      headers: headers(TENANT_B),
    });
    expect([403, 404], `generation-jobs/${job.id} → ${res.status()}`).toContain(res.status());
  });
});
