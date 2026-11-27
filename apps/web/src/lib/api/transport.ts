/**
 * Transport service client — routes, vehicles, assignments.
 */
import { GatewayError, gatewayFetch } from './gateway';
import { gatewayFetchAllPagesWithTotal, type AllPagesResult } from './gateway-all-pages';

/**
 * T-D2: the transport list endpoints return 20 rows unless asked for more, so the
 * list readers below follow every page. The `*WithTotal` readers also return the
 * list's total, for screens that print a count.
 */
export type TransportList<T> = AllPagesResult<T>;

const LIST_INIT = { next: { revalidate: 0 } } as const;

export type TransportRouteStatus = 'active' | 'inactive' | 'suspended';

export type OperatingDay =
  'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

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

export async function listTransportRoutesWithTotal(): Promise<TransportList<TransportRoute>> {
  const list = await gatewayFetchAllPagesWithTotal<Record<string, unknown>>(
    '/transport/routes',
    LIST_INIT,
  );
  return { ...list, items: list.items.map(mapRoute) };
}

export async function listTransportRoutes(): Promise<TransportRoute[]> {
  return (await listTransportRoutesWithTotal()).items;
}

export async function getTransportRoute(id: string): Promise<TransportRoute | null> {
  const result = await gatewayFetch<Record<string, unknown>>(
    `/transport/routes/${encodeURIComponent(id)}`,
    {
      throwOnError: false,
      next: { revalidate: 0 },
    },
  );
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

export async function listTransportVehiclesWithTotal(): Promise<TransportList<TransportVehicle>> {
  const list = await gatewayFetchAllPagesWithTotal<Record<string, unknown>>(
    '/transport/vehicles',
    LIST_INIT,
  );
  return { ...list, items: list.items.map(mapVehicle) };
}

export async function listTransportVehicles(): Promise<TransportVehicle[]> {
  return (await listTransportVehiclesWithTotal()).items;
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

export function listDriverAssignmentsWithTotal(): Promise<TransportList<DriverAssignment>> {
  return gatewayFetchAllPagesWithTotal<DriverAssignment>(
    '/transport/driver-assignments',
    LIST_INIT,
  );
}

export async function listDriverAssignments(): Promise<DriverAssignment[]> {
  return (await listDriverAssignmentsWithTotal()).items;
}

export function listStudentAssignmentsWithTotal(): Promise<TransportList<StudentAssignment>> {
  return gatewayFetchAllPagesWithTotal<StudentAssignment>(
    '/transport/student-assignments',
    LIST_INIT,
  );
}

export async function listStudentAssignments(): Promise<StudentAssignment[]> {
  return (await listStudentAssignmentsWithTotal()).items;
}

/**
 * PRC-M130: the riders of one route whose active assignment covers `tripDate`
 * (`GET /transport/student-assignments?routeId&isActive=true&activeOn`).
 */
export async function listTripRiders(input: {
  routeId: string;
  tripDate: string;
}): Promise<StudentAssignment[]> {
  const qs = new URLSearchParams({
    routeId: input.routeId,
    isActive: 'true',
    activeOn: input.tripDate,
  }).toString();
  return (
    await gatewayFetchAllPagesWithTotal<StudentAssignment>(
      `/transport/student-assignments?${qs}`,
      LIST_INIT,
    )
  ).items;
}

export async function createDriverAssignment(input: {
  vehicleId: string;
  driverId: string;
  routeId?: string;
  startDate: string;
  endDate?: string;
}): Promise<DriverAssignment> {
  const result = await gatewayFetch<DriverAssignment>('/transport/driver-assignments', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CREATE_FAILED',
      message: result.error?.message ?? 'Failed to create driver assignment',
    });
  }
  return result.data;
}

export async function createStudentAssignment(input: {
  studentId: string;
  routeId: string;
  stopId?: string;
  startDate: string;
  endDate?: string;
}): Promise<StudentAssignment> {
  const result = await gatewayFetch<StudentAssignment>('/transport/student-assignments', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CREATE_FAILED',
      message: result.error?.message ?? 'Failed to create student assignment',
    });
  }
  return result.data;
}
