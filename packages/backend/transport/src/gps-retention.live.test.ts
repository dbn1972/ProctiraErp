/**
 * PRC-M451 (DR35) on a migrated Postgres as the runtime app role (RLS on):
 * the retention sweep enumerates tenants under platform scope and erases each
 * tenant's pings older than 90 days with the tenant GUC bound; newer pings and
 * other tenants' recent pings stay. History reads are bounded to the window.
 *
 * Fails closed when CI=true or REQUIRE_LIVE_TESTS=1 and DATABASE_URL is unset (W3-TEST-03).
 */
import { randomUUID } from 'node:crypto';
import { withPgTenant } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgTransportRepository } from './pg-transport-repository.js';
import { TransportService } from './transport-service.js';

const SUITE = 'gps-retention.live.test';
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

const NOW = new Date('2026-06-01T08:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

describe.skipIf(!DATABASE_URL)('PRC-M451 GPS retention (live)', () => {
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

  async function seedVehicle(tenantId: string) {
    await ensurePgTestTenant(pool, tenantId);
    const vehicleId = randomUUID();
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
    return vehicleId;
  }

  async function ping(tenantId: string, vehicleId: string, at: Date) {
    await withPgTenant(pool, tenantId, (client) =>
      client.query(
        `INSERT INTO transport_gps_pings
           (id, tenant_id, vehicle_id, device_id, ping_id, latitude, longitude, recorded_at)
         VALUES ($1, $2, $3, 'dev-1', $4, 12.9, 77.5, $5)`,
        [randomUUID(), tenantId, vehicleId, randomUUID(), at],
      ),
    );
  }

  async function recordedAt(tenantId: string, vehicleId: string) {
    const res = await withPgTenant(pool, tenantId, (client) =>
      client.query(
        `SELECT recorded_at FROM transport_gps_pings
         WHERE tenant_id = $1 AND vehicle_id = $2 ORDER BY recorded_at`,
        [tenantId, vehicleId],
      ),
    );
    return (res.rows as Array<{ recorded_at: Date }>).map((r) => r.recorded_at.toISOString());
  }

  it('erases only pings past 90 days, in every tenant', async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const vehicleA = await seedVehicle(tenantA);
    const vehicleB = await seedVehicle(tenantB);
    await ping(tenantA, vehicleA, daysAgo(120));
    await ping(tenantA, vehicleA, daysAgo(5));
    await ping(tenantB, vehicleB, daysAgo(91));
    await ping(tenantB, vehicleB, daysAgo(89));

    const result = await service.runGpsRetentionSweep(NOW);
    expect(result.failures).toEqual([]);
    expect(result.erased).toBeGreaterThanOrEqual(2);
    expect(await recordedAt(tenantA, vehicleA)).toEqual([daysAgo(5).toISOString()]);
    expect(await recordedAt(tenantB, vehicleB)).toEqual([daysAgo(89).toISOString()]);
  });

  it('history and the live map read only inside the window', async () => {
    const tenantId = randomUUID();
    const vehicleId = await seedVehicle(tenantId);
    await ping(tenantId, vehicleId, daysAgo(100));
    expect(await service.listVehicleGpsHistory(tenantId, vehicleId, NOW)).toEqual([]);
    const latest = await repo.listLatestGpsPingPerVehicle(tenantId, daysAgo(90));
    expect(latest).toEqual([]);
  });
});
