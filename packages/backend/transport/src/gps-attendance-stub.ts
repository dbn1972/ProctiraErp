/**
 * G-602 — GPS ping + attendance-on-bus stubs.
 *
 * Process-local stores until a live telematics / RFID provider is wired.
 * Honesty: coordinates and boarding events are accepted and queryable but
 * are not validated against a real GPS device or bus scanner.
 */
import { v4 as uuidv4 } from 'uuid';

export const GPS_STUB_HONESTY_NOTE =
  'Sandbox GPS — pings accepted without a live telematics provider. Wire a device adapter for production tracking.';

export const BUS_ATTENDANCE_STUB_HONESTY_NOTE =
  'Sandbox attendance-on-bus — boarding events accepted without RFID/scanner hardware. Wire a device adapter for production.';

export interface GpsPing {
  id: string;
  tenantId: string;
  vehicleId: string;
  latitude: number;
  longitude: number;
  recordedAt: Date;
  speedKph: number | null;
  headingDeg: number | null;
}

export interface BusAttendanceEvent {
  id: string;
  tenantId: string;
  vehicleId: string;
  routeId: string | null;
  studentId: string;
  eventType: 'board' | 'alight';
  recordedAt: Date;
}

/** In-process GPS + bus-attendance store (tenant-scoped). */
export class GpsAttendanceStubStore {
  private readonly pings: GpsPing[] = [];
  private readonly attendance: BusAttendanceEvent[] = [];

  recordGpsPing(input: {
    tenantId: string;
    vehicleId: string;
    latitude: number;
    longitude: number;
    recordedAt?: Date;
    speedKph?: number | null;
    headingDeg?: number | null;
  }): GpsPing {
    const ping: GpsPing = {
      id: uuidv4(),
      tenantId: input.tenantId,
      vehicleId: input.vehicleId,
      latitude: input.latitude,
      longitude: input.longitude,
      recordedAt: input.recordedAt ?? new Date(),
      speedKph: input.speedKph ?? null,
      headingDeg: input.headingDeg ?? null,
    };
    this.pings.push(ping);
    return ping;
  }

  listGpsPings(tenantId: string, vehicleId: string): GpsPing[] {
    return this.pings
      .filter((p) => p.tenantId === tenantId && p.vehicleId === vehicleId)
      .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime());
  }

  latestGpsPing(tenantId: string, vehicleId: string): GpsPing | null {
    return this.listGpsPings(tenantId, vehicleId)[0] ?? null;
  }

  recordBusAttendance(input: {
    tenantId: string;
    vehicleId: string;
    routeId?: string | null;
    studentId: string;
    eventType: 'board' | 'alight';
    recordedAt?: Date;
  }): BusAttendanceEvent {
    const event: BusAttendanceEvent = {
      id: uuidv4(),
      tenantId: input.tenantId,
      vehicleId: input.vehicleId,
      routeId: input.routeId ?? null,
      studentId: input.studentId,
      eventType: input.eventType,
      recordedAt: input.recordedAt ?? new Date(),
    };
    this.attendance.push(event);
    return event;
  }

  listBusAttendance(
    tenantId: string,
    filter: { vehicleId?: string; studentId?: string; routeId?: string } = {},
  ): BusAttendanceEvent[] {
    return this.attendance
      .filter((e) => e.tenantId === tenantId)
      .filter((e) => (filter.vehicleId ? e.vehicleId === filter.vehicleId : true))
      .filter((e) => (filter.studentId ? e.studentId === filter.studentId : true))
      .filter((e) => (filter.routeId ? e.routeId === filter.routeId : true))
      .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime());
  }
}
