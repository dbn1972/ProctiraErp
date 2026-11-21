/**
 * Transport screens — read path, screen → API → database.
 *
 * A principal (the transport staff user, see fixtures/transport-screens.ts)
 * opens each transport screen and must see rows this test wrote through the
 * transport API. Each test also calls the gateway route the screen uses with
 * the same principal JWT and checks the same rows come back.
 *
 * Every test seeds its own rows with a per-run tag, and all API writes happen
 * before the first page visit. The routes, vehicles and assignments API lists
 * return 20 rows by default, so tests that read them are made independent of
 * leftover rows by `rank()` names and `nextStartDate()`; newest-first lists
 * without a unique label (alert rules, alerts, fee links) are matched by this
 * run's id at its API index.
 *
 * `/transport/routes/new` has no reads; spec 67 opens it and saves its form.
 *
 * Ungated: all 10 transport routes redirect an unauthenticated visitor to /login.
 */
import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import {
  TENANT_A,
  ZERO_UUID,
  createDriverAssignment,
  createFeeBand,
  createGeofenceRule,
  createRoute,
  createStaff,
  createStop,
  createStudent,
  createStudentAssignment,
  createVehicle,
  evaluateAlerts,
  expectScreen,
  geofenceThreshold,
  getJson,
  markTrip,
  newTag,
  nextStartDate,
  openAs,
  principalHeaders,
  principalUser,
  registerDevice,
  sendPing,
  todayIso,
  type AlertRow,
  type AlertRuleRow,
  type DriverAssignmentRow,
  type FeeBandRow,
  type FeeLinkRow,
  type RouteRow,
  type StopRow,
  type StudentAssignmentRow,
  type VehicleRow,
} from './fixtures/transport-screens';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

type List<T> = { data: T[] };

test.describe('Transport screens — unauthenticated (ungated)', () => {
  test('all 10 transport routes redirect to /login', async ({ page }) => {
    test.slow();
    await page.goto('/transport', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/transport/routes', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/transport/routes/new', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
    await page.goto(`/transport/routes/${ZERO_UUID}/stops`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/transport/vehicles', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/transport/assignments', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/transport/attendance', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/transport/live', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/transport/alerts', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/transport/fees', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('Transport screens — read path (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1 and a live gateway + Postgres');

  test('/transport links to every transport screen and opens this run’s routes', async ({
    page,
    request,
  }) => {
    test.slow();
    const sub = randomUUID();
    const P = principalHeaders(TENANT_A, sub);
    const tag = newTag();
    const route = await createRoute(request, P, tag);
    const routes = await getJson<List<RouteRow>>(request, '/transport/routes', P);
    expect(routes.data[0]?.id).toBe(route.id);

    await openAs(page, principalUser(sub));
    await page.goto('/transport', { waitUntil: 'domcontentloaded' });
    await expectScreen(page, 'Transport');
    const links: Array<[string, string]> = [
      ['Open routes', '/transport/routes'],
      ['Open vehicles', '/transport/vehicles'],
      ['Open assignments', '/transport/assignments'],
      ['Open live map', '/transport/live'],
      ['Open attendance', '/transport/attendance'],
      ['Open alerts', '/transport/alerts'],
      ['Open fees', '/transport/fees'],
    ];
    for (const [name, href] of links) {
      await expect(page.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
    }
    await page.getByRole('link', { name: 'Open routes', exact: true }).click();
    await expect(page).toHaveURL(/\/transport\/routes$/);
    await expect(
      page.getByTestId('transport-route-row').filter({ hasText: route.name }),
    ).toHaveCount(1);
  });

  test('/transport/routes lists this run’s route with its schedule', async ({ page, request }) => {
    test.slow();
    const sub = randomUUID();
    const P = principalHeaders(TENANT_A, sub);
    const tag = newTag();
    const route = await createRoute(request, P, tag);
    const routes = await getJson<List<RouteRow>>(request, '/transport/routes', P);
    expect(routes.data[0]).toMatchObject({
      id: route.id,
      name: route.name,
      startLocation: `Depot ${tag}`,
      endLocation: `School ${tag}`,
      operatingDays: ['monday', 'wednesday', 'friday'],
      departureTime: '07:30',
      status: 'active',
    });

    await openAs(page, principalUser(sub));
    await page.goto('/transport/routes', { waitUntil: 'domcontentloaded' });
    await expectScreen(page, 'Transport routes');
    const row = page.getByTestId('transport-route-row').filter({ hasText: route.name });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(`Depot ${tag} → School ${tag} · departs 07:30`);
    await expect(row).toContainText('monday, wednesday, friday · active');
    await expect(row.getByRole('link', { name: 'Manage stops' })).toHaveAttribute(
      'href',
      `/transport/routes/${route.id}/stops`,
    );
  });

  test('/transport/routes/[id]/stops lists this run’s stops in sequence', async ({
    page,
    request,
  }) => {
    test.slow();
    const sub = randomUUID();
    const P = principalHeaders(TENANT_A, sub);
    const tag = newTag();
    const route = await createRoute(request, P, tag);
    const s1 = await createStop(request, P, {
      routeId: route.id,
      name: `TR Stop ${tag} 1`,
      stopOrder: 1,
      latitude: 19.076,
      longitude: 72.8777,
      pickupTime: '07:15',
    });
    const s2 = await createStop(request, P, {
      routeId: route.id,
      name: `TR Stop ${tag} 2`,
      stopOrder: 2,
    });
    const stops = await getJson<List<StopRow>>(request, `/transport/routes/${route.id}/stops`, P);
    expect(stops.data.map((s) => s.id)).toEqual([s1.id, s2.id]);

    await openAs(page, principalUser(sub));
    await page.goto(`/transport/routes/${route.id}/stops`, { waitUntil: 'domcontentloaded' });
    await expectScreen(page, `Stops — ${route.name}`);
    await expect(page.getByText('2 stops in sequence.')).toBeVisible();
    const rows = page.getByTestId('transport-stop-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText(`1. ${s1.name}`);
    await expect(rows.nth(0)).toContainText('19.076, 72.8777 · pickup 07:15');
    await expect(rows.nth(1)).toContainText(`2. ${s2.name}`);
    await expect(rows.nth(1)).toContainText('No coordinates');
    await expect(page.locator('#stop-order')).toHaveValue('3');
  });

  test('/transport/vehicles lists this run’s vehicle', async ({ page, request }) => {
    test.slow();
    const sub = randomUUID();
    const P = principalHeaders(TENANT_A, sub);
    const tag = newTag();
    const vehicle = await createVehicle(request, P, tag, {
      make: 'Tata',
      model: `Starbus ${tag}`,
      capacity: 33,
    });
    const vehicles = await getJson<List<VehicleRow>>(request, '/transport/vehicles', P);
    expect(vehicles.data[0]).toMatchObject({
      id: vehicle.id,
      registrationNumber: vehicle.registrationNumber,
      capacity: 33,
      status: 'active',
    });

    await openAs(page, principalUser(sub));
    await page.goto('/transport/vehicles', { waitUntil: 'domcontentloaded' });
    await expectScreen(page, 'Vehicles');
    const row = page
      .getByTestId('transport-vehicle-row')
      .filter({ hasText: vehicle.registrationNumber });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(`Tata Starbus ${tag} · capacity 33 · active`);
  });

  test('/transport/assignments shows this run’s driver and student assignments', async ({
    page,
    request,
  }) => {
    test.slow();
    const sub = randomUUID();
    const P = principalHeaders(TENANT_A, sub);
    const tag = newTag();
    const route = await createRoute(request, P, tag);
    const stop = await createStop(request, P, {
      routeId: route.id,
      name: `TR Stop ${tag} 1`,
      stopOrder: 1,
    });
    const vehicle = await createVehicle(request, P, tag);
    const driver = await createStaff(request, { tag });
    const student = await createStudent(request, { tag, n: 1 });
    const driverStart = await nextStartDate(request, 'driver-assignments', [{ headers: P }]);
    const da = await createDriverAssignment(request, P, {
      vehicleId: vehicle.id,
      driverId: driver.id,
      routeId: route.id,
      startDate: driverStart,
    });
    const studentStart = await nextStartDate(request, 'student-assignments', [{ headers: P }]);
    const sa = await createStudentAssignment(request, P, {
      studentId: student.id,
      routeId: route.id,
      stopId: stop.id,
      startDate: studentStart,
    });
    const drivers = await getJson<List<DriverAssignmentRow>>(
      request,
      '/transport/driver-assignments',
      P,
    );
    expect(drivers.data[0]).toMatchObject({ id: da.id, startDate: driverStart, isActive: true });
    const students = await getJson<List<StudentAssignmentRow>>(
      request,
      '/transport/student-assignments',
      P,
    );
    expect(students.data[0]).toMatchObject({ id: sa.id, startDate: studentStart, isActive: true });

    await openAs(page, principalUser(sub));
    await page.goto('/transport/assignments', { waitUntil: 'domcontentloaded' });
    await expectScreen(page, 'Assignments');
    const driverRow = page
      .locator('li')
      .filter({ hasText: `${driver.name} · ${vehicle.registrationNumber}` });
    await expect(driverRow).toHaveCount(1);
    await expect(driverRow).toContainText(`from ${driverStart} · active`);
    const studentRow = page.locator('li').filter({ hasText: `${student.name} · ${route.name}` });
    await expect(studentRow).toHaveCount(1);
    await expect(studentRow).toContainText(`from ${studentStart} · active`);
    await expect(page.locator(`#driver-vehicle option[value="${vehicle.id}"]`)).toHaveCount(1);
    await expect(page.locator(`#driver-route option[value="${route.id}"]`)).toHaveCount(1);
    await expect(page.locator(`#student-route option[value="${route.id}"]`)).toHaveCount(1);
    await expect(page.locator(`#student-stop option[value="${stop.id}"]`)).toHaveCount(1);
  });

  test('/transport/attendance shows this run’s trip summary and assigned students', async ({
    page,
    request,
  }) => {
    test.slow();
    const sub = randomUUID();
    const P = principalHeaders(TENANT_A, sub);
    const tag = newTag();
    const route = await createRoute(request, P, tag);
    const stop = await createStop(request, P, {
      routeId: route.id,
      name: `TR Stop ${tag} 1`,
      stopOrder: 1,
    });
    const riders = [];
    let tripDate = '';
    for (const n of [1, 2, 3]) {
      const student = await createStudent(request, { tag, n });
      const startDate = await nextStartDate(request, 'student-assignments', [{ headers: P }]);
      await createStudentAssignment(request, P, {
        studentId: student.id,
        routeId: route.id,
        stopId: stop.id,
        startDate,
      });
      riders.push(student);
      // The trip is on the latest start date, so every rider has started (T-D4).
      tripDate = startDate;
    }
    const [st1, st2] = riders as [(typeof riders)[number], (typeof riders)[number]];
    const trip = { routeId: route.id, tripDate, direction: 'pickup' as const };
    await markTrip(request, P, { ...trip, studentId: st1.id, status: 'boarded' });
    await markTrip(request, P, { ...trip, studentId: st2.id, status: 'absent' });
    const query = `routeId=${route.id}&tripDate=${tripDate}&direction=pickup`;
    const api = await getJson<{
      data: Array<{ studentId: string; status: string }>;
      assigned: number;
      summary: Record<string, number>;
    }>(request, `/transport/attendance?${query}`, P);
    expect(api.assigned).toBe(3);
    expect(api.summary).toEqual({ boarded: 1, alighted: 0, absent: 1, unmarked: 1 });
    expect(Object.fromEntries(api.data.map((r) => [r.studentId, r.status]))).toEqual({
      [st1.id]: 'boarded',
      [st2.id]: 'absent',
    });

    await openAs(page, principalUser(sub));
    await page.goto(`/transport/attendance?${query}`, { waitUntil: 'domcontentloaded' });
    await expectScreen(page, 'Bus attendance');
    await expect(page.getByText('1 boarded · 0 alighted · 1 absent · 1 unmarked')).toBeVisible();
    await expect(page.locator(`#att-route option[value="${route.id}"]`)).toHaveCount(1);
    for (const rider of riders) {
      const option = page.locator(`#att-student option[value="${rider.id}"]`);
      await expect(option).toHaveCount(1);
      await expect(option).toHaveText(new RegExp(`${rider.name} · ${route.name}$`));
    }
  });

  test('/transport/live plots this run’s bus and stop', async ({ page, request }) => {
    test.slow();
    const sub = randomUUID();
    const P = principalHeaders(TENANT_A, sub);
    const tag = newTag();
    const route = await createRoute(request, P, tag);
    const stop = await createStop(request, P, {
      routeId: route.id,
      name: `TR Stop ${tag} 1`,
      stopOrder: 1,
      latitude: 19.076,
      longitude: 72.8777,
    });
    const vehicle = await createVehicle(request, P, tag);
    const device = await registerDevice(request, P, vehicle.id);
    await sendPing(request, P, device, {
      pingId: `trping-${tag}`,
      latitude: 19.0761,
      longitude: 72.8778,
    });
    const live = await getJson<{
      vehicles: Array<{
        vehicleId: string;
        registrationNumber: string | null;
        latitude: number;
        longitude: number;
      }>;
      stops: Array<{ id: string; name: string }>;
    }>(request, '/transport/live', P);
    expect(live.vehicles.find((v) => v.vehicleId === vehicle.id)).toMatchObject({
      registrationNumber: vehicle.registrationNumber,
      latitude: 19.0761,
      longitude: 72.8778,
    });
    expect(live.stops.some((s) => s.id === stop.id && s.name === stop.name)).toBe(true);

    await openAs(page, principalUser(sub));
    await page.goto('/transport/live', { waitUntil: 'domcontentloaded' });
    await expectScreen(page, 'Live map');
    const bus = page.getByTestId('transport-live-bus').filter({
      hasText: vehicle.registrationNumber,
    });
    await expect(bus).toHaveCount(1);
    await expect(bus).toContainText(`${vehicle.registrationNumber} · 19.0761, 72.8778`);
    await expect(
      page.locator(
        `[data-testid="transport-live-bus-marker"][aria-label="Bus ${vehicle.registrationNumber} — open in OpenStreetMap"]`,
      ),
    ).toHaveCount(1);
    await expect(
      page.locator(
        `[data-testid="transport-live-stop-marker"][aria-label="Stop ${stop.name} — open in OpenStreetMap"]`,
      ),
    ).toHaveCount(1);
  });

  test('/transport/alerts shows this run’s geofence rule and alert', async ({ page, request }) => {
    test.slow();
    const sub = randomUUID();
    const P = principalHeaders(TENANT_A, sub);
    const tag = newTag();
    const threshold = geofenceThreshold(tag);
    const route = await createRoute(request, P, tag);
    await createStop(request, P, {
      routeId: route.id,
      name: `TR Stop ${tag} 1`,
      stopOrder: 1,
      latitude: 19.076,
      longitude: 72.8777,
    });
    const vehicle = await createVehicle(request, P, tag);
    // Started today: the driver row is not read from a capped list here (T-D4).
    const today = todayIso();
    await createDriverAssignment(request, P, {
      vehicleId: vehicle.id,
      driverId: randomUUID(),
      routeId: route.id,
      startDate: today,
    });
    const device = await registerDevice(request, P, vehicle.id);
    // One degree north of the only stop: far outside the geofence.
    await sendPing(request, P, device, {
      pingId: `trping-${tag}`,
      latitude: 20.076,
      longitude: 72.8777,
    });
    const rule = await createGeofenceRule(request, P, { routeId: route.id, threshold });
    const evaluated = await evaluateAlerts(request, P, route.id, today);
    const created = evaluated.data.filter((a) => a.ruleId === rule.id);
    expect(created).toHaveLength(1);
    expect(created[0]!.message).toContain(`(geofence ${threshold} m)`);

    const rules = await getJson<List<AlertRuleRow>>(request, '/transport/alert-rules', P);
    const ruleIndex = rules.data.findIndex((r) => r.id === rule.id);
    expect(ruleIndex).toBeGreaterThanOrEqual(0);
    const alerts = await getJson<List<AlertRow>>(request, '/transport/alerts', P);
    const alertIndex = alerts.data.findIndex((a) => a.id === created[0]!.id);
    expect(alertIndex).toBeGreaterThanOrEqual(0);
    expect(alerts.data[alertIndex]!.acknowledgedAt).toBeNull();

    await openAs(page, principalUser(sub));
    await page.goto('/transport/alerts', { waitUntil: 'domcontentloaded' });
    await expectScreen(page, 'Transport alerts');
    const ruleRows = page.locator('li').filter({ hasText: ' · threshold ' });
    await expect(ruleRows).toHaveCount(rules.data.length);
    await expect(ruleRows.nth(ruleIndex)).toContainText(`geofence_exit · threshold ${threshold}`);
    await expect(ruleRows.nth(ruleIndex)).toContainText('active');
    const alertRows = page.getByTestId('transport-alert-row');
    await expect(alertRows).toHaveCount(alerts.data.length);
    const alertRow = alertRows.nth(alertIndex);
    await expect(alertRow).toContainText(created[0]!.message);
    await expect(alertRow).toContainText('geofence_exit');
    await expect(alertRow.getByRole('button', { name: 'Acknowledge' })).toBeVisible();
    await expect(page.locator(`#rule-route option[value="${route.id}"]`)).toHaveCount(1);
  });

  test('/transport/fees shows this run’s band and invoiced fee link', async ({ page, request }) => {
    test.slow();
    const sub = randomUUID();
    const P = principalHeaders(TENANT_A, sub);
    const tag = newTag();
    const route = await createRoute(request, P, tag);
    const stop = await createStop(request, P, {
      routeId: route.id,
      name: `TR Stop ${tag} 1`,
      stopOrder: 1,
    });
    const band = await createFeeBand(request, P, {
      name: `TR Band ${tag}`,
      routeId: route.id,
      stopId: stop.id,
      amountCents: 250_000,
    });
    const student = await createStudent(request, { tag, n: 1 });
    const assignment = await createStudentAssignment(request, P, {
      studentId: student.id,
      routeId: route.id,
      stopId: stop.id,
      startDate: await nextStartDate(request, 'student-assignments', [{ headers: P }]),
    });
    const bands = await getJson<List<FeeBandRow>>(request, '/transport/fee-structures', P);
    const apiBand = bands.data.find((b) => b.id === band.id);
    expect(apiBand).toMatchObject({ name: band.name, amountCents: 250_000, currency: 'INR' });
    expect(apiBand!.feesStructureId).toBeTruthy();
    const links = await getJson<List<FeeLinkRow>>(request, '/transport/fee-links', P);
    const linkIndex = links.data.findIndex((l) => l.assignmentId === assignment.id);
    expect(linkIndex).toBeGreaterThanOrEqual(0);
    const link = links.data[linkIndex]!;
    expect(link.status).toBe('invoiced');
    expect(link.feesInvoiceId).toBeTruthy();

    await openAs(page, principalUser(sub));
    await page.goto('/transport/fees', { waitUntil: 'domcontentloaded' });
    await expectScreen(page, 'Transport fees');
    const bandRow = page.locator('li').filter({ hasText: band.name });
    await expect(bandRow).toHaveCount(1);
    await expect(bandRow).toContainText('2500.00 INR · linked to Fees');
    const linkRows = page.getByTestId('transport-fee-link');
    await expect(linkRows).toHaveCount(links.data.length);
    await expect(linkRows.nth(linkIndex)).toContainText('Invoiced');
    await expect(linkRows.nth(linkIndex)).toContainText(
      `Invoice ${link.feesInvoiceId!.slice(0, 8)}`,
    );
    await expect(page.locator(`#fee-route option[value="${route.id}"]`)).toHaveCount(1);
    await expect(page.locator(`#fee-stop option[value="${stop.id}"]`)).toHaveCount(1);
  });

  // T-D2 regression: GET /transport/routes returns 20 rows by default and the screen
  // sent no paging params, so routes 21+ never showed and the count was wrong.
  test('T-D2 /transport/routes shows every route and the true count', async ({ page, request }) => {
    test.slow();
    const sub = randomUUID();
    const P = principalHeaders(TENANT_A, sub);
    const tag = newTag();
    let total = (
      await getJson<{ meta: { totalItems: number } }>(request, '/transport/routes?pageSize=1', P)
    ).meta.totalItems;
    let n = 0;
    let last = '';
    while (total < 21 || n === 0) {
      n += 1;
      last = (
        await createRoute(request, P, tag, {
          name: `zz TR Cap ${tag} ${String(n).padStart(2, '0')}`,
        })
      ).name;
      total = (
        await getJson<{ meta: { totalItems: number } }>(request, '/transport/routes?pageSize=1', P)
      ).meta.totalItems;
    }
    await openAs(page, principalUser(sub));
    await page.goto('/transport/routes', { waitUntil: 'domcontentloaded' });
    await expectScreen(page, 'Transport routes');
    await expect(page.getByText(`${total} routes for this tenant.`)).toBeVisible();
    await expect(page.getByTestId('transport-route-row').filter({ hasText: last })).toHaveCount(1);
  });
});
