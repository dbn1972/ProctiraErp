/** PRC-M446: invalid / future / ancient recordedAt is a 400 and nothing is stored. */
import { v4 as uuidv4 } from 'uuid';
import { describe, expect, it } from 'vitest';
import { InMemoryTransportRepository } from './in-memory-repository.js';
import { TransportService, parseRecordedAt } from './transport-service.js';

const TENANT = uuidv4();

async function setup() {
  const repo = new InMemoryTransportRepository();
  const service = new TransportService(repo);
  const vehicle = await service.createVehicle(TENANT, {
    registrationNumber: 'MH-01-M446',
    capacity: 40,
  });
  const device = await service.registerVehicleDevice(TENANT, vehicle.id);
  return { repo, service, vehicle, device };
}

describe('GPS recordedAt validation (PRC-M446)', () => {
  it.each([
    ['invalid', 'not-a-date'],
    ['future', new Date(Date.now() + 60 * 60 * 1000).toISOString()],
    ['ancient', '2001-01-01T00:00:00.000Z'],
  ])('%s timestamp rejects the whole batch with 400 and stores nothing', async (_l, bad) => {
    const { repo, service, vehicle, device } = await setup();
    await expect(
      service.ingestGpsBatch(TENANT, device.deviceKey, {
        deviceId: device.deviceId,
        pings: [
          { pingId: 'ok-1', latitude: 1, longitude: 2 },
          { pingId: 'bad-1', latitude: 1, longitude: 2, recordedAt: bad },
        ],
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(await repo.listGpsPingsForVehicle(TENANT, vehicle.id)).toHaveLength(0);
  });

  it('accepts small clock skew', () => {
    const now = new Date('2026-09-09T08:00:00.000Z');
    expect(parseRecordedAt('2026-09-09T08:04:00.000Z', now).toISOString()).toBe(
      '2026-09-09T08:04:00.000Z',
    );
  });
});
