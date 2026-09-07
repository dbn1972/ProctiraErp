/**
 * Transport service client — routes, vehicles, assignments.
 */
import { GatewayError, gatewayFetch } from './gateway';

export type TransportRouteStatus = 'active' | 'inactive' | 'suspended';

export type OperatingDay =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export interface TransportRoute {
  id: string;
  tenantId: string;
  name: string;
  description?: string | null;
  status: TransportRouteStatus;
  startLocation: string;
  endLocation: string;
  distanceKm?: number | null;
  estimatedDurationMinutes?: number | null;
  operatingDays: OperatingDay[];
  departureTime?: string | null;
  returnTime?: string | null;
  institutionId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTransportRouteInput {
  name: string;
  description?: string;
  startLocation: string;
  endLocation: string;
  distanceKm?: number;
  estimatedDurationMinutes?: number;
  operatingDays: OperatingDay[];
  departureTime?: string;
  returnTime?: string;
}

function mapRoute(raw: Record<string, unknown>): TransportRoute {
  return {
    id: String(raw['id'] ?? ''),
    tenantId: String(raw['tenantId'] ?? ''),
    name: String(raw['name'] ?? ''),
    description: (raw['description'] as string | null | undefined) ?? null,
    status: (raw['status'] as TransportRouteStatus) ?? 'active',
    startLocation: String(raw['startLocation'] ?? ''),
    endLocation: String(raw['endLocation'] ?? ''),
    distanceKm: (raw['distanceKm'] as number | null | undefined) ?? null,
    estimatedDurationMinutes:
      (raw['estimatedDurationMinutes'] as number | null | undefined) ?? null,
    operatingDays: Array.isArray(raw['operatingDays'])
      ? (raw['operatingDays'] as OperatingDay[])
      : [],
    departureTime: (raw['departureTime'] as string | null | undefined) ?? null,
    returnTime: (raw['returnTime'] as string | null | undefined) ?? null,
    institutionId: (raw['institutionId'] as string | null | undefined) ?? null,
    createdAt: String(raw['createdAt'] ?? ''),
    updatedAt: String(raw['updatedAt'] ?? ''),
  };
}

export async function listTransportRoutes(): Promise<TransportRoute[]> {
  const result = await gatewayFetch<{ data: Record<string, unknown>[] }>('/transport/routes', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return (result.data?.data ?? []).map(mapRoute);
}

export async function getTransportRoute(id: string): Promise<TransportRoute | null> {
  const result = await gatewayFetch<Record<string, unknown>>(`/transport/routes/${id}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data ? mapRoute(result.data) : null;
}

export async function createTransportRoute(
  input: CreateTransportRouteInput,
): Promise<TransportRoute> {
  const result = await gatewayFetch<Record<string, unknown>>('/transport/routes', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CREATE_FAILED',
      message: result.error?.message ?? 'Failed to create transport route',
    });
  }
  return mapRoute(result.data);
}

export interface TransportVehicle {
  id: string;
  tenantId: string;
  registrationNumber: string;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  capacity: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTransportVehicleInput {
  registrationNumber: string;
  make?: string;
  model?: string;
  year?: number;
  capacity: number;
}

function mapVehicle(raw: Record<string, unknown>): TransportVehicle {
  return {
    id: String(raw['id'] ?? ''),
    tenantId: String(raw['tenantId'] ?? ''),
    registrationNumber: String(raw['registrationNumber'] ?? ''),
    make: (raw['make'] as string | null | undefined) ?? null,
    model: (raw['model'] as string | null | undefined) ?? null,
    year: (raw['year'] as number | null | undefined) ?? null,
    capacity: Number(raw['capacity'] ?? 0),
    status: String(raw['status'] ?? 'active'),
    createdAt: String(raw['createdAt'] ?? ''),
    updatedAt: String(raw['updatedAt'] ?? ''),
  };
}

export async function listTransportVehicles(): Promise<TransportVehicle[]> {
  const result = await gatewayFetch<{ data: Record<string, unknown>[] }>('/transport/vehicles', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return (result.data?.data ?? []).map(mapVehicle);
}

export async function createTransportVehicle(
  input: CreateTransportVehicleInput,
): Promise<TransportVehicle> {
  const result = await gatewayFetch<Record<string, unknown>>('/transport/vehicles', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CREATE_FAILED',
      message: result.error?.message ?? 'Failed to create vehicle',
    });
  }
  return mapVehicle(result.data);
}

export interface DriverAssignment {
  id: string;
  vehicleId: string;
  driverId: string;
  routeId?: string | null;
  startDate: string;
  endDate?: string | null;
  isActive: boolean;
}

export interface StudentAssignment {
  id: string;
  studentId: string;
  routeId: string;
  stopId?: string | null;
  startDate: string;
  endDate?: string | null;
  isActive: boolean;
}

export async function listDriverAssignments(): Promise<DriverAssignment[]> {
  const result = await gatewayFetch<{ data: DriverAssignment[] }>('/transport/driver-assignments', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function listStudentAssignments(): Promise<StudentAssignment[]> {
  const result = await gatewayFetch<{ data: StudentAssignment[] }>(
    '/transport/student-assignments',
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data?.data ?? [];
}
