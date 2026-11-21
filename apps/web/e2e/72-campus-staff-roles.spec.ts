/**
 * Campus staff roles — live screen -> gateway -> DB checks (H-D2, T-O1, MR-1, T-D3).
 *
 * The hostel and transport packages let wardens, transport officers and the
 * registrar through; the gateway now grants them (least privilege):
 * - `warden` reads and writes hostel, nothing on transport;
 * - `transport_officer` reads and writes transport, nothing on hostel;
 * - `registrar` reads both, every write is refused at the gateway (403), so
 *   the transport form shows the fixed permission copy with a reference and
 *   no vehicle is stored (the live T-D3 path);
 * - teacher, parent and student stay denied on both domains (access-denied
 *   card on the screen, 403 from the gateway).
 *
 * Every row is written per run with fresh names; assertions never depend on
 * rows left by other runs (newest-first lists, `rank()` registration prefix).
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { createSignedJwt } from './fixtures/fake-session';
import {
  TENANT_A,
  addDaysIso,
  attempt,
  createStudent,
  expectScreen,
  getJson,
  hydrated,
  newTag,
  openAs,
  principalHeaders,
  rank,
  send,
  todayIso,
  type Headers,
  type SessionUser,
  type VehicleRow,
} from './fixtures/transport-screens';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

type List<T> = { data: T[] };
type LeaveRow = { id: string; reason: string | null; studentId: string; status: string };

/** Fixed copy from apps/web/src/lib/api/action-error.ts PERMISSION_DENIED_ACTION_MESSAGE. */
const PERMISSION_DENIED =
  'You do not have permission to make this change. Contact your administrator if you need access.';
/** Gateway / package refusal text that must never reach a form. */
const RAW_DENIAL = /No role assignment grants|Forbidden:|within the requested area scope/;

function persona(roleId: string, displayName: string, sub: string = randomUUID()): SessionUser {
  return {
    sub,
    tenantId: TENANT_A,
    roles: [{ roleId, roleName: displayName, areaId: null }],
    displayName,
  };
}

function headersOf(user: SessionUser): Headers {
  const token = createSignedJwt({
    sub: user.sub,
    email: `${user.sub}@campus.test`,
    displayName: user.displayName,
    tenantId: user.tenantId,
    roles: user.roles,
    institutions: [],
  });
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Tenant-ID': user.tenantId,
  };
}

/** A hostel and a leave for a fresh student, written by the tenant principal. */
async function seedLeave(request: Parameters<typeof createStudent>[0], tag: string) {
  const P = principalHeaders(TENANT_A, randomUUID());
  const student = await createStudent(request, { tag, n: 1 });
  const hostel = await send<{ id: string }>(
    request,
    'POST',
    '/hostel',
    { name: `CS Hostel ${tag}`, code: `CS${tag}` },
    201,
    P,
  );
  const reason = `Campus roles leave ${tag}`;
  const leave = await send<LeaveRow>(
    request,
    'POST',
    '/hostel/leaves',
    {
      studentId: student.id,
      hostelId: hostel.id,
      // Relative to the run, never a fixed calendar date.
      startDate: addDaysIso(todayIso(), 7),
      endDate: addDaysIso(todayIso(), 9),
      reason,
    },
    201,
    P,
  );
  return { P, leave, reason };
}

async function expectDenied(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'load' });
  await expect(page.getByTestId('route-access-denied')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(0);
  await expect(page.getByTestId('hostel-leave-form')).toHaveCount(0);
  await expect(page.getByTestId('transport-vehicle-form')).toHaveCount(0);
}

test.describe('Campus staff roles (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1 and a live gateway + Postgres');

  test('a warden reads hostel leaves on screen and through the API, and is denied transport', async ({
    page,
    request,
  }) => {
    test.slow();
    const tag = newTag();
    const { leave, reason } = await seedLeave(request, tag);
    const warden = persona('warden', 'CS Warden');
    const W = headersOf(warden);

    const leaves = await getJson<List<LeaveRow>>(request, '/hostel/leaves', W);
    expect(leaves.data[0]).toMatchObject({ id: leave.id, reason, status: 'pending' });
    expect((await attempt(request, 'GET', '/transport/vehicles', undefined, W)).status).toBe(403);

    await openAs(page, warden);
    await page.goto('/hostel/leaves', { waitUntil: 'load' });
    await expectScreen(page, 'Leaves');
    await expect(page.getByTestId('route-access-denied')).toHaveCount(0);
    await expect(page.getByText(reason)).toHaveCount(1);
    await expectDenied(page, '/transport/vehicles');
  });

  test('a transport officer saves a vehicle through the form, and is denied hostel', async ({
    page,
    request,
  }) => {
    test.slow();
    const tag = newTag();
    const officer = persona('transport_officer', 'CS Transport Officer');
    const O = headersOf(officer);
    const registration = `${rank()}-CS${tag}`;

    await openAs(page, officer);
    await page.goto('/transport/vehicles', { waitUntil: 'domcontentloaded' });
    await expectScreen(page, 'Vehicles');
    await hydrated(page, 'transport-vehicle-form');
    await page.locator('#vehicle-reg').fill(registration);
    await page.locator('#vehicle-capacity').fill('24');
    await page.getByRole('button', { name: 'Add vehicle' }).click();
    await expect(page.locator('#vehicle-reg')).toHaveValue('', { timeout: 20_000 });
    const row = page.getByTestId('transport-vehicle-row').filter({ hasText: registration });
    await expect(row).toHaveCount(1);

    const vehicles = await getJson<List<VehicleRow>>(request, '/transport/vehicles', O);
    expect(vehicles.data[0]).toMatchObject({ registrationNumber: registration, capacity: 24 });
    expect((await attempt(request, 'GET', '/hostel/leaves', undefined, O)).status).toBe(403);
    await expectDenied(page, '/hostel/leaves');
  });

  test('T-D3 a registrar opens /transport/vehicles, the save is refused with safe copy and nothing is stored', async ({
    page,
    request,
  }) => {
    test.slow();
    const tag = newTag();
    const P = principalHeaders(TENANT_A, randomUUID());
    const registrar = persona('registrar', 'CS Registrar');
    const R = headersOf(registrar);
    const registration = `${rank()}-CR${tag}`;

    // Read-only at the gateway: reads succeed, a direct write is 403.
    await getJson(request, '/transport/vehicles', R);
    await getJson(request, '/hostel/leaves', R);
    const direct = await attempt(
      request,
      'POST',
      '/transport/vehicles',
      { registrationNumber: `${registration}-API`, capacity: 20 },
      R,
    );
    expect(direct.status).toBe(403);

    await openAs(page, registrar);
    await page.goto('/transport/vehicles', { waitUntil: 'domcontentloaded' });
    await expectScreen(page, 'Vehicles');
    await hydrated(page, 'transport-vehicle-form');
    await page.locator('#vehicle-reg').fill(registration);
    await page.getByRole('button', { name: 'Add vehicle' }).click();
    const alert = page.locator('[data-testid="transport-vehicle-form"] [role="alert"]');
    await expect(alert).toBeVisible({ timeout: 20_000 });
    await expect(alert).toHaveText(
      new RegExp(`^${PERMISSION_DENIED.replace(/\./g, '\\.')} \\(ref [A-Za-z0-9-]{8,64}\\)$`),
    );
    await expect(alert).not.toContainText(RAW_DENIAL);

    const after = await getJson<List<VehicleRow>>(request, '/transport/vehicles', P);
    expect(after.data.some((v) => v.registrationNumber.startsWith(registration))).toBe(false);
  });

  for (const [roleId, label] of [
    ['teacher', 'CS Teacher'],
    ['parent', 'CS Parent'],
    ['student', 'CS Student'],
  ] as const) {
    test(`a ${roleId} is denied hostel and transport on screen and at the gateway`, async ({
      page,
      request,
    }) => {
      test.slow();
      const tag = newTag();
      const { reason } = await seedLeave(request, tag);
      const user = persona(roleId, label);
      const H = headersOf(user);
      for (const path of ['/hostel/leaves', '/transport/vehicles']) {
        const res = await attempt(request, 'GET', path, undefined, H);
        expect(res.status, `${roleId} GET ${path}`).toBe(403);
        expect(res.body).not.toContain(reason);
      }
      const write = await attempt(
        request,
        'POST',
        '/transport/vehicles',
        { registrationNumber: `${rank()}-CX${tag}`, capacity: 20 },
        H,
      );
      expect(write.status, `${roleId} POST /transport/vehicles`).toBe(403);

      await openAs(page, user);
      for (const path of ['/hostel/leaves', '/transport/vehicles']) {
        await expectDenied(page, path);
        await expect(page.getByText(reason)).toHaveCount(0);
      }
    });
  }
});
