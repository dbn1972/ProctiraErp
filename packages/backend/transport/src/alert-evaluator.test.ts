/**
 * G-920 — alert evaluator unit tests (synthetic pings / attendance).
 */
import { describe, expect, it } from 'vitest';

import {
  evaluateTransportAlerts,
  haversineMeters,
  osmDeepLink,
  type EvaluatorAssignment,
  type EvaluatorAttendance,
  type EvaluatorPing,
  type EvaluatorRule,
  type EvaluatorStop,
} from './alert-evaluator.js';

const ROUTE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const VEHICLE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const STOP = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3';
const STUDENT = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd4';

const school: EvaluatorStop = {
  id: STOP,
  routeId: ROUTE,
  latitude: 19.076,
  longitude: 72.8777,
  pickupTime: '07:30',
};

function ping(overrides: Partial<EvaluatorPing> = {}): EvaluatorPing {
  return {
    vehicleId: VEHICLE,
    routeId: ROUTE,
    latitude: 19.076,
    longitude: 72.8777,
    recordedAt: new Date('2026-09-09T07:31:00.000Z'),
    ...overrides,
  };
}

describe('haversineMeters', () => {
  it('is ~0 for the same point', () => {
    expect(
      haversineMeters(
        { latitude: 19.076, longitude: 72.8777 },
        { latitude: 19.076, longitude: 72.8777 },
      ),
    ).toBeLessThan(1);
  });

  it('is several km between two distant points', () => {
    const m = haversineMeters(
      { latitude: 19.076, longitude: 72.8777 },
      { latitude: 18.52, longitude: 73.8567 },
    );
    expect(m).toBeGreaterThan(100_000);
  });
});

describe('osmDeepLink', () => {
  it('points at OpenStreetMap with mlat/mlon', () => {
    expect(osmDeepLink(19.076, 72.8777)).toContain('openstreetmap.org');
    expect(osmDeepLink(19.076, 72.8777)).toContain('mlat=19.076');
  });
});

describe('evaluateTransportAlerts', () => {
  const delayRule: EvaluatorRule = {
    id: 'rule-delay',
    kind: 'delay_minutes',
    threshold: 10,
    routeId: ROUTE,
    isActive: true,
  };
  const geoRule: EvaluatorRule = {
    id: 'rule-geo',
    kind: 'geofence_exit',
    threshold: 500,
    routeId: ROUTE,
    isActive: true,
  };
  const missRule: EvaluatorRule = {
    id: 'rule-miss',
    kind: 'missed_pickup',
    threshold: 5,
    routeId: ROUTE,
    isActive: true,
  };

  it('fires delay_minutes when the ping is after departure + threshold', () => {
    const drafts = evaluateTransportAlerts({
      now: new Date('2026-09-09T08:00:00.000Z'),
      tripDate: '2026-09-09',
      pings: [ping({ recordedAt: new Date('2026-09-09T07:50:00.000Z') })],
      stops: [school],
      rules: [delayRule],
      attendance: [],
      assignments: [],
      routeDeparture: { [ROUTE]: '07:30' },
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.kind).toBe('delay_minutes');
    expect(drafts[0]!.vehicleId).toBe(VEHICLE);
  });

  it('does not fire delay when the ping is within the threshold', () => {
    const drafts = evaluateTransportAlerts({
      now: new Date('2026-09-09T07:35:00.000Z'),
      tripDate: '2026-09-09',
      pings: [ping({ recordedAt: new Date('2026-09-09T07:35:00.000Z') })],
      stops: [school],
      rules: [delayRule],
      attendance: [],
      assignments: [],
      routeDeparture: { [ROUTE]: '07:30' },
    });
    expect(drafts).toHaveLength(0);
  });

  it('fires geofence_exit when the ping is far from every stop', () => {
    const drafts = evaluateTransportAlerts({
      now: new Date('2026-09-09T07:40:00.000Z'),
      tripDate: '2026-09-09',
      pings: [ping({ latitude: 18.52, longitude: 73.8567 })],
      stops: [school],
      rules: [geoRule],
      attendance: [],
      assignments: [],
      routeDeparture: { [ROUTE]: '07:30' },
    });
    expect(drafts.some((d) => d.kind === 'geofence_exit')).toBe(true);
  });

  it('does not fire geofence_exit when the ping is at the stop', () => {
    const drafts = evaluateTransportAlerts({
      now: new Date('2026-09-09T07:40:00.000Z'),
      tripDate: '2026-09-09',
      pings: [ping()],
      stops: [school],
      rules: [geoRule],
      attendance: [],
      assignments: [],
      routeDeparture: { [ROUTE]: '07:30' },
    });
    expect(drafts.filter((d) => d.kind === 'geofence_exit')).toHaveLength(0);
  });

  it('fires missed_pickup for an absent student after the grace window', () => {
    const assignments: EvaluatorAssignment[] = [
      { studentId: STUDENT, routeId: ROUTE, stopId: STOP },
    ];
    const attendance: EvaluatorAttendance[] = [
      { studentId: STUDENT, routeId: ROUTE, status: 'absent', stopId: STOP },
    ];
    const drafts = evaluateTransportAlerts({
      now: new Date('2026-09-09T07:40:00.000Z'),
      tripDate: '2026-09-09',
      pings: [],
      stops: [school],
      rules: [missRule],
      attendance,
      assignments,
      routeDeparture: { [ROUTE]: '07:30' },
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.kind).toBe('missed_pickup');
    expect(drafts[0]!.studentId).toBe(STUDENT);
  });

  it('does not fire missed_pickup when the student boarded', () => {
    const assignments: EvaluatorAssignment[] = [
      { studentId: STUDENT, routeId: ROUTE, stopId: STOP },
    ];
    const attendance: EvaluatorAttendance[] = [
      { studentId: STUDENT, routeId: ROUTE, status: 'boarded', stopId: STOP },
    ];
    const drafts = evaluateTransportAlerts({
      now: new Date('2026-09-09T07:50:00.000Z'),
      tripDate: '2026-09-09',
      pings: [],
      stops: [school],
      rules: [missRule],
      attendance,
      assignments,
      routeDeparture: { [ROUTE]: '07:30' },
    });
    expect(drafts).toHaveLength(0);
  });

  it('skips inactive rules', () => {
    const drafts = evaluateTransportAlerts({
      now: new Date('2026-09-09T08:00:00.000Z'),
      tripDate: '2026-09-09',
      pings: [ping({ recordedAt: new Date('2026-09-09T08:00:00.000Z') })],
      stops: [school],
      rules: [{ ...delayRule, isActive: false }],
      attendance: [],
      assignments: [],
      routeDeparture: { [ROUTE]: '07:30' },
    });
    expect(drafts).toHaveLength(0);
  });
});
