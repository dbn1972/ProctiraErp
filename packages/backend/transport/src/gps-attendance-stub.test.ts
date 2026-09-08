/**
 * G-602 — GPS / attendance-on-bus stub unit tests.
 */
import { describe, expect, it } from 'vitest';

import {
  BUS_ATTENDANCE_STUB_HONESTY_NOTE,
  GPS_STUB_HONESTY_NOTE,
  GpsAttendanceStubStore,
} from './gps-attendance-stub.js';

const TENANT = '550e8400-e29b-41d4-a716-446655440000';
const VEHICLE = 'a1000000-0000-4000-8000-000000000001';
const STUDENT = '33333333-3333-4333-8333-333333333333';

describe('GpsAttendanceStubStore (G-602)', () => {
  it('records and lists GPS pings per vehicle', () => {
    const store = new GpsAttendanceStubStore();
    const ping = store.recordGpsPing({
      tenantId: TENANT,
      vehicleId: VEHICLE,
      latitude: 19.076,
      longitude: 72.877,
      speedKph: 32,
    });
    expect(ping.id).toBeTruthy();
    expect(store.listGpsPings(TENANT, VEHICLE)).toHaveLength(1);
    expect(store.latestGpsPing(TENANT, VEHICLE)?.latitude).toBe(19.076);
    expect(GPS_STUB_HONESTY_NOTE).toMatch(/Sandbox GPS/i);
  });

  it('isolates GPS pings by tenant', () => {
    const store = new GpsAttendanceStubStore();
    store.recordGpsPing({
      tenantId: TENANT,
      vehicleId: VEHICLE,
      latitude: 1,
      longitude: 2,
    });
    expect(store.listGpsPings('00000000-0000-4000-8000-0000000000bb', VEHICLE)).toHaveLength(0);
  });

  it('records board/alight attendance-on-bus events', () => {
    const store = new GpsAttendanceStubStore();
    store.recordBusAttendance({
      tenantId: TENANT,
      vehicleId: VEHICLE,
      studentId: STUDENT,
      eventType: 'board',
    });
    store.recordBusAttendance({
      tenantId: TENANT,
      vehicleId: VEHICLE,
      studentId: STUDENT,
      eventType: 'alight',
    });
    const events = store.listBusAttendance(TENANT, { studentId: STUDENT });
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.eventType).sort()).toEqual(['alight', 'board']);
    expect(BUS_ATTENDANCE_STUB_HONESTY_NOTE).toMatch(/Sandbox attendance-on-bus/i);
  });
});
