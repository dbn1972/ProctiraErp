/**
 * Transport screens — write path, form → API → database → screen.
 *
 * One test per transport write screen. A principal (the transport staff user)
 * fills the screen's own form and saves it; the result is confirmed on screen
 * after a reload and through the gateway route with the same principal JWT.
 * Server Actions call the gateway with the session cookie, so every save is
 * made as the signed-in principal.
 *
 * Prerequisites are written through the API before the first page visit. New
 * rows are found by this run's tag or id, never by position among leftovers.
 */
import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import {
  TENANT_A,
  attempt,
  createDriverAssignment,
  createRoute,
  createStaff,
  createStop,
  createStudent,
  createStudentAssignment,
  createVehicle,
  expectScreen,
  geofenceThreshold,
  getJson,
  hydrated,
  markTrip,
  newTag,
  nextStartDate,
  openAs,
  principalHeaders,
  principalUser,
  rank,
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

test.describe('Transport screens — form saves (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1 and a live gateway + Postgres');

  test('/transport/routes/new saves a route through its form', async ({ page, request }) => {
    test.slow();
    const sub = randomUUID();
    const P = principalHeaders(TENANT_A, sub);
    const tag = newTag();
    const name = `${rank()} TR Route ${tag}`;

    await openAs(page, principalUser(sub));
    await page.goto('/transport/routes/new', { waitUntil: 'domcontentloaded' });
    await expectScreen(page, 'New transport route');
    await hydrated(page, 'transport-route-form');
    await page.locator('#route-name').fill(name);
    await page.locator('#route-description').fill(`Form route ${tag}`);
    await page.locator('#route-start').fill(`Depot ${tag}`);
    await page.locator('#route-end').fill(`School ${tag}`);
    await page.getByRole('checkbox', { name: 'Sat', exact: true }).click();
    await page.locator('#route-depart').fill('07:40');
    await page.locator('#route-distance').fill('12.5');
    await page.locator('#route-duration').fill('45');
    await page.getByRole('button', { name: 'Create route' }).click();
    await expect(page).toHaveURL(/\/transport\/routes$/, { timeout: 20_000 });

    const days = 'monday, tuesday, wednesday, thursday, friday, saturday · active';
    const row = page.getByTestId('transport-route-row').filter({ hasText: name });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(`Depot ${tag} → School ${tag} · departs 07:40`);
    await expect(row).toContainText(days);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(days);

    const routes = await getJson<List<RouteRow>>(request, '/transport/routes', P);
    expect(routes.data[0]).toMatchObject({
      name,
      startLocation: `Depot ${tag}`,
      endLocation: `School ${tag}`,
      departureTime: '07:40',
      distanceKm: 12.5,
      estimatedDurationMinutes: 45,
      status: 'active',
    });
    expect(routes.data[0]!.operatingDays).toEqual([
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ]);
  });

  test('/transport/routes/[id]/stops adds and removes a stop through its forms', async ({
    page,
    request,
  }) => {
    test.slow();
    const sub = randomUUID();
    const P = principalHeaders(TENANT_A, sub);
    const tag = newTag();
    const route = await createRoute(request, P, tag);
    const stopName = `TR Stop ${tag} 1`;

    await openAs(page, principalUser(sub));
    await page.goto(`/transport/routes/${route.id}/stops`, { waitUntil: 'domcontentloaded' });
    await expectScreen(page, `Stops — ${route.name}`);
    await hydrated(page, 'transport-stop-form');
    await page.locator('#stop-name').fill(stopName);
    await expect(page.locator('#stop-order')).toHaveValue('1');
    await page.locator('#stop-lat').fill('19.0765');
    await page.locator('#stop-lng').fill('72.8781');
    await page.locator('#stop-pickup').fill('07:20');
    await page.getByRole('button', { name: 'Add stop' }).click();
    const row = page.getByTestId('transport-stop-row').filter({ hasText: `1. ${stopName}` });
    await expect(row).toHaveCount(1, { timeout: 20_000 });
    await expect(page.locator('#stop-name')).toHaveValue('');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await hydrated(page, 'transport-stop-form');
    await expect(row).toContainText('19.0765, 72.8781 · pickup 07:20');
    await expect(page.getByText('1 stop in sequence.')).toBeVisible();
    const added = await getJson<List<StopRow>>(request, `/transport/routes/${route.id}/stops`, P);
    expect(added.data).toHaveLength(1);
    expect(added.data[0]).toMatchObject({
      name: stopName,
      stopOrder: 1,
      latitude: 19.0765,
      longitude: 72.8781,
      pickupTime: '07:20',
    });

    await row.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByTestId('transport-stop-remove-confirm')).toBeVisible();
    await page.getByTestId('transport-stop-remove-confirm-confirm').click();
    await expect(page.getByText('Empty stop list.')).toBeVisible({ timeout: 20_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Empty stop list.')).toBeVisible();
    await expect(page.getByTestId('transport-stop-row')).toHaveCount(0);
    const removed = await getJson<List<StopRow>>(request, `/transport/routes/${route.id}/stops`, P);
    expect(removed.data).toEqual([]);
  });

  test('/transport/vehicles adds a vehicle through its form', async ({ page, request }) => {
    test.slow();
    const sub = randomUUID();
    const P = principalHeaders(TENANT_A, sub);
    const tag = newTag();
    const registration = `${rank()}-TR${tag}`;

    await openAs(page, principalUser(sub));
    await page.goto('/transport/vehicles', { waitUntil: 'domcontentloaded' });
    await expectScreen(page, 'Vehicles');
    await hydrated(page, 'transport-vehicle-form');
    await page.locator('#vehicle-reg').fill(registration);
    await page.locator('#vehicle-make').fill('Ashok');
    await page.locator('#vehicle-model').fill(`Lynx ${tag}`);
    await page.locator('#vehicle-year').fill('2022');
    await page.locator('#vehicle-capacity').fill('29');
    await page.getByRole('button', { name: 'Add vehicle' }).click();
    await expect(page.locator('#vehicle-reg')).toHaveValue('', { timeout: 20_000 });

    const row = page.getByTestId('transport-vehicle-row').filter({ hasText: registration });
    await expect(row).toHaveCount(1);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(`Ashok Lynx ${tag} · capacity 29 · active`);

    const vehicles = await getJson<List<VehicleRow>>(request, '/transport/vehicles', P);
    expect(vehicles.data[0]).toMatchObject({
      registrationNumber: registration,
      make: 'Ashok',
      model: `Lynx ${tag}`,
      year: 2022,
      capacity: 29,
      status: 'active',
    });
  });

  // T-D3: a save the gateway refuses with 409 (duplicate registration) shows
  // fixed conflict copy plus a reference, never the server text.
  test('T-D3 a refused vehicle save shows safe copy and a reference', async ({ page, request }) => {
    test.slow();
    const sub = randomUUID();
    const P = principalHeaders(TENANT_A, sub);
    const tag = newTag();
    const existing = await createVehicle(request, P, tag);
    const direct = await attempt(
      request,
      'POST',
      '/transport/vehicles',
      { registrationNumber: existing.registrationNumber, capacity: 40 },
      P,
    );
    expect(direct.status).toBe(409);
    const serverMessage = (JSON.parse(direct.body) as { message?: string }).message ?? '';
    expect(serverMessage.length).toBeGreaterThan(0);
    await openAs(page, principalUser(sub));
    await page.goto('/transport/vehicles', { waitUntil: 'domcontentloaded' });
    await expectScreen(page, 'Vehicles');
    await hydrated(page, 'transport-vehicle-form');
    await page.locator('#vehicle-reg').fill(existing.registrationNumber);
    await page.getByRole('button', { name: 'Add vehicle' }).click();
    const alert = page.locator('[data-testid="transport-vehicle-form"] [role="alert"]');
    await expect(alert).toBeVisible({ timeout: 20_000 });
    await expect(alert).toHaveText(
      /^This conflicts with an existing record\. Check the details and try again\. \(ref [A-Za-z0-9-]{8,64}\)$/,
    );
    await expect(alert).not.toContainText(serverMessage);
  });

  test('/transport/assignments assigns a driver and a student through its forms', async ({
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
    const studentStart = await nextStartDate(request, 'student-assignments', [{ headers: P }]);

    await openAs(page, principalUser(sub));
    await page.goto('/transport/assignments', { waitUntil: 'domcontentloaded' });
    await expectScreen(page, 'Assignments');
    await hydrated(page, 'transport-driver-assignment-form');
    await page.locator('#driver-vehicle').selectOption(vehicle.id);
    await page.locator('#driver-id-search').fill(`TR${tag}`);
    await expect(page.locator(`#driver-id option[value="${driver.id}"]`)).toHaveCount(1);
    await page.locator('#driver-id').selectOption(driver.id);
    await page.locator('#driver-route').selectOption(route.id);
    await page.locator('#driver-start').fill(driverStart);
    await page.getByRole('button', { name: 'Assign driver' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Driver assignment created.' }),
    ).toBeVisible({ timeout: 20_000 });

    await page.locator('#student-id-search').fill(`TR${tag}`);
    await expect(page.locator(`#student-id option[value="${student.id}"]`)).toHaveCount(1);
    await page.locator('#student-id').selectOption(student.id);
    await page.locator('#student-route').selectOption(route.id);
    await page.locator('#student-stop').selectOption(stop.id);
    await page.locator('#student-start').fill(studentStart);
    await page.getByRole('button', { name: 'Assign student' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Student assignment created.' }),
    ).toBeVisible({ timeout: 20_000 });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expectScreen(page, 'Assignments');
    const driverRow = page
      .locator('li')
      .filter({ hasText: `${driver.name} · ${vehicle.registrationNumber}` });
    await expect(driverRow).toHaveCount(1);
    await expect(driverRow).toContainText(`from ${driverStart} · active`);
    const studentRow = page.locator('li').filter({ hasText: `${student.name} · ${route.name}` });
    await expect(studentRow).toHaveCount(1);
    await expect(studentRow).toContainText(`from ${studentStart} · active`);

    const drivers = await getJson<List<DriverAssignmentRow>>(
      request,
      `/transport/driver-assignments?vehicleId=${vehicle.id}`,
      P,
    );
    expect(drivers.data).toHaveLength(1);
    expect(drivers.data[0]).toMatchObject({
      driverId: driver.id,
      routeId: route.id,
      startDate: driverStart,
      isActive: true,
    });
    const students = await getJson<List<StudentAssignmentRow>>(
      request,
      `/transport/student-assignments?studentId=${student.id}`,
      P,
    );
    expect(students.data).toHaveLength(1);
    expect(students.data[0]).toMatchObject({
      routeId: route.id,
      stopId: stop.id,
      startDate: studentStart,
      isActive: true,
    });
    const links = await getJson<List<FeeLinkRow>>(request, '/transport/fee-links', P);
    expect(links.data.filter((l) => l.assignmentId === students.data[0]!.id)).toHaveLength(1);
  });

  test('/transport/attendance saves a trip mark through its form', async ({ page, request }) => {
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
    const st1 = await createStudent(request, { tag, n: 1 });
    const st2 = await createStudent(request, { tag, n: 2 });
    let tripDate = '';
    for (const student of [st1, st2]) {
      const startDate = await nextStartDate(request, 'student-assignments', [{ headers: P }]);
      await createStudentAssignment(request, P, {
        studentId: student.id,
        routeId: route.id,
        stopId: stop.id,
        startDate,
      });
      // The trip is on the latest start date, so both riders have started (T-D4).
      tripDate = startDate;
    }
    const trip = { routeId: route.id, tripDate, direction: 'pickup' as const };
    await markTrip(request, P, { ...trip, studentId: st1.id, status: 'boarded' });
    const query = `routeId=${route.id}&tripDate=${tripDate}&direction=pickup`;

    await openAs(page, principalUser(sub));
    await page.goto(`/transport/attendance?${query}`, { waitUntil: 'domcontentloaded' });
    await expectScreen(page, 'Bus attendance');
    await expect(page.getByText('1 boarded · 0 alighted · 0 absent · 1 unmarked')).toBeVisible();
    await hydrated(page, 'transport-attendance-form');
    await page.locator('#att-route').selectOption(route.id);
    await page.locator('#att-date').fill(tripDate);
    await page.locator('#att-dir').selectOption('pickup');
    await page.locator('#att-student').selectOption(st2.id);
    await page.locator('#att-status').selectOption('alighted');
    await page.getByRole('button', { name: 'Save mark' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Attendance saved.' })).toBeVisible({
      timeout: 20_000,
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('1 boarded · 1 alighted · 0 absent · 0 unmarked')).toBeVisible();

    const api = await getJson<{
      data: Array<{ studentId: string; status: string; recordedBy: string | null }>;
      summary: Record<string, number>;
    }>(request, `/transport/attendance?${query}`, P);
    expect(api.summary).toEqual({ boarded: 1, alighted: 1, absent: 0, unmarked: 0 });
    expect(api.data.find((r) => r.studentId === st2.id)).toMatchObject({
      status: 'alighted',
      recordedBy: sub,
    });
  });

  test('/transport/live registers a device and records a ping through its forms', async ({
    page,
    request,
  }) => {
    test.slow();
    const sub = randomUUID();
    const P = principalHeaders(TENANT_A, sub);
    const tag = newTag();
    const vehicle = await createVehicle(request, P, tag);
    const deviceId = `trdev-${tag.toLowerCase()}`;

    await openAs(page, principalUser(sub));
    await page.goto('/transport/live', { waitUntil: 'domcontentloaded' });
    await expectScreen(page, 'Live map');
    await hydrated(page, 'transport-device-form');
    await page.locator('#dev-vehicle').selectOption(vehicle.id);
    await page.locator('#dev-id').fill(deviceId);
    await page.getByRole('button', { name: 'Register device' }).click();
    await expect(page.getByTestId('transport-device-key')).toContainText(
      `Device ${deviceId} registered`,
      { timeout: 20_000 },
    );
    const deviceKey = await page.locator('#dev-key-value').inputValue();
    expect(deviceKey.length).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'I have stored it' }).click();
    await expect(page.getByTestId('transport-device-key')).toHaveCount(0);

    await page.locator('#gps-device').fill(deviceId);
    await page.locator('#gps-key').fill(deviceKey);
    await page.locator('#gps-ping').fill(`trping-${tag}`);
    await page.locator('#gps-lat').fill('19.0812');
    await page.locator('#gps-lng').fill('72.8811');
    await page.getByRole('button', { name: 'Send ping' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'GPS ping recorded.' })).toBeVisible({
      timeout: 20_000,
    });

    await page.reload({ waitUntil: 'domcontentloaded' });
    const bus = page.getByTestId('transport-live-bus').filter({
      hasText: vehicle.registrationNumber,
    });
    await expect(bus).toHaveCount(1);
    await expect(bus).toContainText(`${vehicle.registrationNumber} · 19.0812, 72.8811`);
    await expect(
      page.locator(
        `[data-testid="transport-live-bus-marker"][aria-label="Bus ${vehicle.registrationNumber} — open in OpenStreetMap"]`,
      ),
    ).toHaveCount(1);

    const live = await getJson<{
      vehicles: Array<{ vehicleId: string; latitude: number; longitude: number }>;
    }>(request, '/transport/live', P);
    expect(live.vehicles.find((v) => v.vehicleId === vehicle.id)).toMatchObject({
      latitude: 19.0812,
      longitude: 72.8811,
    });
    // The device row is stored: a second registration for the vehicle conflicts.
    const again = await attempt(request, 'POST', `/transport/vehicles/${vehicle.id}/device`, {}, P);
    expect(again.status).toBe(409);
  });

  test('/transport/alerts creates a rule, evaluates and acknowledges through its forms', async ({
    page,
    request,
  }) => {
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
    // "Evaluate now" always evaluates today (UTC), so the driver row starts today (T-D4).
    await createDriverAssignment(request, P, {
      vehicleId: vehicle.id,
      driverId: randomUUID(),
      routeId: route.id,
      startDate: todayIso(),
    });
    const device = await registerDevice(request, P, vehicle.id);
    // One degree north of the only stop: far outside the geofence.
    await sendPing(request, P, device, {
      pingId: `trping-${tag}`,
      latitude: 20.076,
      longitude: 72.8777,
    });

    await openAs(page, principalUser(sub));
    await page.goto('/transport/alerts', { waitUntil: 'domcontentloaded' });
    await expectScreen(page, 'Transport alerts');
    await hydrated(page, 'transport-alert-rule-form');
    await page.locator('#rule-kind').selectOption('geofence_exit');
    await page.locator('#rule-threshold').fill(String(threshold));
    await page.locator('#rule-route').selectOption(route.id);
    await page.getByRole('button', { name: 'Create rule' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Alert rule created.' })).toBeVisible({
      timeout: 20_000,
    });

    const rules = await getJson<List<AlertRuleRow>>(request, '/transport/alert-rules', P);
    const mine = rules.data.filter((r) => r.routeId === route.id);
    expect(mine).toHaveLength(1);
    const rule = mine[0]!;
    expect(rule).toMatchObject({
      kind: 'geofence_exit',
      threshold,
      channels: ['in_app'],
      isActive: true,
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await hydrated(page, 'transport-alert-rule-form');
    const ruleRows = page.locator('li').filter({ hasText: ' · threshold ' });
    await expect(ruleRows).toHaveCount(rules.data.length);
    await expect(ruleRows.nth(rules.data.indexOf(rule))).toContainText(
      `geofence_exit · threshold ${threshold}`,
    );

    await page.getByRole('button', { name: 'Evaluate now' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: /^Evaluated \d+ alert\(s\)\.$/ }),
    ).toBeVisible({ timeout: 20_000 });
    const evaluated = await getJson<List<AlertRow>>(request, '/transport/alerts', P);
    const alertIndex = evaluated.data.findIndex((a) => a.ruleId === rule.id);
    expect(alertIndex).toBeGreaterThanOrEqual(0);
    const alert = evaluated.data[alertIndex]!;
    expect(alert.message).toContain(`(geofence ${threshold} m)`);
    expect(alert.acknowledgedAt).toBeNull();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await hydrated(page, 'transport-alert-rule-form');
    const alertRows = page.getByTestId('transport-alert-row');
    await expect(alertRows).toHaveCount(evaluated.data.length);
    const alertRow = alertRows.nth(alertIndex);
    await expect(alertRow).toContainText(alert.message);
    await alertRow.getByRole('button', { name: 'Acknowledge' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Alert acknowledged.' })).toBeVisible({
      timeout: 20_000,
    });

    await page.reload({ waitUntil: 'domcontentloaded' });
    const after = await getJson<List<AlertRow>>(request, '/transport/alerts', P);
    const ackIndex = after.data.findIndex((a) => a.id === alert.id);
    const ackRow = page.getByTestId('transport-alert-row').nth(ackIndex);
    await expect(ackRow).toContainText(alert.message);
    await expect(ackRow).toContainText('geofence_exit · acknowledged');
    await expect(ackRow.getByRole('button', { name: 'Acknowledge' })).toHaveCount(0);
    const forRule = after.data.filter((a) => a.ruleId === rule.id);
    expect(forRule).toHaveLength(1);
    expect(forRule[0]!.acknowledgedAt).toBeTruthy();
    expect(forRule[0]!.acknowledgedBy).toBe(sub);
  });

  test('/transport/fees creates a fee band through its form', async ({ page, request }) => {
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
    const bandName = `TR Band ${tag}`;

    await openAs(page, principalUser(sub));
    await page.goto('/transport/fees', { waitUntil: 'domcontentloaded' });
    await expectScreen(page, 'Transport fees');
    await hydrated(page, 'transport-fee-form');
    await page.locator('#fee-name').fill(bandName);
    await page.locator('#fee-route').selectOption(route.id);
    await page.locator('#fee-stop').selectOption(stop.id);
    await page.locator('#fee-min').fill('0');
    await page.locator('#fee-max').fill('5');
    await page.locator('#fee-amount').fill('1234');
    await page.getByRole('button', { name: 'Create band' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Fee band created and linked to Fees.' }),
    ).toBeVisible({ timeout: 20_000 });

    await page.reload({ waitUntil: 'domcontentloaded' });
    const bandRow = page.locator('li').filter({ hasText: bandName });
    await expect(bandRow).toHaveCount(1);
    await expect(bandRow).toContainText('1234.00 INR · linked to Fees');

    const bands = await getJson<List<FeeBandRow>>(request, '/transport/fee-structures', P);
    const band = bands.data.find((b) => b.name === bandName);
    expect(band).toMatchObject({
      amountCents: 123_400,
      currency: 'INR',
      routeId: route.id,
      stopId: stop.id,
    });
    expect(band!.feesStructureId).toBeTruthy();
  });
});
