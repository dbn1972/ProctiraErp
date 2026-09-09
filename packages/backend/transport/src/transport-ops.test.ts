/**
 * G-920 — transport ops service tests (GPS ingest, attendance, fees link, alerts).
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { InMemoryTransportRepository } from './in-memory-repository.js';
import type { TransportFeesPort } from './fees-port.js';
import { TransportService } from './transport-service.js';

const TENANT = uuidv4();

function feesPort(invoices: { id: string }[] = []): TransportFeesPort {
  return {
    async createFeeStructure() {
      return { id: uuidv4() };
    },
    async createInvoice(_tenant, _actor, input) {
      const row = { id: uuidv4(), studentId: input.studentId };
      invoices.push(row);
      return row;
    },
    async bulkInvoiceClass(_tenant, _actor, input) {
      const created = input.studentIds.map((studentId) => {
        const row = { id: uuidv4(), studentId };
        invoices.push(row);
        return row;
      });
      return { created, skipped: [] };
    },
  };
}

describe('TransportService ops (G-920)', () => {
  let service: TransportService;
  let repo: InMemoryTransportRepository;

  beforeEach(() => {
    repo = new InMemoryTransportRepository();
    service = new TransportService(repo, undefined, feesPort());
  });

  async function seededRoute() {
    const route = await service.createRoute(TENANT, {
      name: 'North Loop',
      startLocation: 'Depot',
      endLocation: 'School',
      operatingDays: ['monday'],
      departureTime: '07:30',
      distanceKm: 12,
    });
    const stop = await service.createStop(TENANT, {
      routeId: route.id,
      name: 'Oak Street',
      stopOrder: 1,
      latitude: 19.076,
      longitude: 72.8777,
      pickupTime: '07:15',
    });
    const vehicle = await service.createVehicle(TENANT, {
      registrationNumber: 'MH-01-G920',
      capacity: 40,
    });
    return { route, stop, vehicle };
  }

  it('ingests GPS pings idempotently by deviceId+pingId and surfaces them on live', async () => {
    const { vehicle } = await seededRoute();
    const device = await service.registerVehicleDevice(TENANT, vehicle.id, {
      deviceId: 'bus-north-1',
    });
    const first = await service.ingestGpsBatch(TENANT, device.deviceKey, {
      deviceId: device.deviceId,
      pings: [{ pingId: 'p1', latitude: 19.076, longitude: 72.8777 }],
    });
    const replay = await service.ingestGpsBatch(TENANT, device.deviceKey, {
      deviceId: device.deviceId,
      pings: [{ pingId: 'p1', latitude: 19.08, longitude: 72.88 }],
    });
    expect(first.data[0]!.duplicate).toBe(false);
    expect(replay.data[0]!.duplicate).toBe(true);
    expect(replay.data[0]!.latitude).toBe(19.076);
    const live = await service.getLiveMap(TENANT);
    expect(live.vehicles).toHaveLength(1);
    expect(live.vehicles[0]!.vehicleId).toBe(vehicle.id);
    expect(live.stops).toHaveLength(1);
    expect(live.stops[0]!.osmUrl).toContain('openstreetmap.org');
  });

  it('rejects GPS ingest with a wrong device key', async () => {
    const { vehicle } = await seededRoute();
    const device = await service.registerVehicleDevice(TENANT, vehicle.id);
    await expect(
      service.ingestGpsBatch(TENANT, 'wrong-key', {
        deviceId: device.deviceId,
        pings: [{ pingId: 'p1', latitude: 1, longitude: 2 }],
      }),
    ).rejects.toThrow(/invalid device key/i);
  });

  it('marks trip attendance and returns summary counts', async () => {
    const { route, stop } = await seededRoute();
    const studentId = uuidv4();
    await service.createStudentAssignment(TENANT, {
      studentId,
      routeId: route.id,
      stopId: stop.id,
      startDate: '2026-09-09',
    });
    await service.upsertTripAttendance(TENANT, {
      routeId: route.id,
      tripDate: '2026-09-09',
      direction: 'pickup',
      studentId,
      stopId: stop.id,
      status: 'boarded',
    });
    const trip = await service.getTripAttendance(TENANT, {
      routeId: route.id,
      tripDate: '2026-09-09',
      direction: 'pickup',
    });
    expect(trip.summary.boarded).toBe(1);
    expect(trip.summary.absent).toBe(0);
  });

  it('creates a fees invoice when assigning a student to a stop with a matching band', async () => {
    const invoices: { id: string }[] = [];
    service = new TransportService(repo, undefined, feesPort(invoices));
    const { route, stop } = await seededRoute();
    await service.createTransportFeeStructure(TENANT, {
      name: 'Oak Street band',
      stopId: stop.id,
      routeId: route.id,
      amountCents: 150000,
      currency: 'INR',
    });
    const assignment = await service.createStudentAssignment(TENANT, {
      studentId: uuidv4(),
      routeId: route.id,
      stopId: stop.id,
      startDate: '2026-09-09',
    });
    const links = await service.listFeeLinks(TENANT);
    expect(links[0]!.assignmentId).toBe(assignment.id);
    expect(links[0]!.status).toBe('invoiced');
    expect(links[0]!.feesInvoiceId).toBeTruthy();
    expect(invoices.length).toBeGreaterThan(0);
  });

  it('records a pending fee link when FeesService is not injected', async () => {
    service = new TransportService(repo);
    const { route, stop } = await seededRoute();
    await service.createTransportFeeStructure(TENANT, {
      name: 'Oak Street band',
      stopId: stop.id,
      amountCents: 90000,
    });
    await service.createStudentAssignment(TENANT, {
      studentId: uuidv4(),
      routeId: route.id,
      stopId: stop.id,
      startDate: '2026-09-09',
    });
    const links = await service.listFeeLinks(TENANT);
    expect(links[0]!.status).toBe('pending');
  });

  it('evaluates delay alerts from a late synthetic ping', async () => {
    const { route, vehicle } = await seededRoute();
    await service.createDriverAssignment(TENANT, {
      vehicleId: vehicle.id,
      driverId: uuidv4(),
      routeId: route.id,
      startDate: '2026-09-01',
    });
    const device = await service.registerVehicleDevice(TENANT, vehicle.id);
    await service.ingestGpsBatch(TENANT, device.deviceKey, {
      deviceId: device.deviceId,
      pings: [
        {
          pingId: 'late-1',
          latitude: 19.076,
          longitude: 72.8777,
          recordedAt: '2026-09-09T08:00:00.000Z',
        },
      ],
    });
    await service.createAlertRule(TENANT, {
      kind: 'delay_minutes',
      threshold: 10,
      routeId: route.id,
    });
    const result = await service.evaluateAlerts(
      TENANT,
      { tripDate: '2026-09-09', routeId: route.id },
      new Date('2026-09-09T08:05:00.000Z'),
    );
    expect(result.evaluated).toBeGreaterThan(0);
    expect(result.data[0]!.kind).toBe('delay_minutes');
    const acked = await service.acknowledgeAlert(TENANT, result.data[0]!.id, 'officer-1');
    expect(acked.acknowledgedBy).toBe('officer-1');
  });
});
