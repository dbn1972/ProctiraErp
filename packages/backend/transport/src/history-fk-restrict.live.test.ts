/**
 * PRC-M449 — hard deletes must not wipe transport history, and FK violations must not
 * surface as 500s. Real, migrated Postgres (runtime app role, RLS enforced).
 *
 * Before db/sql/265: transport_gps_pings.vehicle_id and transport_bus_attendance.route_id
 * were ON DELETE CASCADE, so deleting a vehicle/route silently deleted its pings and
 * attendance; other dependent FKs raised a raw 23503. After 265 the history FKs are
 * ON DELETE RESTRICT and the repository maps 23503 to ConflictError (409).
 *
 * Fails closed when CI=true or REQUIRE_LIVE_TESTS=1 and DATABASE_URL is unset (W3-TEST-03).
 */
import { randomUUID } from 'node:crypto';
import { ConflictError } from '@proctira/common';
import { withPgTenant } from '@proctira/database';
import { ensurePgTestStudent, ensurePgTestTenant } from '@proctira/database/test-fixtures';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgTransportRepository } from './pg-transport-repository.js';
import { TransportService } from './transport-service.js';

// Same contract as @proctira/testing requireLiveDatabaseUrl (not a dependency of this package).
const SUITE = 'history-fk-restrict.live.test';
const DATABASE_URL = process.env['DATABASE_URL']?.trim() || undefined;
const liveRequired =
  process.env['ALLOW_LIVE_TEST_SKIP'] !== '1' &&
  (process.env['REQUIRE_LIVE_TESTS'] === '1' ||
    process.env['CI'] === 'true' ||
    process.env['CI'] === '1');
if (!DATABASE_URL && liveRequired) {
  throw new Error(`[W3-TEST-03] Live suite "${SUITE}" has no DATABASE_URL.`);
}
if (!DATABASE_URL) console.warn(`WARNING: [W3-TEST-03] ${SUITE} skipped (no DATABASE_URL).`);

describe.skipIf(!DATABASE_URL)('PRC-M449 transport history FKs (live)', () => {
  let pool: pg.Pool;
  let repo: PgTransportRepository;
  let service: TransportService;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    repo = new PgTransportRepository(pool);
    service = new TransportService(repo);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seed() {
    const tenantId = randomUUID();
    await ensurePgTestTenant(pool, tenantId);
    const vehicleId = randomUUID();
    const routeId = randomUUID();
    const stopId = randomUUID();
    await repo.createVehicle({
      id: vehicleId,
      tenantId,
      registrationNumber: `KA-${vehicleId.slice(0, 8)}`,
      make: null,
      model: null,
      year: null,
      capacity: 40,
      status: 'active',
      insuranceExpiry: null,
      lastServiceDate: null,
    } as never);
    await repo.createRoute({
      id: routeId,
      tenantId,
      name: 'Route H',
      description: null,
      status: 'active',
      startLocation: 'A',
      endLocation: 'B',
      distanceKm: 5,
      estimatedDurationMinutes: 20,
      operatingDays: ['Mon'],
      departureTime: '07:30',
      returnTime: '15:30',
      institutionId: null,
    });
    await repo.createStop({
      id: stopId,
      tenantId,
      routeId,
      name: 'Stop 1',
      latitude: 12.9,
      longitude: 77.5,
      stopOrder: 1,
      pickupTime: '07:40',
      dropoffTime: '15:40',
    } as never);
    const studentId = randomUUID();
    await ensurePgTestStudent(pool, tenantId, studentId);
    return { tenantId, vehicleId, routeId, stopId, studentId };
  }

  async function count(tenantId: string, sql: string, params: unknown[]) {
    const res = await withPgTenant(pool, tenantId, (client) => client.query(sql, params));
    return (res.rows[0] as { n: number }).n;
  }

  it('deleting a vehicle with GPS pings is a ConflictError and keeps the pings', async () => {
    const fx = await seed();
    await withPgTenant(pool, fx.tenantId, (client) =>
      client.query(
        `INSERT INTO transport_gps_pings
           (id, tenant_id, vehicle_id, device_id, ping_id, latitude, longitude, recorded_at)
         VALUES ($1, $2, $3, 'dev-1', 'p-1', 12.9, 77.5, now())`,
        [randomUUID(), fx.tenantId, fx.vehicleId],
      ),
    );

    await expect(service.deleteVehicle(fx.tenantId, fx.vehicleId)).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(
      await count(
        fx.tenantId,
        `SELECT count(*)::int AS n FROM transport_gps_pings WHERE tenant_id = $1 AND vehicle_id = $2`,
        [fx.tenantId, fx.vehicleId],
      ),
    ).toBe(1);
  });

  it('deleting a route with bus attendance is a ConflictError and keeps the attendance', async () => {
    const fx = await seed();
    await withPgTenant(pool, fx.tenantId, (client) =>
      client.query(
        `INSERT INTO transport_bus_attendance
           (id, tenant_id, route_id, trip_date, direction, student_id, status)
         VALUES ($1, $2, $3, '2026-06-01', 'pickup', $4, 'boarded')`,
        [randomUUID(), fx.tenantId, fx.routeId, fx.studentId],
      ),
    );

    await expect(service.deleteRoute(fx.tenantId, fx.routeId)).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(
      await count(
        fx.tenantId,
        `SELECT count(*)::int AS n FROM transport_bus_attendance WHERE tenant_id = $1 AND route_id = $2`,
        [fx.tenantId, fx.routeId],
      ),
    ).toBe(1);
  });

  it('deleting a stop still referenced by an assignment is a ConflictError, not a raw 23503', async () => {
    const fx = await seed();
    await service.createStudentAssignment(
      fx.tenantId,
      { studentId: fx.studentId, routeId: fx.routeId, stopId: fx.stopId, startDate: '2026-06-01' },
      'actor',
    );
    await service.updateStudentAssignment(
      fx.tenantId,
      (await repo.findActiveStudentAssignment(fx.studentId, fx.tenantId))!.id,
      { isActive: false },
    );

    await expect(service.deleteStop(fx.tenantId, fx.stopId)).rejects.toBeInstanceOf(ConflictError);
  });

  it('a vehicle and route without history still delete', async () => {
    const fx = await seed();
    await service.deleteStop(fx.tenantId, fx.stopId);
    await service.deleteRoute(fx.tenantId, fx.routeId);
    await service.deleteVehicle(fx.tenantId, fx.vehicleId);
    expect(await repo.findVehicleById(fx.vehicleId, fx.tenantId)).toBeNull();
    expect(await repo.findRouteById(fx.routeId, fx.tenantId)).toBeNull();
  });
});
