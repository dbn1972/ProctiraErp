/**
 * Prisma Transport Repository
 *
 * Production implementation of {@link TransportRepository} backed by
 * PostgreSQL via Prisma. Tenant-scoped reads/writes run inside
 * {@link withTenantTransaction} so the `app.current_tenant_id` RLS variable is
 * bound on the same connection that executes the query; `tenantId` is also kept
 * in every `where` clause as defense-in-depth.
 *
 * JSONB round-trips: route `operatingDays` (string[]) is cast with
 * {@link Prisma.InputJsonValue} on write and parsed back to `string[]` on read.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { withTenantTransaction } from '@proctira/database';
import type { Prisma, PrismaClient } from '@proctira/database';

import type {
  DriverAssignmentEntity,
  DriverAssignmentFilter,
  RouteFilter,
  RouteStatus,
  RouteStopEntity,
  StudentAssignmentFilter,
  StudentRouteAssignmentEntity,
  TransportRepository,
  TransportRouteEntity,
  VehicleEntity,
  VehicleFilter,
  VehicleStatus,
} from './transport-repository.js';

// ─── Row shapes ──────────────────────────────────────────────────────────────

interface RouteRow {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  status: string;
  startLocation: string;
  endLocation: string;
  distanceKm: number | null;
  estimatedDurationMinutes: number | null;
  operatingDays: unknown;
  departureTime: string | null;
  returnTime: string | null;
  institutionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface StopRow {
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

interface VehicleRow {
  id: string;
  tenantId: string;
  registrationNumber: string;
  make: string | null;
  model: string | null;
  year: number | null;
  capacity: number;
  status: string;
  insuranceExpiry: string | null;
  lastServiceDate: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface DriverAssignmentRow {
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

interface StudentAssignmentRow {
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function parseOperatingDays(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]) : [];
}

function toRouteEntity(row: RouteRow): TransportRouteEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    description: row.description,
    status: row.status as RouteStatus,
    startLocation: row.startLocation,
    endLocation: row.endLocation,
    distanceKm: row.distanceKm,
    estimatedDurationMinutes: row.estimatedDurationMinutes,
    operatingDays: parseOperatingDays(row.operatingDays),
    departureTime: row.departureTime,
    returnTime: row.returnTime,
    institutionId: row.institutionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toStopEntity(row: StopRow): RouteStopEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    routeId: row.routeId,
    name: row.name,
    latitude: row.latitude,
    longitude: row.longitude,
    stopOrder: row.stopOrder,
    pickupTime: row.pickupTime,
    dropoffTime: row.dropoffTime,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toVehicleEntity(row: VehicleRow): VehicleEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    registrationNumber: row.registrationNumber,
    make: row.make,
    model: row.model,
    year: row.year,
    capacity: row.capacity,
    status: row.status as VehicleStatus,
    insuranceExpiry: row.insuranceExpiry,
    lastServiceDate: row.lastServiceDate,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDriverAssignmentEntity(row: DriverAssignmentRow): DriverAssignmentEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    vehicleId: row.vehicleId,
    driverId: row.driverId,
    routeId: row.routeId,
    startDate: row.startDate,
    endDate: row.endDate,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toStudentAssignmentEntity(
  row: StudentAssignmentRow,
): StudentRouteAssignmentEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    studentId: row.studentId,
    routeId: row.routeId,
    stopId: row.stopId,
    startDate: row.startDate,
    endDate: row.endDate,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function pageWindow(pagination: PaginationOptions): {
  page: number;
  pageSize: number;
  skip: number;
} {
  const page = Math.max(1, pagination.page ?? 1);
  const pageSize = Math.max(1, pagination.pageSize ?? 20);
  return { page, pageSize, skip: (page - 1) * pageSize };
}

function paginatedMeta(
  page: number,
  pageSize: number,
  totalItems: number,
): PaginatedResult<never>['meta'] {
  return {
    page,
    pageSize,
    totalItems,
    totalPages: Math.ceil(totalItems / pageSize) || 1,
  };
}

export class PrismaTransportRepository implements TransportRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // ─── Route Operations ────────────────────────────────────────────────────

  async createRoute(
    data: Omit<TransportRouteEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<TransportRouteEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.transportRoute.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          name: data.name,
          description: data.description,
          status: data.status,
          startLocation: data.startLocation,
          endLocation: data.endLocation,
          distanceKm: data.distanceKm,
          estimatedDurationMinutes: data.estimatedDurationMinutes,
          operatingDays: toJsonValue(data.operatingDays),
          departureTime: data.departureTime,
          returnTime: data.returnTime,
          institutionId: data.institutionId,
        },
      })) as RouteRow;
      return toRouteEntity(row);
    });
  }

  async updateRoute(
    id: string,
    tenantId: string,
    data: Partial<TransportRouteEntity>,
  ): Promise<TransportRouteEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.transportRoute.findFirst({
        where: { id, tenantId },
      })) as RouteRow | null;
      if (!existing) return null;

      const updateData: Prisma.TransportRouteUpdateInput = {};
      if (data.name !== undefined) updateData.name = data.name;
      if (data.description !== undefined) updateData.description = data.description;
      if (data.status !== undefined) updateData.status = data.status;
      if (data.startLocation !== undefined) {
        updateData.startLocation = data.startLocation;
      }
      if (data.endLocation !== undefined) updateData.endLocation = data.endLocation;
      if (data.distanceKm !== undefined) updateData.distanceKm = data.distanceKm;
      if (data.estimatedDurationMinutes !== undefined) {
        updateData.estimatedDurationMinutes = data.estimatedDurationMinutes;
      }
      if (data.operatingDays !== undefined) {
        updateData.operatingDays = toJsonValue(data.operatingDays);
      }
      if (data.departureTime !== undefined) {
        updateData.departureTime = data.departureTime;
      }
      if (data.returnTime !== undefined) updateData.returnTime = data.returnTime;
      if (data.institutionId !== undefined) {
        updateData.institutionId = data.institutionId;
      }

      const row = (await tx.transportRoute.update({
        where: { id },
        data: updateData,
      })) as RouteRow;
      return toRouteEntity(row);
    });
  }

  async findRouteById(
    id: string,
    tenantId: string,
  ): Promise<TransportRouteEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.transportRoute.findFirst({
        where: { id, tenantId },
      })) as RouteRow | null;
      return row ? toRouteEntity(row) : null;
    });
  }

  async listRoutes(
    tenantId: string,
    filter: RouteFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<TransportRouteEntity>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where: Prisma.TransportRouteWhereInput = { tenantId };
      if (filter.status) where.status = filter.status;
      if (filter.institutionId) where.institutionId = filter.institutionId;
      if (filter.search) {
        where.name = { contains: filter.search, mode: 'insensitive' };
      }

      const { page, pageSize, skip } = pageWindow(pagination);
      const [totalItems, rows] = await Promise.all([
        tx.transportRoute.count({ where }),
        tx.transportRoute.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: pageSize,
        }) as Promise<RouteRow[]>,
      ]);

      return {
        data: rows.map(toRouteEntity),
        meta: paginatedMeta(page, pageSize, totalItems),
      };
    });
  }

  async deleteRoute(id: string, tenantId: string): Promise<boolean> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = await tx.transportRoute.findFirst({
        where: { id, tenantId },
        select: { id: true },
      });
      if (!existing) return false;
      await tx.transportRoute.delete({ where: { id } });
      return true;
    });
  }

  // ─── Stop Operations ─────────────────────────────────────────────────────

  async createStop(
    data: Omit<RouteStopEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<RouteStopEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.routeStop.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          routeId: data.routeId,
          name: data.name,
          latitude: data.latitude,
          longitude: data.longitude,
          stopOrder: data.stopOrder,
          pickupTime: data.pickupTime,
          dropoffTime: data.dropoffTime,
        },
      })) as StopRow;
      return toStopEntity(row);
    });
  }

  async updateStop(
    id: string,
    tenantId: string,
    data: Partial<RouteStopEntity>,
  ): Promise<RouteStopEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.routeStop.findFirst({
        where: { id, tenantId },
      })) as StopRow | null;
      if (!existing) return null;

      const updateData: Prisma.RouteStopUpdateInput = {};
      if (data.routeId !== undefined) updateData.routeId = data.routeId;
      if (data.name !== undefined) updateData.name = data.name;
      if (data.latitude !== undefined) updateData.latitude = data.latitude;
      if (data.longitude !== undefined) updateData.longitude = data.longitude;
      if (data.stopOrder !== undefined) updateData.stopOrder = data.stopOrder;
      if (data.pickupTime !== undefined) updateData.pickupTime = data.pickupTime;
      if (data.dropoffTime !== undefined) updateData.dropoffTime = data.dropoffTime;

      const row = (await tx.routeStop.update({
        where: { id },
        data: updateData,
      })) as StopRow;
      return toStopEntity(row);
    });
  }

  async findStopById(
    id: string,
    tenantId: string,
  ): Promise<RouteStopEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.routeStop.findFirst({
        where: { id, tenantId },
      })) as StopRow | null;
      return row ? toStopEntity(row) : null;
    });
  }

  async listStopsByRoute(
    routeId: string,
    tenantId: string,
  ): Promise<RouteStopEntity[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = (await tx.routeStop.findMany({
        where: { tenantId, routeId },
        orderBy: { stopOrder: 'asc' },
      })) as StopRow[];
      return rows.map(toStopEntity);
    });
  }

  async deleteStop(id: string, tenantId: string): Promise<boolean> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = await tx.routeStop.findFirst({
        where: { id, tenantId },
        select: { id: true },
      });
      if (!existing) return false;
      await tx.routeStop.delete({ where: { id } });
      return true;
    });
  }

  // ─── Vehicle Operations ──────────────────────────────────────────────────

  async createVehicle(
    data: Omit<VehicleEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<VehicleEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.vehicle.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          registrationNumber: data.registrationNumber,
          make: data.make,
          model: data.model,
          year: data.year,
          capacity: data.capacity,
          status: data.status,
          insuranceExpiry: data.insuranceExpiry,
          lastServiceDate: data.lastServiceDate,
        },
      })) as VehicleRow;
      return toVehicleEntity(row);
    });
  }

  async updateVehicle(
    id: string,
    tenantId: string,
    data: Partial<VehicleEntity>,
  ): Promise<VehicleEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.vehicle.findFirst({
        where: { id, tenantId },
      })) as VehicleRow | null;
      if (!existing) return null;

      const updateData: Prisma.VehicleUpdateInput = {};
      if (data.registrationNumber !== undefined) {
        updateData.registrationNumber = data.registrationNumber;
      }
      if (data.make !== undefined) updateData.make = data.make;
      if (data.model !== undefined) updateData.model = data.model;
      if (data.year !== undefined) updateData.year = data.year;
      if (data.capacity !== undefined) updateData.capacity = data.capacity;
      if (data.status !== undefined) updateData.status = data.status;
      if (data.insuranceExpiry !== undefined) {
        updateData.insuranceExpiry = data.insuranceExpiry;
      }
      if (data.lastServiceDate !== undefined) {
        updateData.lastServiceDate = data.lastServiceDate;
      }

      const row = (await tx.vehicle.update({
        where: { id },
        data: updateData,
      })) as VehicleRow;
      return toVehicleEntity(row);
    });
  }

  async findVehicleById(
    id: string,
    tenantId: string,
  ): Promise<VehicleEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.vehicle.findFirst({
        where: { id, tenantId },
      })) as VehicleRow | null;
      return row ? toVehicleEntity(row) : null;
    });
  }

  async findVehicleByRegistration(
    registrationNumber: string,
    tenantId: string,
  ): Promise<VehicleEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.vehicle.findFirst({
        where: { tenantId, registrationNumber },
      })) as VehicleRow | null;
      return row ? toVehicleEntity(row) : null;
    });
  }

  async listVehicles(
    tenantId: string,
    filter: VehicleFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<VehicleEntity>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where: Prisma.VehicleWhereInput = { tenantId };
      if (filter.status) where.status = filter.status;
      if (filter.search) {
        const search = filter.search;
        where.OR = [
          { registrationNumber: { contains: search, mode: 'insensitive' } },
          { make: { contains: search, mode: 'insensitive' } },
          { model: { contains: search, mode: 'insensitive' } },
        ];
      }

      const { page, pageSize, skip } = pageWindow(pagination);
      const [totalItems, rows] = await Promise.all([
        tx.vehicle.count({ where }),
        tx.vehicle.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: pageSize,
        }) as Promise<VehicleRow[]>,
      ]);

      return {
        data: rows.map(toVehicleEntity),
        meta: paginatedMeta(page, pageSize, totalItems),
      };
    });
  }

  async deleteVehicle(id: string, tenantId: string): Promise<boolean> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = await tx.vehicle.findFirst({
        where: { id, tenantId },
        select: { id: true },
      });
      if (!existing) return false;
      await tx.vehicle.delete({ where: { id } });
      return true;
    });
  }

  // ─── Driver Assignment Operations ────────────────────────────────────────

  async createDriverAssignment(
    data: Omit<DriverAssignmentEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<DriverAssignmentEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.driverAssignment.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          vehicleId: data.vehicleId,
          driverId: data.driverId,
          routeId: data.routeId,
          startDate: data.startDate,
          endDate: data.endDate,
          isActive: data.isActive,
        },
      })) as DriverAssignmentRow;
      return toDriverAssignmentEntity(row);
    });
  }

  async updateDriverAssignment(
    id: string,
    tenantId: string,
    data: Partial<DriverAssignmentEntity>,
  ): Promise<DriverAssignmentEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.driverAssignment.findFirst({
        where: { id, tenantId },
      })) as DriverAssignmentRow | null;
      if (!existing) return null;

      const updateData: Prisma.DriverAssignmentUpdateInput = {};
      if (data.vehicleId !== undefined) updateData.vehicleId = data.vehicleId;
      if (data.driverId !== undefined) updateData.driverId = data.driverId;
      if (data.routeId !== undefined) updateData.routeId = data.routeId;
      if (data.startDate !== undefined) updateData.startDate = data.startDate;
      if (data.endDate !== undefined) updateData.endDate = data.endDate;
      if (data.isActive !== undefined) updateData.isActive = data.isActive;

      const row = (await tx.driverAssignment.update({
        where: { id },
        data: updateData,
      })) as DriverAssignmentRow;
      return toDriverAssignmentEntity(row);
    });
  }

  async findDriverAssignmentById(
    id: string,
    tenantId: string,
  ): Promise<DriverAssignmentEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.driverAssignment.findFirst({
        where: { id, tenantId },
      })) as DriverAssignmentRow | null;
      return row ? toDriverAssignmentEntity(row) : null;
    });
  }

  async listDriverAssignments(
    tenantId: string,
    filter: DriverAssignmentFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<DriverAssignmentEntity>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where: Prisma.DriverAssignmentWhereInput = { tenantId };
      if (filter.vehicleId) where.vehicleId = filter.vehicleId;
      if (filter.driverId) where.driverId = filter.driverId;
      if (filter.routeId) where.routeId = filter.routeId;
      if (filter.isActive !== undefined) where.isActive = filter.isActive;

      const { page, pageSize, skip } = pageWindow(pagination);
      const [totalItems, rows] = await Promise.all([
        tx.driverAssignment.count({ where }),
        tx.driverAssignment.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: pageSize,
        }) as Promise<DriverAssignmentRow[]>,
      ]);

      return {
        data: rows.map(toDriverAssignmentEntity),
        meta: paginatedMeta(page, pageSize, totalItems),
      };
    });
  }

  async findActiveDriverAssignment(
    vehicleId: string,
    tenantId: string,
  ): Promise<DriverAssignmentEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.driverAssignment.findFirst({
        where: { tenantId, vehicleId, isActive: true },
      })) as DriverAssignmentRow | null;
      return row ? toDriverAssignmentEntity(row) : null;
    });
  }

  // ─── Student Assignment Operations ───────────────────────────────────────

  async createStudentAssignment(
    data: Omit<StudentRouteAssignmentEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<StudentRouteAssignmentEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.studentRouteAssignment.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          studentId: data.studentId,
          routeId: data.routeId,
          stopId: data.stopId,
          startDate: data.startDate,
          endDate: data.endDate,
          isActive: data.isActive,
        },
      })) as StudentAssignmentRow;
      return toStudentAssignmentEntity(row);
    });
  }

  async updateStudentAssignment(
    id: string,
    tenantId: string,
    data: Partial<StudentRouteAssignmentEntity>,
  ): Promise<StudentRouteAssignmentEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.studentRouteAssignment.findFirst({
        where: { id, tenantId },
      })) as StudentAssignmentRow | null;
      if (!existing) return null;

      const updateData: Prisma.StudentRouteAssignmentUpdateInput = {};
      if (data.studentId !== undefined) updateData.studentId = data.studentId;
      if (data.routeId !== undefined) updateData.routeId = data.routeId;
      if (data.stopId !== undefined) updateData.stopId = data.stopId;
      if (data.startDate !== undefined) updateData.startDate = data.startDate;
      if (data.endDate !== undefined) updateData.endDate = data.endDate;
      if (data.isActive !== undefined) updateData.isActive = data.isActive;

      const row = (await tx.studentRouteAssignment.update({
        where: { id },
        data: updateData,
      })) as StudentAssignmentRow;
      return toStudentAssignmentEntity(row);
    });
  }

  async findStudentAssignmentById(
    id: string,
    tenantId: string,
  ): Promise<StudentRouteAssignmentEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.studentRouteAssignment.findFirst({
        where: { id, tenantId },
      })) as StudentAssignmentRow | null;
      return row ? toStudentAssignmentEntity(row) : null;
    });
  }

  async listStudentAssignments(
    tenantId: string,
    filter: StudentAssignmentFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<StudentRouteAssignmentEntity>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where: Prisma.StudentRouteAssignmentWhereInput = { tenantId };
      if (filter.studentId) where.studentId = filter.studentId;
      if (filter.routeId) where.routeId = filter.routeId;
      if (filter.stopId) where.stopId = filter.stopId;
      if (filter.isActive !== undefined) where.isActive = filter.isActive;

      const { page, pageSize, skip } = pageWindow(pagination);
      const [totalItems, rows] = await Promise.all([
        tx.studentRouteAssignment.count({ where }),
        tx.studentRouteAssignment.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: pageSize,
        }) as Promise<StudentAssignmentRow[]>,
      ]);

      return {
        data: rows.map(toStudentAssignmentEntity),
        meta: paginatedMeta(page, pageSize, totalItems),
      };
    });
  }

  async findActiveStudentAssignment(
    studentId: string,
    tenantId: string,
  ): Promise<StudentRouteAssignmentEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.studentRouteAssignment.findFirst({
        where: { tenantId, studentId, isActive: true },
      })) as StudentAssignmentRow | null;
      return row ? toStudentAssignmentEntity(row) : null;
    });
  }
}
