/**
 * PRC-M447 — one active driver assignment per vehicle and one active route assignment per
 * student, on a real, migrated Postgres (runtime app role, RLS enforced).
 *
 * The service rule was check-then-insert, and PUT { isActive: true } re-activated an
 * assignment without re-checking. db/sql/264 adds partial unique indexes
 * (tenant_id, vehicle_id) / (tenant_id, student_id) WHERE is_active; the repository maps
 * their 23505 to ConflictError, and the update paths re-run the active check.
 *
 * Fails closed when CI=true or REQUIRE_LIVE_TESTS=1 and DATABASE_URL is unset (W3-TEST-03).
 */
import { randomUUID } from 'node:crypto';
import { BusinessRuleError, ConflictError } from '@proctira/common';
import { withPgTenant } from '@proctira/database';
import { ensurePgTestStudent, ensurePgTestTenant } from '@proctira/database/test-fixtures';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgTransportRepository } from './pg-transport-repository.js';
import { TransportService } from './transport-service.js';

// Same contract as @proctira/testing requireLiveDatabaseUrl (not a dependency of this package).
const SUITE = 'active-assignment-unique.live.test';
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

describe.skipIf(!DATABASE_URL)('PRC-M447 one active assignment (live)', () => {
  let pool: pg.Pool;
  let repo: PgTransportRepository;
  let service: TransportService;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 12 });
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
      name: 'Route 1',
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
    const studentId = randomUUID();
    await ensurePgTestStudent(pool, tenantId, studentId);
    return { tenantId, vehicleId, routeId, studentId };
  }

  async function activeCount(tenantId: string, table: string, column: string, value: string) {
    const res = await withPgTenant(pool, tenantId, (client) =>
      client.query(
        `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1 AND ${column} = $2 AND is_active`,
        [tenantId, value],
      ),
    );
    return (res.rows[0] as { n: number }).n;
  }

  it('concurrent driver assignments for one vehicle leave one active row', async () => {
    const fx = await seed();
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        service.createDriverAssignment(fx.tenantId, {
          vehicleId: fx.vehicleId,
          driverId: randomUUID(),
          startDate: '2026-06-01',
        }),
      ),
    );
    expect(
      await activeCount(fx.tenantId, 'transport_driver_assignments', 'vehicle_id', fx.vehicleId),
    ).toBe(1);
    for (const r of results) {
      if (r.status === 'rejected') {
        expect(r.reason instanceof ConflictError || r.reason instanceof BusinessRuleError).toBe(
          true,
        );
      }
    }
  });

  it('concurrent route assignments for one student leave one active row', async () => {
    const fx = await seed();
    await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        service.createStudentAssignment(
          fx.tenantId,
          { studentId: fx.studentId, routeId: fx.routeId, startDate: '2026-06-01' },
          'actor',
        ),
      ),
    );
    expect(
      await activeCount(fx.tenantId, 'transport_student_assignments', 'student_id', fx.studentId),
    ).toBe(1);
  });

  it('PUT isActive=true on a second driver assignment is rejected', async () => {
    const fx = await seed();
    const first = await service.createDriverAssignment(fx.tenantId, {
      vehicleId: fx.vehicleId,
      driverId: randomUUID(),
      startDate: '2026-06-01',
    });
    await service.updateDriverAssignment(fx.tenantId, first.id, { isActive: false });
    await service.createDriverAssignment(fx.tenantId, {
      vehicleId: fx.vehicleId,
      driverId: randomUUID(),
      startDate: '2026-06-02',
    });

    await expect(
      service.updateDriverAssignment(fx.tenantId, first.id, { isActive: true }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    expect(
      await activeCount(fx.tenantId, 'transport_driver_assignments', 'vehicle_id', fx.vehicleId),
    ).toBe(1);
  });

  it('PUT isActive=true on a second student assignment is rejected', async () => {
    const fx = await seed();
    const first = await service.createStudentAssignment(
      fx.tenantId,
      { studentId: fx.studentId, routeId: fx.routeId, startDate: '2026-06-01' },
      'actor',
    );
    await service.updateStudentAssignment(fx.tenantId, first.id, { isActive: false });
    await service.createStudentAssignment(
      fx.tenantId,
      { studentId: fx.studentId, routeId: fx.routeId, startDate: '2026-06-02' },
      'actor',
    );

    await expect(
      service.updateStudentAssignment(fx.tenantId, first.id, { isActive: true }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    expect(
      await activeCount(fx.tenantId, 'transport_student_assignments', 'student_id', fx.studentId),
    ).toBe(1);
  });

  it('the database rejects a second active row even when the service check is bypassed', async () => {
    const fx = await seed();
    const first = await service.createDriverAssignment(fx.tenantId, {
      vehicleId: fx.vehicleId,
      driverId: randomUUID(),
      startDate: '2026-06-01',
    });
    await service.updateDriverAssignment(fx.tenantId, first.id, { isActive: false });
    await service.createDriverAssignment(fx.tenantId, {
      vehicleId: fx.vehicleId,
      driverId: randomUUID(),
      startDate: '2026-06-02',
    });
    // Repository write, no service check: the 264 index answers with ConflictError (409).
    await expect(
      repo.updateDriverAssignment(first.id, fx.tenantId, { isActive: true }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
