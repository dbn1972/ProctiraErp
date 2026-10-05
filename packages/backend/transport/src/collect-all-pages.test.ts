/** PRC-M450: service-internal scans iterate every page (150 routes / 600 assignments). */
import { v4 as uuidv4 } from 'uuid';
import { describe, expect, it } from 'vitest';
import { InMemoryTransportRepository } from './in-memory-repository.js';
import { TransportService, collectAllPages } from './transport-service.js';

const TENANT = uuidv4();

describe('collectAllPages (PRC-M450)', () => {
  it('returns all 150 routes and 600 assignments', async () => {
    const repo = new InMemoryTransportRepository();
    const routeIds: string[] = [];
    for (let i = 0; i < 150; i += 1) {
      const route = await repo.createRoute({
        id: uuidv4(),
        tenantId: TENANT,
        name: `Route ${i}`,
        description: null,
        status: 'active',
        startLocation: 'A',
        endLocation: 'B',
        distanceKm: null,
        estimatedDurationMinutes: null,
        operatingDays: ['monday'],
        departureTime: '07:30',
        returnTime: null,
        institutionId: null,
      });
      routeIds.push(route.id);
    }
    for (let i = 0; i < 600; i += 1) {
      await repo.createStudentAssignment({
        id: uuidv4(),
        tenantId: TENANT,
        studentId: uuidv4(),
        routeId: routeIds[i % routeIds.length]!,
        stopId: null,
        startDate: '2026-06-01',
        endDate: null,
        isActive: true,
      });
    }
    const routes = await collectAllPages((p) => repo.listRoutes(TENANT, {}, p));
    const assignments = await collectAllPages((p) =>
      repo.listStudentAssignments(TENANT, { isActive: true }, p),
    );
    expect(routes.data).toHaveLength(150);
    expect(new Set(routes.data.map((r) => r.id)).size).toBe(150);
    expect(assignments.data).toHaveLength(600);
    expect(assignments.meta.totalItems).toBe(600);
  });

  it('live map resolves vehicles beyond the first 100', async () => {
    const repo = new InMemoryTransportRepository();
    const service = new TransportService(repo);
    let last = '';
    for (let i = 0; i < 150; i += 1) {
      const v = await service.createVehicle(TENANT, {
        registrationNumber: `MH-M450-${String(i).padStart(3, '0')}`,
        capacity: 40,
      });
      last = v.id;
    }
    await repo.ingestGpsPing({
      id: uuidv4(),
      tenantId: TENANT,
      vehicleId: last,
      deviceId: 'dev-m450',
      pingId: 'p1',
      latitude: 1,
      longitude: 2,
      recordedAt: new Date(),
      speedKph: null,
      headingDeg: null,
    });
    const map = await service.getLiveMap(TENANT);
    const entry = map.vehicles.find((v) => v.vehicleId === last);
    expect(entry?.registrationNumber).toMatch(/^MH-M450-/);
  });
});
