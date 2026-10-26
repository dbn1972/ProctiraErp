/**
 * PRC-M441: missed_pickup evaluation without a routeId must use each route's
 * pickup attendance (no false alerts for boarded students), and repeat
 * evaluations for the same trip date must not duplicate alerts.
 */
import { v4 as uuidv4 } from 'uuid';
import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryTransportRepository } from './in-memory-repository.js';
import { TransportService } from './transport-service.js';

const TENANT = uuidv4();
const ACTOR = 'officer-1';
const TRIP_DATE = '2026-09-09';
/** Pickup 07:15 UTC + 5 min threshold -> 07:30 is past the grace window. */
const AFTER_GRACE = new Date('2026-09-09T07:30:00.000Z');

describe('missed_pickup evaluation (PRC-M441)', () => {
  let repo: InMemoryTransportRepository;
  let service: TransportService;
  let routeId: string;
  let boarded: string;
  let missing: string;

  beforeEach(async () => {
    repo = new InMemoryTransportRepository();
    service = new TransportService(repo);
    const route = await service.createRoute(TENANT, {
      name: 'North Loop',
      startLocation: 'Depot',
      endLocation: 'School',
      operatingDays: ['wednesday'],
      departureTime: '07:30',
    });
    routeId = route.id;
    const stop = await service.createStop(TENANT, {
      routeId,
      name: 'Oak Street',
      stopOrder: 1,
      pickupTime: '07:15',
    });
    boarded = uuidv4();
    missing = uuidv4();
    for (const studentId of [boarded, missing]) {
      await service.createStudentAssignment(
        TENANT,
        { studentId, routeId, stopId: stop.id, startDate: '2026-09-01' },
        ACTOR,
      );
    }
    await service.upsertTripAttendance(
      TENANT,
      {
        routeId,
        tripDate: TRIP_DATE,
        direction: 'pickup',
        studentId: boarded,
        stopId: stop.id,
        status: 'boarded',
      },
      ACTOR,
    );
    await service.createAlertRule(TENANT, { kind: 'missed_pickup', threshold: 5 });
  });

  it('without routeId only alerts the student who did not board', async () => {
    const result = await service.evaluateAlerts(TENANT, { tripDate: TRIP_DATE }, AFTER_GRACE);
    expect(result.data.map((a) => a.studentId)).toEqual([missing]);
    expect(result.data[0]!.payload.tripDate).toBe(TRIP_DATE);
  });

  it('a repeat evaluation for the same trip date creates no duplicate alert', async () => {
    await service.evaluateAlerts(TENANT, { tripDate: TRIP_DATE }, AFTER_GRACE);
    const second = await service.evaluateAlerts(TENANT, { tripDate: TRIP_DATE }, AFTER_GRACE);
    expect(second.data).toHaveLength(0);
    const third = await service.evaluateAlerts(
      TENANT,
      { tripDate: TRIP_DATE, routeId },
      AFTER_GRACE,
    );
    expect(third.data).toHaveLength(0);
    const alerts = (await service.listAlerts(TENANT)).filter((a) => a.kind === 'missed_pickup');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.studentId).toBe(missing);
  });

  it('a different trip date still raises its own alert', async () => {
    await service.evaluateAlerts(TENANT, { tripDate: TRIP_DATE }, AFTER_GRACE);
    const nextDay = await service.evaluateAlerts(
      TENANT,
      { tripDate: '2026-09-10' },
      new Date('2026-09-10T07:30:00.000Z'),
    );
    // No attendance was recorded on the next day, so both students are absent.
    expect(nextDay.data.map((a) => a.studentId).sort()).toEqual([boarded, missing].sort());
  });
});
