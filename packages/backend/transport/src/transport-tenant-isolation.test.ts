/**
 * PRC-L592: HTTP cross-tenant isolation for routes, vehicles and assignments.
 *
 * Tenant A creates rows; tenant B (same app, same repository) must neither see
 * nor mutate them, and must not be able to attach its own records to them.
 */
import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { InMemoryTransportRepository } from './in-memory-repository.js';
import { transportPlugin } from './transport-plugin.js';

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();

describe('transport cross-tenant isolation (PRC-L592)', () => {
  let app: FastifyInstance;
  let currentTenant = TENANT_A;
  const a: {
    routeId?: string;
    stopId?: string;
    vehicleId?: string;
    driverAssignmentId?: string;
    studentAssignmentId?: string;
  } = {};

  async function asTenant(tenantId: string, opts: Parameters<FastifyInstance['inject']>[0]) {
    currentTenant = tenantId;
    return app.inject(opts as never);
  }

  beforeAll(async () => {
    app = Fastify();
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      const r = request as { tenantId?: string; user?: { sub: string; roles: string[] } };
      r.tenantId = currentTenant;
      r.user = { sub: `officer-${currentTenant}`, roles: ['transport_officer'] };
    });
    await app.register(transportPlugin, { repository: new InMemoryTransportRepository() });
    await app.ready();

    const route = await asTenant(TENANT_A, {
      method: 'POST',
      url: '/transport/routes',
      payload: {
        name: 'Tenant A route',
        startLocation: 'Depot',
        endLocation: 'School',
        operatingDays: ['monday'],
        departureTime: '07:30',
      },
    });
    expect(route.statusCode).toBe(201);
    a.routeId = route.json().id;

    const stop = await asTenant(TENANT_A, {
      method: 'POST',
      url: '/transport/stops',
      payload: { routeId: a.routeId, name: 'Oak Street', stopOrder: 1 },
    });
    expect(stop.statusCode).toBe(201);
    a.stopId = stop.json().id;

    const vehicle = await asTenant(TENANT_A, {
      method: 'POST',
      url: '/transport/vehicles',
      payload: { registrationNumber: 'A-001', capacity: 30 },
    });
    expect(vehicle.statusCode).toBe(201);
    a.vehicleId = vehicle.json().id;

    const driver = await asTenant(TENANT_A, {
      method: 'POST',
      url: '/transport/driver-assignments',
      payload: {
        vehicleId: a.vehicleId,
        driverId: randomUUID(),
        routeId: a.routeId,
        startDate: '2026-09-01',
      },
    });
    expect(driver.statusCode).toBe(201);
    a.driverAssignmentId = driver.json().id;

    const student = await asTenant(TENANT_A, {
      method: 'POST',
      url: '/transport/student-assignments',
      payload: {
        studentId: randomUUID(),
        routeId: a.routeId,
        stopId: a.stopId,
        startDate: '2026-09-01',
      },
    });
    expect(student.statusCode).toBe(201);
    a.studentAssignmentId = student.json().id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('tenant B gets 404 reading tenant A records by id', async () => {
    for (const url of [`/transport/routes/${a.routeId}`, `/transport/vehicles/${a.vehicleId}`]) {
      const res = await asTenant(TENANT_B, { method: 'GET', url });
      expect(res.statusCode, url).toBe(404);
    }
  });

  it('tenant B lists contain none of tenant A rows', async () => {
    const lists: Array<[string, string | undefined]> = [
      ['/transport/routes', a.routeId],
      ['/transport/vehicles', a.vehicleId],
      ['/transport/driver-assignments', a.driverAssignmentId],
      ['/transport/student-assignments', a.studentAssignmentId],
    ];
    for (const [url, id] of lists) {
      const res = await asTenant(TENANT_B, { method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      const ids = (res.json().data as Array<{ id: string }>).map((row) => row.id);
      expect(ids, url).not.toContain(id);
    }
  });

  it('tenant B cannot update or delete tenant A records', async () => {
    const attempts: Array<{ method: 'PUT' | 'DELETE'; url: string; payload?: object }> = [
      { method: 'PUT', url: `/transport/routes/${a.routeId}`, payload: { name: 'hijack' } },
      { method: 'PUT', url: `/transport/vehicles/${a.vehicleId}`, payload: { capacity: 5 } },
      {
        method: 'PUT',
        url: `/transport/driver-assignments/${a.driverAssignmentId}`,
        payload: { isActive: false },
      },
      {
        method: 'PUT',
        url: `/transport/student-assignments/${a.studentAssignmentId}`,
        payload: { isActive: false },
      },
      { method: 'DELETE', url: `/transport/vehicles/${a.vehicleId}` },
      { method: 'DELETE', url: `/transport/routes/${a.routeId}` },
    ];
    for (const attempt of attempts) {
      const res = await asTenant(TENANT_B, attempt);
      expect(res.statusCode, `${attempt.method} ${attempt.url}`).toBe(404);
    }
  });

  it('tenant B cannot attach its records to tenant A route or vehicle', async () => {
    const student = await asTenant(TENANT_B, {
      method: 'POST',
      url: '/transport/student-assignments',
      payload: { studentId: randomUUID(), routeId: a.routeId, startDate: '2026-09-01' },
    });
    expect(student.statusCode).toBe(404);
    const driver = await asTenant(TENANT_B, {
      method: 'POST',
      url: '/transport/driver-assignments',
      payload: { vehicleId: a.vehicleId, driverId: randomUUID(), startDate: '2026-09-01' },
    });
    expect(driver.statusCode).toBe(404);
  });

  it('tenant A still sees its unchanged rows afterwards', async () => {
    const route = await asTenant(TENANT_A, {
      method: 'GET',
      url: `/transport/routes/${a.routeId}`,
    });
    expect(route.statusCode).toBe(200);
    expect(route.json().name).toBe('Tenant A route');
    const vehicle = await asTenant(TENANT_A, {
      method: 'GET',
      url: `/transport/vehicles/${a.vehicleId}`,
    });
    expect(vehicle.statusCode).toBe(200);
    expect(vehicle.json().capacity).toBe(30);
    const students = await asTenant(TENANT_A, {
      method: 'GET',
      url: '/transport/student-assignments',
    });
    const row = (students.json().data as Array<{ id: string; isActive: boolean }>).find(
      (s) => s.id === a.studentAssignmentId,
    );
    expect(row?.isActive).toBe(true);
    const drivers = await asTenant(TENANT_A, {
      method: 'GET',
      url: '/transport/driver-assignments',
    });
    const driverRow = (drivers.json().data as Array<{ id: string; isActive: boolean }>).find(
      (d) => d.id === a.driverAssignmentId,
    );
    expect(driverRow?.isActive).toBe(true);
  });
});
