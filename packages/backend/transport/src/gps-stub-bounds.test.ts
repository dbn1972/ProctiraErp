/** PRC-M444: device ingest does not feed the sandbox store; the sandbox store is capped. */
import { v4 as uuidv4 } from 'uuid';
import { describe, expect, it } from 'vitest';
import { GpsAttendanceStubStore } from './gps-attendance-stub.js';
import { InMemoryTransportRepository } from './in-memory-repository.js';
import { TransportService } from './transport-service.js';

const TENANT = uuidv4();

describe('GPS sandbox store bounds (PRC-M444)', () => {
  it('10k duplicate device pings do not grow the sandbox store', async () => {
    const stub = new GpsAttendanceStubStore();
    const service = new TransportService(new InMemoryTransportRepository(), stub);
    const vehicle = await service.createVehicle(TENANT, {
      registrationNumber: 'MH-01-M444',
      capacity: 40,
    });
    const device = await service.registerVehicleDevice(TENANT, vehicle.id);
    const pings = Array.from({ length: 500 }, () => ({
      pingId: 'same',
      latitude: 19.07,
      longitude: 72.87,
    }));
    for (let i = 0; i < 20; i += 1) {
      await service.ingestGpsBatch(TENANT, device.deviceKey, { deviceId: device.deviceId, pings });
    }
    expect(stub.pingCount).toBe(0);
  });

  it('sandbox store evicts oldest pings beyond the cap', () => {
    const stub = new GpsAttendanceStubStore(10, 10);
    for (let i = 0; i < 25; i += 1) {
      stub.recordGpsPing({
        tenantId: TENANT,
        vehicleId: 'v1',
        latitude: i,
        longitude: i,
        recordedAt: new Date(1_700_000_000_000 + i * 1000),
      });
    }
    expect(stub.pingCount).toBe(10);
    expect(stub.latestGpsPing(TENANT, 'v1')?.latitude).toBe(24);
  });
});
