/**
 * Transport ops client (G-920) — stops, GPS live map, attendance, alerts, fees.
 * Route/vehicle CRUD remains in `@/lib/api/transport`.
 */
import { GatewayError, gatewayFetch } from '@/lib/api/gateway';
import type { StudentAssignment } from '@/lib/api/transport';

export interface RouteStop {
  id: string;
  tenantId: string;
  routeId: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  stopOrder: number;
  pickupTime: string | null;
  dropoffTime: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function listRouteStops(routeId: string): Promise<RouteStop[]> {
  const result = await gatewayFetch<{ data: RouteStop[] }>(`/transport/routes/${routeId}/stops`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function listAllStops(): Promise<RouteStop[]> {
  const result = await gatewayFetch<{ data: RouteStop[] }>('/transport/stops', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function createRouteStop(input: {
  routeId: string;
  name: string;
  stopOrder: number;
  latitude?: number;
  longitude?: number;
  pickupTime?: string;
  dropoffTime?: string;
}): Promise<RouteStop> {
  const result = await gatewayFetch<RouteStop>('/transport/stops', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CREATE_FAILED',
      message: result.error?.message ?? 'Failed to create stop',
    });
  }
  return result.data;
}

export async function deleteRouteStop(id: string): Promise<void> {
  const result = await gatewayFetch(`/transport/stops/${id}`, {
    method: 'DELETE',
    throwOnError: false,
  });
  if (!result.ok && result.status !== 204) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'DELETE_FAILED',
      message: result.error?.message ?? 'Failed to delete stop',
    });
  }
}

export async function registerVehicleDevice(
  vehicleId: string,
  deviceId?: string,
): Promise<{ deviceId: string; deviceKey: string; vehicleId: string }> {
  const result = await gatewayFetch<{ deviceId: string; deviceKey: string; vehicleId: string }>(
    `/transport/vehicles/${vehicleId}/device`,
    { method: 'POST', json: deviceId ? { deviceId } : {} },
  );
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CREATE_FAILED',
      message: result.error?.message ?? 'Failed to register GPS device',
    });
  }
  return result.data;
}

export async function ingestGpsBatch(
  input: {
    deviceId: string;
    pings: Array<{
      pingId: string;
      latitude: number;
      longitude: number;
      recordedAt?: string;
      speedKph?: number;
      headingDeg?: number;
    }>;
  },
  deviceKey: string,
): Promise<{ vehicleId: string; data: Array<{ pingId: string; duplicate: boolean }> }> {
  const result = await gatewayFetch<{
    vehicleId: string;
    data: Array<{ pingId: string; duplicate: boolean }>;
  }>('/transport/gps', {
    method: 'POST',
    json: input,
    headers: { 'X-Transport-Device-Key': deviceKey },
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CREATE_FAILED',
      message: result.error?.message ?? 'Failed to ingest GPS',
    });
  }
  return result.data;
}

export interface LiveVehicle {
  vehicleId: string;
  registrationNumber: string | null;
  latitude: number;
  longitude: number;
  recordedAt: string;
  speedKph: number | null;
  headingDeg: number | null;
  osmUrl: string;
}

export interface LiveStop {
  id: string;
  routeId: string;
  name: string;
  latitude: number;
  longitude: number;
  stopOrder: number;
  pickupTime: string | null;
  dropoffTime: string | null;
  osmUrl: string;
}

export async function getLiveMap(): Promise<{
  honestyNote: string;
  vehicles: LiveVehicle[];
  stops: LiveStop[];
}> {
  const result = await gatewayFetch<{
    honestyNote: string;
    vehicles: LiveVehicle[];
    stops: LiveStop[];
  }>('/transport/live', { throwOnError: false, next: { revalidate: 0 } });
  return {
    honestyNote: result.data?.honestyNote ?? '',
    vehicles: result.data?.vehicles ?? [],
    stops: result.data?.stops ?? [],
  };
}

export interface TripAttendanceRow {
  id: string;
  studentId: string;
  stopId: string | null;
  status: 'boarded' | 'alighted' | 'absent';
  recordedAt: string;
}

export async function getTripAttendance(input: {
  routeId: string;
  tripDate: string;
  direction: 'pickup' | 'drop';
}): Promise<{
  data: TripAttendanceRow[];
  assigned: number;
  summary: { boarded: number; alighted: number; absent: number; unmarked: number };
}> {
  const qs = new URLSearchParams(input).toString();
  const result = await gatewayFetch<{
    data: TripAttendanceRow[];
    assigned: number;
    summary: { boarded: number; alighted: number; absent: number; unmarked: number };
  }>(`/transport/attendance?${qs}`, { throwOnError: false, next: { revalidate: 0 } });
  return {
    data: result.data?.data ?? [],
    assigned: result.data?.assigned ?? 0,
    summary: result.data?.summary ?? { boarded: 0, alighted: 0, absent: 0, unmarked: 0 },
  };
}

export async function upsertTripAttendance(input: {
  routeId: string;
  tripDate: string;
  direction: 'pickup' | 'drop';
  studentId: string;
  stopId?: string;
  status: 'boarded' | 'alighted' | 'absent';
}): Promise<TripAttendanceRow> {
  const result = await gatewayFetch<TripAttendanceRow>('/transport/attendance', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'WRITE_FAILED',
      message: result.error?.message ?? 'Failed to record attendance',
    });
  }
  return result.data;
}

export interface AlertRule {
  id: string;
  kind: 'delay_minutes' | 'geofence_exit' | 'missed_pickup';
  threshold: number;
  channels: string[];
  routeId: string | null;
  isActive: boolean;
}

export async function listAlertRules(): Promise<AlertRule[]> {
  const result = await gatewayFetch<{ data: AlertRule[] }>('/transport/alert-rules', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function createAlertRule(input: {
  kind: AlertRule['kind'];
  threshold: number;
  channels?: string[];
  routeId?: string;
}): Promise<AlertRule> {
  const result = await gatewayFetch<AlertRule>('/transport/alert-rules', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CREATE_FAILED',
      message: result.error?.message ?? 'Failed to create alert rule',
    });
  }
  return result.data;
}

export interface TransportAlert {
  id: string;
  kind: string;
  message: string;
  vehicleId: string | null;
  routeId: string | null;
  studentId: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
}

export async function listAlerts(): Promise<TransportAlert[]> {
  const result = await gatewayFetch<{ data: TransportAlert[] }>('/transport/alerts', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function evaluateAlerts(input: { tripDate?: string; routeId?: string } = {}) {
  const result = await gatewayFetch<{ data: TransportAlert[]; evaluated: number }>(
    '/transport/alerts/evaluate',
    { method: 'POST', json: input },
  );
  return result.data ?? { data: [], evaluated: 0 };
}

export async function acknowledgeAlert(id: string): Promise<TransportAlert> {
  const result = await gatewayFetch<TransportAlert>(`/transport/alerts/${id}/acknowledge`, {
    method: 'POST',
    json: {},
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'WRITE_FAILED',
      message: result.error?.message ?? 'Failed to acknowledge alert',
    });
  }
  return result.data;
}

export interface TransportFeeBand {
  id: string;
  name: string;
  routeId: string | null;
  stopId: string | null;
  minDistanceKm: number | null;
  maxDistanceKm: number | null;
  amountCents: number;
  currency: string;
  feesStructureId: string | null;
}

export async function listTransportFeeStructures(): Promise<TransportFeeBand[]> {
  const result = await gatewayFetch<{ data: TransportFeeBand[] }>('/transport/fee-structures', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function createTransportFeeStructure(input: {
  name: string;
  routeId?: string;
  stopId?: string;
  minDistanceKm?: number;
  maxDistanceKm?: number;
  amountCents: number;
  currency?: string;
}): Promise<TransportFeeBand> {
  const result = await gatewayFetch<TransportFeeBand>('/transport/fee-structures', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CREATE_FAILED',
      message: result.error?.message ?? 'Failed to create fee band',
    });
  }
  return result.data;
}

export async function listFeeLinks(): Promise<
  Array<{ id: string; assignmentId: string; status: string; feesInvoiceId: string | null; reason: string | null }>
> {
  const result = await gatewayFetch<{
    data: Array<{
      id: string;
      assignmentId: string;
      status: string;
      feesInvoiceId: string | null;
      reason: string | null;
    }>;
  }>('/transport/fee-links', { throwOnError: false, next: { revalidate: 0 } });
  return result.data?.data ?? [];
}

export type { StudentAssignment };
