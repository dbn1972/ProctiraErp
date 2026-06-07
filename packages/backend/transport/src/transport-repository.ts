/**
 * Transport Repository Interface
 *
 * Defines the data access contract for transport operations.
 * Implementations can use Prisma, in-memory stores, or other backends.
 *
 * Requirements: 1.2 (Transport_Module)
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';

// ─── Transport Route Entity ──────────────────────────────────────────────────

export type RouteStatus = 'active' | 'inactive' | 'suspended';

export interface TransportRouteEntity {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  status: RouteStatus;
  startLocation: string;
  endLocation: string;
  distanceKm: number | null;
  estimatedDurationMinutes: number | null;
  operatingDays: string[];
  departureTime: string | null;
  returnTime: string | null;
  institutionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RouteFilter {
  status?: RouteStatus;
  institutionId?: string;
  search?: string;
}

// ─── Route Stop Entity ───────────────────────────────────────────────────────

export interface RouteStopEntity {
  id: string;
  tenantId: string;
  routeId: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  stopOrder: number;
  pickupTime: string | null;
  dropoffTime: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Vehicle Entity ──────────────────────────────────────────────────────────

export type VehicleStatus = 'active' | 'inactive' | 'maintenance' | 'retired';

export interface VehicleEntity {
  id: string;
  tenantId: string;
  registrationNumber: string;
  make: string | null;
  model: string | null;
  year: number | null;
  capacity: number;
  status: VehicleStatus;
  insuranceExpiry: string | null;
  lastServiceDate: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface VehicleFilter {
  status?: VehicleStatus;
  search?: string;
}

// ─── Driver Assignment Entity ────────────────────────────────────────────────

export interface DriverAssignmentEntity {
  id: string;
  tenantId: string;
  vehicleId: string;
  driverId: string;
  routeId: string | null;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DriverAssignmentFilter {
  vehicleId?: string;
  driverId?: string;
  routeId?: string;
  isActive?: boolean;
}

// ─── Student Assignment Entity ───────────────────────────────────────────────

export interface StudentRouteAssignmentEntity {
  id: string;
  tenantId: string;
  studentId: string;
  routeId: string;
  stopId: string | null;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface StudentAssignmentFilter {
  studentId?: string;
  routeId?: string;
  stopId?: string;
  isActive?: boolean;
}

// ─── Repository Interface ────────────────────────────────────────────────────

export interface TransportRepository {
  // Route operations
  createRoute(data: Omit<TransportRouteEntity, 'createdAt' | 'updatedAt'>): Promise<TransportRouteEntity>;
  updateRoute(id: string, tenantId: string, data: Partial<TransportRouteEntity>): Promise<TransportRouteEntity | null>;
  findRouteById(id: string, tenantId: string): Promise<TransportRouteEntity | null>;
  listRoutes(tenantId: string, filter: RouteFilter, pagination: PaginationOptions): Promise<PaginatedResult<TransportRouteEntity>>;
  deleteRoute(id: string, tenantId: string): Promise<boolean>;

  // Route stop operations
  createStop(data: Omit<RouteStopEntity, 'createdAt' | 'updatedAt'>): Promise<RouteStopEntity>;
  updateStop(id: string, tenantId: string, data: Partial<RouteStopEntity>): Promise<RouteStopEntity | null>;
  findStopById(id: string, tenantId: string): Promise<RouteStopEntity | null>;
  listStopsByRoute(routeId: string, tenantId: string): Promise<RouteStopEntity[]>;
  deleteStop(id: string, tenantId: string): Promise<boolean>;

  // Vehicle operations
  createVehicle(data: Omit<VehicleEntity, 'createdAt' | 'updatedAt'>): Promise<VehicleEntity>;
  updateVehicle(id: string, tenantId: string, data: Partial<VehicleEntity>): Promise<VehicleEntity | null>;
  findVehicleById(id: string, tenantId: string): Promise<VehicleEntity | null>;
  findVehicleByRegistration(registrationNumber: string, tenantId: string): Promise<VehicleEntity | null>;
  listVehicles(tenantId: string, filter: VehicleFilter, pagination: PaginationOptions): Promise<PaginatedResult<VehicleEntity>>;
  deleteVehicle(id: string, tenantId: string): Promise<boolean>;

  // Driver assignment operations
  createDriverAssignment(data: Omit<DriverAssignmentEntity, 'createdAt' | 'updatedAt'>): Promise<DriverAssignmentEntity>;
  updateDriverAssignment(id: string, tenantId: string, data: Partial<DriverAssignmentEntity>): Promise<DriverAssignmentEntity | null>;
  findDriverAssignmentById(id: string, tenantId: string): Promise<DriverAssignmentEntity | null>;
  listDriverAssignments(tenantId: string, filter: DriverAssignmentFilter, pagination: PaginationOptions): Promise<PaginatedResult<DriverAssignmentEntity>>;
  findActiveDriverAssignment(vehicleId: string, tenantId: string): Promise<DriverAssignmentEntity | null>;

  // Student route assignment operations
  createStudentAssignment(data: Omit<StudentRouteAssignmentEntity, 'createdAt' | 'updatedAt'>): Promise<StudentRouteAssignmentEntity>;
  updateStudentAssignment(id: string, tenantId: string, data: Partial<StudentRouteAssignmentEntity>): Promise<StudentRouteAssignmentEntity | null>;
  findStudentAssignmentById(id: string, tenantId: string): Promise<StudentRouteAssignmentEntity | null>;
  listStudentAssignments(tenantId: string, filter: StudentAssignmentFilter, pagination: PaginationOptions): Promise<PaginatedResult<StudentRouteAssignmentEntity>>;
  findActiveStudentAssignment(studentId: string, tenantId: string): Promise<StudentRouteAssignmentEntity | null>;
}
