/**
 * Transport screens — privacy and tenancy negatives.
 *
 * Student assignments and trip attendance are child data; live tracking is
 * location data. Each test first proves the hidden rows exist (positive
 * control with the owner's principal JWT), then checks one protection layer:
 *
 * - a staff role without transport access (teacher) gets no transport data
 *   from the gateway routes the screens call, cannot write, and sees none of
 *   the seeded rows on any of the 10 screens;
 * - a student gets no transport location or assignment data;
 * - another tenant's rows never appear on tenant A's screens or lists;
 * - tenant A cannot read or act on tenant B ids, even with a forged
 *   `X-Tenant-ID` header (the tenant comes from the JWT).
 *
 * These tests assert only that data is absent. They do not assert the copy a
 * denied role sees: transport has no route guard yet, so such a role gets the
 * normal empty states (defect T-D1, tracked for a separate fix).
 */
import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import {
  TENANT_A,
  TENANT_B,
  attempt,
  createDriverAssignment,
  createFeeBand,
  createGeofenceRule,
  createRoute,
  createStop,
  createStudent,
  createStudentAssignment,
  createVehicle,
  evaluateAlerts,
  geofenceThreshold,
  getJson,
  markTrip,
  newTag,
  nextStartDate,
  openAs,
  principalHeaders,
  principalUser,
  rank,
  registerDevice,
  sendPing,
  studentHeaders,
  studentUser,
  teacherHeaders,
  teacherUser,
  todayIso,
  type AlertRow,
  type FeeBandRow,
  type FeeLinkRow,
  type Headers,
  type RouteRow,
  type StopRow,
  type StudentAssignmentRow,
  type VehicleRow,
} from './fixtures/transport-screens';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

/** The tenant whose rows tenant A must never see. */
const OTHER_TENANT = TENANT_B;

type List<T> = { data: T[] };
type Live = {
  vehicles: Array<{ vehicleId: string; latitude: number; longitude: number }>;
  stops: Array<{ id: string }>;
};
type Trip = { assigned: number; summary: Record<string, number> };

/**
 * Opens `path` and returns the rendered body text once the page has loaded.
 * Waits for the page heading or the access-denied card, so it holds both today
 * (no transport route guard, defect T-D1) and after a guard is added.
 */
async function screenText(page: Page, path: string): Promise<string> {
  await page.goto(path, { waitUntil: 'load' });
  await expect(
    page.getByRole('heading', { level: 1 }).or(page.getByTestId('route-access-denied')).first(),
  ).toBeVisible({ timeout: 20_000 });
  return page.locator('body').innerText();
}

function expectAbsent(text: string, where: string, values: string[]): void {
  for (const value of values) {
    expect(text.includes(value), `${where} must not show ${value}`).toBe(false);
  }
}

/** Every id in `ids` is absent from the list body. */
function expectIdsAbsent(rows: Array<{ id?: string }>, where: string, ids: string[]): void {
  const present = new Set(rows.map((r) => r.id));
  for (const id of ids) expect(present.has(id), `${where} must not list ${id}`).toBe(false);
}

/**
 * A full set of transport rows in the other tenant, written by that tenant's
 * principal, with a positive control proving each row is readable there.
 */
async function seedOtherTenant(request: Parameters<typeof createRoute>[0], tag: string) {
  const PB = principalHeaders(OTHER_TENANT, randomUUID());
  const PA = principalHeaders(TENANT_A, randomUUID());
  const both = [{ headers: PA }, { headers: PB }];
  const today = todayIso();
  // Per-run coordinates: leftover rows in tenant A can never carry this pair.
  const n = 1000 + (parseInt(tag.slice(0, 4), 16) % 9000);
  const m = 1000 + (parseInt(tag.slice(4, 8), 16) % 9000);
  const ping = { latitude: 13 + n / 10_000, longitude: 77 + m / 10_000 };
  const pingText = `${ping.latitude.toFixed(4)}, ${ping.longitude.toFixed(4)}`;
  const route = await createRoute(request, PB, tag);
  const stop = await createStop(request, PB, {
    routeId: route.id,
    name: `TRB Stop ${tag}`,
    stopOrder: 1,
    latitude: 12 + n / 10_000,
    longitude: 76 + m / 10_000,
  });
  const vehicle = await createVehicle(request, PB, tag);
  const device = await registerDevice(request, PB, vehicle.id);
  await sendPing(request, PB, device, { pingId: `trbping-${tag}`, ...ping });
  const driverAssignment = await createDriverAssignment(request, PB, {
    vehicleId: vehicle.id,
    driverId: randomUUID(),
    routeId: route.id,
    startDate: await nextStartDate(request, 'driver-assignments', both),
  });
  const student = await createStudent(request, { tag, n: 1, tenantId: OTHER_TENANT });
  const band = await createFeeBand(request, PB, {
    name: `TRB Band ${tag}`,
    routeId: route.id,
    stopId: stop.id,
    amountCents: 150_000,
  });
  const studentAssignment = await createStudentAssignment(request, PB, {
    studentId: student.id,
    routeId: route.id,
    stopId: stop.id,
    startDate: await nextStartDate(request, 'student-assignments', both),
  });
  const trip = { routeId: route.id, tripDate: today, direction: 'pickup' as const };
  await markTrip(request, PB, { ...trip, studentId: student.id, status: 'boarded' });
  // The ping is about 150 km from the stop; the per-run threshold makes the message unique.
  const rule = await createGeofenceRule(request, PB, {
    routeId: route.id,
    threshold: geofenceThreshold(tag),
  });
  const evaluated = await evaluateAlerts(request, PB, route.id);
  const alert = evaluated.data.find((a) => a.ruleId === rule.id);
  expect(alert, 'the other tenant has a geofence alert').toBeTruthy();
  const tripQuery = `routeId=${route.id}&tripDate=${today}&direction=pickup`;

  // Positive control: the other tenant's principal sees every row.
  const routes = await getJson<List<RouteRow>>(request, '/transport/routes', PB);
  expect(routes.data[0]?.id).toBe(route.id);
  const vehicles = await getJson<List<VehicleRow>>(request, '/transport/vehicles', PB);
  expect(vehicles.data[0]?.id).toBe(vehicle.id);
  const live = await getJson<Live>(request, '/transport/live', PB);
  expect(live.vehicles.some((v) => v.vehicleId === vehicle.id)).toBe(true);
  expect(live.stops.some((s) => s.id === stop.id)).toBe(true);
  const drivers = await getJson<List<{ id: string }>>(request, '/transport/driver-assignments', PB);
  expect(drivers.data[0]?.id).toBe(driverAssignment.id);
  const riders = await getJson<List<StudentAssignmentRow>>(
    request,
    '/transport/student-assignments',
    PB,
  );
  expect(riders.data[0]?.id).toBe(studentAssignment.id);
  const tripRow = await getJson<Trip>(request, `/transport/attendance?${tripQuery}`, PB);
  expect(tripRow.summary.boarded).toBe(1);
  const alerts = await getJson<List<AlertRow>>(request, '/transport/alerts', PB);
  expect(alerts.data.some((a) => a.id === alert!.id && a.acknowledgedAt === null)).toBe(true);
  const bands = await getJson<List<FeeBandRow>>(request, '/transport/fee-structures', PB);
  expect(bands.data.some((b) => b.id === band.id)).toBe(true);
  const links = await getJson<List<FeeLinkRow>>(request, '/transport/fee-links', PB);
  expect(links.data.some((l) => l.assignmentId === studentAssignment.id)).toBe(true);

  return {
    PB,
    route,
    stop,
    vehicle,
    device,
    student,
    band,
    alert: alert!,
    rule,
    driverAssignment,
    studentAssignment,
    tripQuery,
    ping,
    pingText,
  };
}

test.describe('Transport screens — privacy and tenancy (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1 and a live gateway + Postgres');

  test('a staff role without transport access (teacher) cannot read or write transport data', async ({
    page,
    request,
  }) => {
    test.slow();
    const P = principalHeaders(TENANT_A, randomUUID());
    const tag = newTag();
    const today = todayIso();
    const route = await createRoute(request, P, tag);
    const stop = await createStop(request, P, {
      routeId: route.id,
      name: `TR Stop ${tag} 1`,
      stopOrder: 1,
      latitude: 19.0701,
      longitude: 72.8701,
    });
    const vehicle = await createVehicle(request, P, tag);
    const student = await createStudent(request, { tag, n: 1 });
    const assignment = await createStudentAssignment(request, P, {
      studentId: student.id,
      routeId: route.id,
      stopId: stop.id,
      startDate: await nextStartDate(request, 'student-assignments', [{ headers: P }]),
    });
    const tripQuery = `routeId=${route.id}&tripDate=${today}&direction=pickup`;
    await markTrip(request, P, {
      routeId: route.id,
      tripDate: today,
      direction: 'pickup',
      studentId: student.id,
      status: 'boarded',
    });
    await createDriverAssignment(request, P, {
      vehicleId: vehicle.id,
      driverId: randomUUID(),
      routeId: route.id,
      startDate: await nextStartDate(request, 'driver-assignments', [{ headers: P }]),
    });
    const device = await registerDevice(request, P, vehicle.id);
    await sendPing(request, P, device, {
      pingId: `trping-${tag}`,
      latitude: 20.0701,
      longitude: 72.8701,
    });
    const rule = await createGeofenceRule(request, P, {
      routeId: route.id,
      threshold: geofenceThreshold(tag),
    });
    const alert = (await evaluateAlerts(request, P, route.id)).data.find(
      (a) => a.ruleId === rule.id,
    );
    expect(alert).toBeTruthy();
    const band = await createFeeBand(request, P, {
      name: `TR Band ${tag}`,
      routeId: route.id,
      stopId: stop.id,
      amountCents: 99_900,
    });

    // Positive control: the principal sees every seeded row.
    expect((await getJson<List<RouteRow>>(request, '/transport/routes', P)).data[0]?.id).toBe(
      route.id,
    );
    expect((await getJson<List<VehicleRow>>(request, '/transport/vehicles', P)).data[0]?.id).toBe(
      vehicle.id,
    );
    expect(
      (
        await getJson<List<StudentAssignmentRow>>(
          request,
          `/transport/student-assignments?studentId=${student.id}`,
          P,
        )
      ).data.map((a) => a.id),
    ).toEqual([assignment.id]);
    expect((await getJson<Trip>(request, `/transport/attendance?${tripQuery}`, P)).summary).toEqual(
      { boarded: 1, alighted: 0, absent: 0, unmarked: 0 },
    );
    const live = await getJson<Live>(request, '/transport/live', P);
    expect(live.vehicles.some((v) => v.vehicleId === vehicle.id)).toBe(true);

    const secrets = [route.id, route.name, vehicle.registrationNumber, student.id, stop.name];
    const T = teacherHeaders(randomUUID());

    // (1) Every read the screens make is denied, with no seeded value in the body.
    const reads = [
      '/transport/routes',
      `/transport/routes/${route.id}`,
      `/transport/routes/${route.id}/stops`,
      '/transport/stops',
      '/transport/vehicles',
      '/transport/driver-assignments',
      '/transport/student-assignments',
      `/transport/attendance?${tripQuery}`,
      '/transport/live',
      '/transport/alert-rules',
      '/transport/alerts',
      '/transport/fee-structures',
      '/transport/fee-links',
    ];
    for (const path of reads) {
      const res = await attempt(request, 'GET', path, undefined, T);
      expect(res.status, `teacher GET ${path}`).toBe(403);
      expectAbsent(res.body, `teacher GET ${path}`, secrets);
    }

    // (2) Every write the screens make is denied.
    const teacherRegistration = `${rank()}-TT${tag}`;
    const writes: Array<[method: 'POST' | 'DELETE', path: string, body: unknown]> = [
      [
        'POST',
        '/transport/routes',
        {
          name: `${rank()} TT Route ${tag}`,
          startLocation: 'A',
          endLocation: 'B',
          operatingDays: ['monday'],
        },
      ],
      ['POST', '/transport/stops', { routeId: route.id, name: `TT Stop ${tag}`, stopOrder: 2 }],
      ['DELETE', `/transport/stops/${stop.id}`, undefined],
      ['POST', '/transport/vehicles', { registrationNumber: teacherRegistration, capacity: 10 }],
      [
        'POST',
        '/transport/driver-assignments',
        { vehicleId: vehicle.id, driverId: randomUUID(), startDate: today },
      ],
      [
        'POST',
        '/transport/student-assignments',
        { studentId: student.id, routeId: route.id, startDate: today },
      ],
      ['POST', `/transport/vehicles/${vehicle.id}/device`, {}],
      [
        'POST',
        '/transport/attendance',
        {
          routeId: route.id,
          tripDate: today,
          direction: 'pickup',
          studentId: student.id,
          status: 'absent',
        },
      ],
      ['POST', '/transport/alert-rules', { kind: 'delay_minutes', threshold: 5 }],
      ['POST', '/transport/alerts/evaluate', { routeId: route.id }],
      ['POST', `/transport/alerts/${alert!.id}/acknowledge`, {}],
      [
        'POST',
        '/transport/fee-structures',
        { name: `TT Band ${tag}`, amountCents: 100, currency: 'INR' },
      ],
    ];
    for (const [method, path, body] of writes) {
      const res = await attempt(request, method, path, body, T);
      expect(res.status, `teacher ${method} ${path}`).toBe(403);
    }
    const stops = await getJson<List<StopRow>>(request, `/transport/routes/${route.id}/stops`, P);
    expect(stops.data.map((s) => s.id)).toEqual([stop.id]);
    const alerts = await getJson<List<AlertRow>>(request, '/transport/alerts', P);
    expect(alerts.data.find((a) => a.id === alert!.id)?.acknowledgedAt).toBeNull();
    const trip = await getJson<Trip>(request, `/transport/attendance?${tripQuery}`, P);
    expect(trip.summary.boarded).toBe(1);
    const fleet = await getJson<List<VehicleRow>>(request, '/transport/vehicles', P);
    expect(fleet.data.some((v) => v.registrationNumber === teacherRegistration)).toBe(false);
    const bands = await getJson<List<FeeBandRow>>(request, '/transport/fee-structures', P);
    expect(bands.data.some((b) => b.name === `TT Band ${tag}`)).toBe(false);

    // (3) None of the 10 screens shows a seeded row to the teacher.
    const onScreen = [
      route.name,
      vehicle.registrationNumber,
      student.name,
      stop.name,
      band.name,
      '20.0701',
      alert!.message,
    ];
    await openAs(page, teacherUser(randomUUID()));
    const screens = [
      '/transport',
      '/transport/routes',
      '/transport/routes/new',
      `/transport/routes/${route.id}/stops`,
      '/transport/vehicles',
      '/transport/assignments',
      `/transport/attendance?${tripQuery}`,
      '/transport/live',
      '/transport/alerts',
      '/transport/fees',
    ];
    for (const path of screens) {
      // The student's name is not checked on /transport/assignments: today that
      // screen loads the student directory (`GET /students`, which a teacher may
      // read) into its picker (defect T-D1). The transport assignment row must
      // still be absent.
      const hidden =
        path === '/transport/assignments' ? onScreen.filter((v) => v !== student.name) : onScreen;
      expectAbsent(await screenText(page, path), `teacher screen ${path}`, hidden);
      if (path === '/transport/assignments') {
        await expect(page.locator('li').filter({ hasText: student.name })).toHaveCount(0);
      }
    }
    await page.goto('/transport/routes', { waitUntil: 'load' });
    await expect(page.getByTestId('transport-route-row')).toHaveCount(0);
    await page.goto('/transport/live', { waitUntil: 'load' });
    await expect(page.getByTestId('transport-live-bus')).toHaveCount(0);
    await page.goto('/transport/alerts', { waitUntil: 'load' });
    await expect(page.getByTestId('transport-alert-row')).toHaveCount(0);
    await page.goto(`/transport/attendance?${tripQuery}`, { waitUntil: 'load' });
    await expect(page.getByText('1 boarded')).toHaveCount(0);
    await page.goto('/transport/vehicles', { waitUntil: 'load' });
    await expect(page.getByTestId('transport-vehicle-row')).toHaveCount(0);
  });

  test('a student cannot read transport location or assignment data', async ({ page, request }) => {
    test.slow();
    const P = principalHeaders(TENANT_A, randomUUID());
    const tag = newTag();
    const today = todayIso();
    const student = await createStudent(request, { tag, n: 1 });
    const route = await createRoute(request, P, tag);
    const stop = await createStop(request, P, {
      routeId: route.id,
      name: `TR Stop ${tag} 1`,
      stopOrder: 1,
      latitude: 19.0803,
      longitude: 72.8804,
    });
    const assignment = await createStudentAssignment(request, P, {
      studentId: student.id,
      routeId: route.id,
      stopId: stop.id,
      startDate: await nextStartDate(request, 'student-assignments', [{ headers: P }]),
    });
    const vehicle = await createVehicle(request, P, tag);
    const device = await registerDevice(request, P, vehicle.id);
    await sendPing(request, P, device, {
      pingId: `trping-${tag}`,
      latitude: 19.0805,
      longitude: 72.8806,
    });

    // Positive control: the principal sees the bus and the child's assignment.
    const live = await getJson<Live>(request, '/transport/live', P);
    expect(live.vehicles.find((v) => v.vehicleId === vehicle.id)).toMatchObject({
      latitude: 19.0805,
      longitude: 72.8806,
    });
    const own = await getJson<List<StudentAssignmentRow>>(
      request,
      `/transport/student-assignments?studentId=${student.id}`,
      P,
    );
    expect(own.data.map((a) => a.id)).toEqual([assignment.id]);

    const S: Headers = studentHeaders(student.id);
    const secrets = [vehicle.id, vehicle.registrationNumber, route.name, stop.name, '19.0805'];
    const reads = [
      '/transport/live',
      `/transport/student-assignments?studentId=${student.id}`,
      `/transport/attendance?routeId=${route.id}&tripDate=${today}&direction=pickup`,
      `/transport/vehicles/${vehicle.id}/gps`,
      '/transport/routes',
      '/transport/stops',
    ];
    for (const path of reads) {
      const res = await attempt(request, 'GET', path, undefined, S);
      expect(res.status, `student GET ${path}`).toBe(403);
      expectAbsent(res.body, `student GET ${path}`, secrets);
    }

    await openAs(page, studentUser(student.id));
    await page.goto('/transport/live', { waitUntil: 'load' });
    await expect(page.getByTestId('transport-live-bus')).toHaveCount(0);
    expectAbsent(await page.locator('body').innerText(), 'student /transport/live', [
      vehicle.registrationNumber,
      stop.name,
      '19.0805',
    ]);
  });

  test('another tenant’s transport data never appears on tenant A’s screens', async ({
    page,
    request,
  }) => {
    test.slow();
    const tag = newTag();
    const b = await seedOtherTenant(request, tag);
    const sub = randomUUID();
    const P = principalHeaders(TENANT_A, sub);
    const bIds = [
      b.route.id,
      b.stop.id,
      b.vehicle.id,
      b.driverAssignment.id,
      b.studentAssignment.id,
      b.alert.id,
      b.rule.id,
      b.band.id,
    ];

    await openAs(page, principalUser(sub));
    expectAbsent(await screenText(page, '/transport/routes'), '/transport/routes', [b.route.name]);
    expectAbsent(await screenText(page, '/transport/vehicles'), '/transport/vehicles', [
      b.vehicle.registrationNumber,
    ]);
    expectAbsent(await screenText(page, '/transport/assignments'), '/transport/assignments', [
      b.vehicle.registrationNumber,
      b.student.name,
      b.route.name,
      b.stop.name,
    ]);
    for (const id of [b.route.id, b.vehicle.id, b.stop.id, b.student.id]) {
      await expect(page.locator(`option[value="${id}"]`)).toHaveCount(0);
    }
    expectAbsent(await screenText(page, '/transport/live'), '/transport/live', [
      b.vehicle.registrationNumber,
      `Vehicle ${b.vehicle.id.slice(0, 8)}`,
      b.pingText,
      b.stop.name,
    ]);
    await expect(
      page.locator(`[aria-label="Stop ${b.stop.name} — open in OpenStreetMap"]`),
    ).toHaveCount(0);
    expectAbsent(await screenText(page, '/transport/alerts'), '/transport/alerts', [
      b.alert.message,
      b.route.name,
    ]);
    await expect(page.locator(`option[value="${b.route.id}"]`)).toHaveCount(0);
    expectAbsent(await screenText(page, '/transport/fees'), '/transport/fees', [
      b.band.name,
      b.stop.name,
      b.route.name,
    ]);
    await expect(page.locator(`option[value="${b.stop.id}"]`)).toHaveCount(0);
    expectAbsent(
      await screenText(page, `/transport/attendance?${b.tripQuery}`),
      '/transport/attendance',
      ['1 boarded', b.student.name, b.route.name],
    );
    await expect(page.locator(`option[value="${b.student.id}"]`)).toHaveCount(0);
    await page.goto(`/transport/routes/${b.route.id}/stops`, { waitUntil: 'load' });
    await expect(page.getByTestId('transport-stop-row')).toHaveCount(0);
    expectAbsent(await page.locator('body').innerText(), 'stops of the other tenant’s route', [
      b.route.name,
      b.stop.name,
    ]);

    // The lists the screens call exclude every other-tenant id.
    const lists = [
      '/transport/routes',
      '/transport/vehicles',
      '/transport/stops',
      '/transport/driver-assignments',
      '/transport/student-assignments',
      '/transport/alert-rules',
      '/transport/alerts',
      '/transport/fee-structures',
    ];
    for (const path of lists) {
      const body = await getJson<List<{ id: string }>>(request, path, P);
      expectIdsAbsent(body.data, `GET ${path}`, bIds);
    }
    const links = await getJson<List<FeeLinkRow>>(request, '/transport/fee-links', P);
    expect(links.data.some((l) => l.assignmentId === b.studentAssignment.id)).toBe(false);
    const live = await getJson<Live>(request, '/transport/live', P);
    expect(live.vehicles.some((v) => v.vehicleId === b.vehicle.id)).toBe(false);
    expect(live.stops.some((s) => s.id === b.stop.id)).toBe(false);
  });

  test('tenant A cannot act on tenant B ids, even with a forged X-Tenant-ID', async ({
    request,
  }) => {
    test.slow();
    const tag = newTag();
    const b = await seedOtherTenant(request, tag);
    const P = principalHeaders(TENANT_A, randomUUID());
    const forged = { ...P, 'X-Tenant-ID': OTHER_TENANT };
    const today = todayIso();

    const forgedRoutes = await getJson<List<RouteRow>>(request, '/transport/routes', forged);
    expect(forgedRoutes.data.some((r) => r.id === b.route.id)).toBe(false);
    const forgedLive = await getJson<Live>(request, '/transport/live', forged);
    expect(forgedLive.vehicles.some((v) => v.vehicleId === b.vehicle.id)).toBe(false);

    const reads = [
      `/transport/routes/${b.route.id}`,
      `/transport/routes/${b.route.id}/stops`,
      `/transport/vehicles/${b.vehicle.id}`,
      `/transport/attendance?${b.tripQuery}`,
    ];
    for (const path of reads) {
      const res = await attempt(request, 'GET', path, undefined, P);
      expect(res.status, `tenant A GET ${path}`).toBe(404);
      expectAbsent(res.body, `tenant A GET ${path}`, [b.route.name, b.vehicle.registrationNumber]);
    }

    const writes: Array<[method: 'POST' | 'DELETE', path: string, body: unknown]> = [
      ['POST', '/transport/stops', { routeId: b.route.id, name: `TRA Stop ${tag}`, stopOrder: 2 }],
      ['DELETE', `/transport/stops/${b.stop.id}`, undefined],
      [
        'POST',
        '/transport/attendance',
        {
          routeId: b.route.id,
          tripDate: today,
          direction: 'pickup',
          studentId: b.student.id,
          status: 'absent',
        },
      ],
      [
        'POST',
        '/transport/student-assignments',
        { studentId: b.student.id, routeId: b.route.id, startDate: today },
      ],
      ['POST', `/transport/vehicles/${b.vehicle.id}/device`, {}],
      ['POST', `/transport/alerts/${b.alert.id}/acknowledge`, {}],
    ];
    for (const [method, path, body] of writes) {
      const res = await attempt(request, method, path, body, P);
      expect(res.status, `tenant A ${method} ${path}`).toBe(404);
    }
    const gps = await attempt(
      request,
      'POST',
      '/transport/gps',
      {
        deviceId: b.device.deviceId,
        pings: [{ pingId: `tra-${tag}`, latitude: 1.5, longitude: 1.5 }],
      },
      { ...P, 'X-Transport-Device-Key': b.device.deviceKey },
    );
    expect(gps.status, 'tenant A POST /transport/gps with a tenant B device').toBe(404);

    // The other tenant's rows are unchanged.
    const stops = await getJson<List<StopRow>>(
      request,
      `/transport/routes/${b.route.id}/stops`,
      b.PB,
    );
    expect(stops.data.map((s) => s.id)).toEqual([b.stop.id]);
    const alerts = await getJson<List<AlertRow>>(request, '/transport/alerts', b.PB);
    expect(alerts.data.find((a) => a.id === b.alert.id)?.acknowledgedAt).toBeNull();
    const live = await getJson<Live>(request, '/transport/live', b.PB);
    expect(live.vehicles.find((v) => v.vehicleId === b.vehicle.id)).toMatchObject(b.ping);
    const riders = await getJson<List<StudentAssignmentRow>>(
      request,
      `/transport/student-assignments?studentId=${b.student.id}`,
      b.PB,
    );
    expect(riders.data.map((a) => a.id)).toEqual([b.studentAssignment.id]);
    const trip = await getJson<Trip>(request, `/transport/attendance?${b.tripQuery}`, b.PB);
    expect(trip.summary).toEqual({ boarded: 1, alighted: 0, absent: 0, unmarked: 0 });
  });
});
