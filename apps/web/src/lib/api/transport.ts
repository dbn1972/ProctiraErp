/**
 * Transport service client (server-side).
 *
 * Wraps gateway routes under `/transport/*` for routes, stops, vehicles,
 * and student assignments. Gracefully returns empty data when the gateway
 * is unreachable so the UI still renders.
 */
import { gatewayFetch } from './gateway';

export type TransportRouteStatus = 'active' | 'inactive' | 'suspended';
export type VehicleStatus = 'active' | 'inactive' | 'maintenance' | 'retired';

export interface TransportRoute {
  id: string;
  name: string;
  description: string | null;
  status: TransportRouteStatus;
  startLocation: string;
  endLocation: string;
  distanceKm: number | null;
  estimatedDurationMinutes: number | null;
  operatingDays: string[];
  departureTime: string | null;
  returnTime: string | null;
  institutionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RouteStop {
  id: string;
  routeId: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  stopOrder: number;
  pickupTime: string | null;
  dropoffTime: string | null;
}

export interface Vehicle {
  id: string;
  registrationNumber: string;
  make: string | null;
  model: string | null;
  year: number | null;
  capacity: number;
  status: VehicleStatus;
  insuranceExpiry: string | null;
  lastServiceDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudentRouteAssignment {
  id: string;
  studentId: string;
  routeId: string;
  stopId: string | null;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
}

interface ListMeta {
  page?: number;
  pageSize?: number;
  totalItems?: number;
  total?: number;
}

function unwrapList<T>(payload: { data?: T[]; meta?: ListMeta } | T[] | null | undefined): T[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  return payload.data ?? [];
}

export async function listTransportRoutes(options?: {
  status?: TransportRouteStatus;
  search?: string;
}): Promise<TransportRoute[]> {
  const params = new URLSearchParams();
  if (options?.status) params.set('status', options.status);
  if (options?.search) params.set('search', options.search);
  params.set('pageSize', '100');
  const qs = params.toString();
  const result = await gatewayFetch<{ data: TransportRoute[]; meta?: ListMeta }>(
    `/transport/routes${qs ? `?${qs}` : ''}`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return unwrapList(result.data);
}

export async function getTransportRoute(id: string): Promise<TransportRoute | null> {
  const result = await gatewayFetch<TransportRoute>(`/transport/routes/${id}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data;
}

export async function listRouteStops(routeId: string): Promise<RouteStop[]> {
  const result = await gatewayFetch<{ data: RouteStop[] } | RouteStop[]>(
    `/transport/routes/${routeId}/stops`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return unwrapList(result.data);
}

export async function listVehicles(options?: {
  status?: VehicleStatus;
  search?: string;
}): Promise<Vehicle[]> {
  const params = new URLSearchParams();
  if (options?.status) params.set('status', options.status);
  if (options?.search) params.set('search', options.search);
  params.set('pageSize', '100');
  const qs = params.toString();
  const result = await gatewayFetch<{ data: Vehicle[]; meta?: ListMeta }>(
    `/transport/vehicles${qs ? `?${qs}` : ''}`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return unwrapList(result.data);
}

export async function listStudentAssignments(options?: {
  routeId?: string;
  isActive?: boolean;
}): Promise<StudentRouteAssignment[]> {
  const params = new URLSearchParams();
  if (options?.routeId) params.set('routeId', options.routeId);
  if (options?.isActive !== undefined) params.set('isActive', String(options.isActive));
  params.set('pageSize', '100');
  const qs = params.toString();
  const result = await gatewayFetch<{ data: StudentRouteAssignment[] } | StudentRouteAssignment[]>(
    `/transport/student-assignments${qs ? `?${qs}` : ''}`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return unwrapList(result.data);
}
