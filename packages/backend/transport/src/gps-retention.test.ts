/**
 * PRC-M451 (DR35): transport GPS pings are kept 90 days, then erased. The
 * retention sweep erases older pings per tenant, the live map never shows a
 * position past the window, and vehicle ping history is bounded.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InMemoryTransportRepository } from './in-memory-repository.js';
import { gpsRetentionSweepSettings } from './transport-plugin.js';
import {
  GPS_HISTORY_MAX_ROWS,
  GPS_RETENTION_DAYS,
  TransportService,
  gpsRetentionCutoff,
} from './transport-service.js';

const NOW = new Date('2026-06-01T08:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

async function setup() {
  const repo = new InMemoryTransportRepository();
  const service = new TransportService(repo);
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const vehicleA = randomUUID();
  const ping = (tenantId: string, vehicleId: string, at: Date, pingId = randomUUID()) =>
    repo.ingestGpsPing({
      id: randomUUID(),
      tenantId,
      vehicleId,
      deviceId: 'dev-1',
      pingId,
      latitude: 12.97,
      longitude: 77.59,
      recordedAt: at,
      speedKph: null,
      headingDeg: null,
    });
  return { repo, service, tenantA, tenantB, vehicleA, ping };
}

describe('PRC-M451 transport GPS retention (DR35)', () => {
  it('keeps 90 days', () => {
    expect(GPS_RETENTION_DAYS).toBe(90);
    expect(gpsRetentionCutoff(NOW)).toEqual(daysAgo(90));
  });

  it('the sweep erases pings older than 90 days in every tenant and keeps newer ones', async () => {
    const { repo, service, tenantA, tenantB, vehicleA, ping } = await setup();
    await ping(tenantA, vehicleA, daysAgo(120));
    await ping(tenantA, vehicleA, daysAgo(91));
    await ping(tenantA, vehicleA, daysAgo(10));
    await ping(tenantB, randomUUID(), daysAgo(200));
    const result = await service.runGpsRetentionSweep(NOW);
    expect(result).toEqual({ tenants: 2, erased: 3, failures: [] });
    const left = await repo.listGpsPingsForVehicle(tenantA, vehicleA, {
      since: new Date(0),
      limit: 100,
    });
    expect(left.map((p) => p.recordedAt)).toEqual([daysAgo(10)]);
    expect((await service.runGpsRetentionSweep(NOW)).erased).toBe(0);
  });

  it('the live map hides a vehicle whose last position is past retention', async () => {
    const { service, tenantA, vehicleA, ping } = await setup();
    await ping(tenantA, vehicleA, daysAgo(100));
    expect((await service.getLiveMap(tenantA)).vehicles).toEqual([]);
  });

  it('vehicle history is bounded to the window and GPS_HISTORY_MAX_ROWS', async () => {
    const { service, tenantA, vehicleA, ping } = await setup();
    await ping(tenantA, vehicleA, daysAgo(95));
    for (let i = 0; i < GPS_HISTORY_MAX_ROWS + 5; i += 1) {
      await ping(tenantA, vehicleA, new Date(daysAgo(1).getTime() + i * 1000));
    }
    const history = await service.listVehicleGpsHistory(tenantA, vehicleA, NOW);
    expect(history).toHaveLength(GPS_HISTORY_MAX_ROWS);
    expect(history.every((p) => p.recordedAt.getTime() >= daysAgo(90).getTime())).toBe(true);
  });

  it('a failing tenant does not stop the sweep', async () => {
    const { repo, service, tenantA, tenantB, vehicleA, ping } = await setup();
    await ping(tenantA, vehicleA, daysAgo(120));
    await ping(tenantB, randomUUID(), daysAgo(120));
    const original = repo.purgeGpsPingsRecordedBefore.bind(repo);
    repo.purgeGpsPingsRecordedBefore = async (tenantId, cutoff) => {
      if (tenantId === tenantA) throw new Error('db down');
      return original(tenantId, cutoff);
    };
    const result = await service.runGpsRetentionSweep(NOW);
    expect(result.erased).toBe(1);
    expect(result.failures).toEqual([{ tenantId: tenantA, error: 'db down' }]);
  });

  it('the sweep is on by default outside tests and can be turned off', () => {
    expect(gpsRetentionSweepSettings({ NODE_ENV: 'production' })).toEqual({
      enabled: true,
      intervalMs: 6 * 60 * 60 * 1000,
    });
    expect(
      gpsRetentionSweepSettings({ NODE_ENV: 'production', TRANSPORT_GPS_RETENTION_SWEEP: '0' })
        .enabled,
    ).toBe(false);
    expect(gpsRetentionSweepSettings({ NODE_ENV: 'test' }).enabled).toBe(false);
    expect(
      gpsRetentionSweepSettings({ TRANSPORT_GPS_RETENTION_INTERVAL_MS: '10' }).intervalMs,
    ).toBe(60_000);
  });
});
