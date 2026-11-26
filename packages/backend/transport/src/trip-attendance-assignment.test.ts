/**
 * PRC-M130: a bus attendance mark must name a rider of the route on the trip
 * date. Before the fix any student id (unassigned, another route's rider, or a
 * rider before their start date) was accepted, so the trip roster and its
 * "unmarked" count could be corrupted by a mis-click.
 */
import Fastify from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { beforeEach, describe, expect, it } from 'vitest';
import { BusinessRuleError } from '@proctira/common';

import { InMemoryTransportRepository } from './in-memory-repository.js';
import { transportPlugin } from './transport-plugin.js';
import { TransportService } from './transport-service.js';

const TENANT = uuidv4();
const ACTOR = 'officer-1';

describe('trip attendance requires a route assignment (PRC-M130)', () => {
  let service: TransportService;
  let routeId: string;
  let otherRouteId: string;
  let stopId: string;
  const rider = uuidv4();
  const otherRider = uuidv4();

  beforeEach(async () => {
    service = new TransportService(new InMemoryTransportRepository());
    const route = await service.createRoute(TENANT, {
      name: 'North Loop',
      startLocation: 'Depot',
      endLocation: 'School',
    });
    const other = await service.createRoute(TENANT, {
      name: 'South Loop',
      startLocation: 'Depot',
      endLocation: 'School',
    });
    routeId = route.id;
    otherRouteId = other.id;
    stopId = (await service.createStop(TENANT, { routeId, name: 'Oak Street', stopOrder: 1 })).id;
    const otherStop = await service.createStop(TENANT, {
      routeId: otherRouteId,
      name: 'Elm Street',
      stopOrder: 1,
    });
    await service.createStudentAssignment(
      TENANT,
      { studentId: rider, routeId, stopId, startDate: '2026-09-01' },
      ACTOR,
    );
    await service.createStudentAssignment(
      TENANT,
      {
        studentId: otherRider,
        routeId: otherRouteId,
        stopId: otherStop.id,
        startDate: '2026-09-01',
      },
      ACTOR,
    );
  });

  const mark = (studentId: string, tripDate = '2026-09-09') =>
    service.upsertTripAttendance(
      TENANT,
      { routeId, tripDate, direction: 'pickup', studentId, stopId, status: 'boarded' },
      ACTOR,
    );

  it('accepts a rider of the route on the trip date', async () => {
    await expect(mark(rider)).resolves.toMatchObject({ studentId: rider, status: 'boarded' });
  });

  it('rejects an unassigned student and another route’s rider', async () => {
    await expect(mark(uuidv4())).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(mark(otherRider)).rejects.toBeInstanceOf(BusinessRuleError);
    const trip = await service.getTripAttendance(TENANT, {
      routeId,
      tripDate: '2026-09-09',
      direction: 'pickup',
    });
    expect(trip.data).toEqual([]);
  });

  it('rejects a rider whose assignment has not started on the trip date', async () => {
    await expect(mark(rider, '2026-08-31')).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('lists the trip roster with activeOn', async () => {
    const before = await service.listStudentAssignments(
      TENANT,
      { routeId, isActive: true, activeOn: '2026-08-31' },
      { page: 1, pageSize: 20 },
    );
    const during = await service.listStudentAssignments(
      TENANT,
      { routeId, isActive: true, activeOn: '2026-09-09' },
      { page: 1, pageSize: 20 },
    );
    expect(before.data).toEqual([]);
    expect(during.data.map((a) => a.studentId)).toEqual([rider]);
  });
});

describe('GET /transport/student-assignments?activeOn (PRC-M130)', () => {
  it('returns only riders whose assignment covers the date, and validates it', async () => {
    const repository = new InMemoryTransportRepository();
    const service = new TransportService(repository);
    const route = await service.createRoute(TENANT, {
      name: 'East Loop',
      startLocation: 'Depot',
      endLocation: 'School',
    });
    const rider = uuidv4();
    await service.createStudentAssignment(
      TENANT,
      { studentId: rider, routeId: route.id, startDate: '2026-09-01' },
      ACTOR,
    );
    const app = Fastify();
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      const r = request as { tenantId?: string; user?: { sub: string; roles: string[] } };
      r.tenantId = TENANT;
      r.user = { sub: ACTOR, roles: ['transport_officer'] };
    });
    await app.register(transportPlugin, { repository });
    await app.ready();
    const list = async (activeOn: string) =>
      app.inject({
        method: 'GET',
        url: `/transport/student-assignments?routeId=${route.id}&isActive=true&activeOn=${activeOn}`,
      });
    const before = await list('2026-08-31');
    expect(before.statusCode).toBe(200);
    expect(before.json().data).toEqual([]);
    const during = await list('2026-09-09');
    expect(during.json().data.map((a: { studentId: string }) => a.studentId)).toEqual([rider]);
    expect((await list('09-09-2026')).statusCode).toBe(400);
    await app.close();
  });
});
