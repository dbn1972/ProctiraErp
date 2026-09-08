/**
 * In-Memory Transport Repository
 *
 * Used for unit testing without database dependencies.
 * Implements the TransportRepository interface with Map-based stores.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';

import type {
  TransportRouteEntity,
  RouteStopEntity,
  VehicleEntity,
  DriverAssignmentEntity,
  StudentRouteAssignmentEntity,
  RouteFilter,
  VehicleFilter,
  DriverAssignmentFilter,
  StudentAssignmentFilter,
  TransportRepository,
} from './transport-repository.js';

export class InMemoryTransportRepository implements TransportRepository {
  private routes: Map<string, TransportRouteEntity> = new Map();
  private stops: Map<string, RouteStopEntity> = new Map();
  private vehicles: Map<string, VehicleEntity> = new Map();
  private driverAssignments: Map<string, DriverAssignmentEntity> = new Map();
  private studentAssignments: Map<string, StudentRouteAssignmentEntity> = new Map();

  // ─── Route Operations ────────────────────────────────────────────────────

  async createRoute(
    data: Omit<TransportRouteEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<TransportRouteEntity> {
    const now = new Date();
    const entity: TransportRouteEntity = { ...data, createdAt: now, updatedAt: now };
    this.routes.set(entity.id, entity);
    return entity;
  }

  async updateRoute(
    id: string,
    tenantId: string,
    data: Partial<TransportRouteEntity>,
  ): Promise<TransportRouteEntity | null> {
    const existing = this.routes.get(id);
    if (!existing || existing.tenantId !== tenantId) return null;
    const updated: TransportRouteEntity = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.routes.set(id, updated);
    return updated;
  }

  async findRouteById(id: string, tenantId: string): Promise<TransportRouteEntity | null> {
    const entity = this.routes.get(id);
    if (!entity || entity.tenantId !== tenantId) return null;
    return entity;
  }

  async listRoutes(
    tenantId: string,
    filter: RouteFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<TransportRouteEntity>> {
    let items = Array.from(this.routes.values()).filter((e) => e.tenantId === tenantId);

    if (filter.status) {
      items = items.filter((e) => e.status === filter.status);
    }
    if (filter.institutionId) {
      items = items.filter((e) => e.institutionId === filter.institutionId);
    }
    if (filter.search) {
      const search = filter.search.toLowerCase();
      items = items.filter((e) => e.name.toLowerCase().includes(search));
    }

    const totalItems = items.length;
    const totalPages = Math.ceil(totalItems / pagination.pageSize);
    const start = (pagination.page - 1) * pagination.pageSize;
    const data = items.slice(start, start + pagination.pageSize);

    return {
      data,
      meta: { page: pagination.page, pageSize: pagination.pageSize, totalItems, totalPages },
    };
  }

  async deleteRoute(id: string, tenantId: string): Promise<boolean> {
    const existing = this.routes.get(id);
    if (!existing || existing.tenantId !== tenantId) return false;
    this.routes.delete(id);
    return true;
  }

  // ─── Stop Operations ─────────────────────────────────────────────────────

  async createStop(
    data: Omit<RouteStopEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<RouteStopEntity> {
    const now = new Date();
    const entity: RouteStopEntity = { ...data, createdAt: now, updatedAt: now };
    this.stops.set(entity.id, entity);
    return entity;
  }

  async updateStop(
    id: string,
    tenantId: string,
    data: Partial<RouteStopEntity>,
  ): Promise<RouteStopEntity | null> {
    const existing = this.stops.get(id);
    if (!existing || existing.tenantId !== tenantId) return null;
    const updated: RouteStopEntity = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.stops.set(id, updated);
    return updated;
  }

  async findStopById(id: string, tenantId: string): Promise<RouteStopEntity | null> {
    const entity = this.stops.get(id);
    if (!entity || entity.tenantId !== tenantId) return null;
    return entity;
  }

  async listStopsByRoute(routeId: string, tenantId: string): Promise<RouteStopEntity[]> {
    return Array.from(this.stops.values())
      .filter((e) => e.tenantId === tenantId && e.routeId === routeId)
      .sort((a, b) => a.stopOrder - b.stopOrder);
  }

  async deleteStop(id: string, tenantId: string): Promise<boolean> {
    const existing = this.stops.get(id);
    if (!existing || existing.tenantId !== tenantId) return false;
    this.stops.delete(id);
    return true;
  }

  // ─── Vehicle Operations ──────────────────────────────────────────────────

  async createVehicle(
    data: Omit<VehicleEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<VehicleEntity> {
    const now = new Date();
    const entity: VehicleEntity = { ...data, createdAt: now, updatedAt: now };
    this.vehicles.set(entity.id, entity);
    return entity;
  }

  async updateVehicle(
    id: string,
    tenantId: string,
    data: Partial<VehicleEntity>,
  ): Promise<VehicleEntity | null> {
    const existing = this.vehicles.get(id);
    if (!existing || existing.tenantId !== tenantId) return null;
    const updated: VehicleEntity = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.vehicles.set(id, updated);
    return updated;
  }

  async findVehicleById(id: string, tenantId: string): Promise<VehicleEntity | null> {
    const entity = this.vehicles.get(id);
    if (!entity || entity.tenantId !== tenantId) return null;
    return entity;
  }

  async findVehicleByRegistration(
    registrationNumber: string,
    tenantId: string,
  ): Promise<VehicleEntity | null> {
    return (
      Array.from(this.vehicles.values()).find(
        (e) => e.tenantId === tenantId && e.registrationNumber === registrationNumber,
      ) ?? null
    );
  }

  async listVehicles(
    tenantId: string,
    filter: VehicleFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<VehicleEntity>> {
    let items = Array.from(this.vehicles.values()).filter((e) => e.tenantId === tenantId);

    if (filter.status) {
      items = items.filter((e) => e.status === filter.status);
    }
    if (filter.search) {
      const search = filter.search.toLowerCase();
      items = items.filter(
        (e) =>
          e.registrationNumber.toLowerCase().includes(search) ||
          (e.make && e.make.toLowerCase().includes(search)) ||
          (e.model && e.model.toLowerCase().includes(search)),
      );
    }

    const totalItems = items.length;
    const totalPages = Math.ceil(totalItems / pagination.pageSize);
    const start = (pagination.page - 1) * pagination.pageSize;
    const data = items.slice(start, start + pagination.pageSize);

    return {
      data,
      meta: { page: pagination.page, pageSize: pagination.pageSize, totalItems, totalPages },
    };
  }

  async deleteVehicle(id: string, tenantId: string): Promise<boolean> {
    const existing = this.vehicles.get(id);
    if (!existing || existing.tenantId !== tenantId) return false;
    this.vehicles.delete(id);
    return true;
  }

  // ─── Driver Assignment Operations ────────────────────────────────────────

  async createDriverAssignment(
    data: Omit<DriverAssignmentEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<DriverAssignmentEntity> {
    const now = new Date();
    const entity: DriverAssignmentEntity = { ...data, createdAt: now, updatedAt: now };
    this.driverAssignments.set(entity.id, entity);
    return entity;
  }

  async updateDriverAssignment(
    id: string,
    tenantId: string,
    data: Partial<DriverAssignmentEntity>,
  ): Promise<DriverAssignmentEntity | null> {
    const existing = this.driverAssignments.get(id);
    if (!existing || existing.tenantId !== tenantId) return null;
    const updated: DriverAssignmentEntity = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.driverAssignments.set(id, updated);
    return updated;
  }

  async findDriverAssignmentById(
    id: string,
    tenantId: string,
  ): Promise<DriverAssignmentEntity | null> {
    const entity = this.driverAssignments.get(id);
    if (!entity || entity.tenantId !== tenantId) return null;
    return entity;
  }

  async listDriverAssignments(
    tenantId: string,
    filter: DriverAssignmentFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<DriverAssignmentEntity>> {
    let items = Array.from(this.driverAssignments.values()).filter((e) => e.tenantId === tenantId);

    if (filter.vehicleId) {
      items = items.filter((e) => e.vehicleId === filter.vehicleId);
    }
    if (filter.driverId) {
      items = items.filter((e) => e.driverId === filter.driverId);
    }
    if (filter.routeId) {
      items = items.filter((e) => e.routeId === filter.routeId);
    }
    if (filter.isActive !== undefined) {
      items = items.filter((e) => e.isActive === filter.isActive);
    }

    const totalItems = items.length;
    const totalPages = Math.ceil(totalItems / pagination.pageSize);
    const start = (pagination.page - 1) * pagination.pageSize;
    const data = items.slice(start, start + pagination.pageSize);

    return {
      data,
      meta: { page: pagination.page, pageSize: pagination.pageSize, totalItems, totalPages },
    };
  }

  async findActiveDriverAssignment(
    vehicleId: string,
    tenantId: string,
  ): Promise<DriverAssignmentEntity | null> {
    return (
      Array.from(this.driverAssignments.values()).find(
        (e) => e.tenantId === tenantId && e.vehicleId === vehicleId && e.isActive,
      ) ?? null
    );
  }

  // ─── Student Assignment Operations ───────────────────────────────────────

  async createStudentAssignment(
    data: Omit<StudentRouteAssignmentEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<StudentRouteAssignmentEntity> {
    const now = new Date();
    const entity: StudentRouteAssignmentEntity = { ...data, createdAt: now, updatedAt: now };
    this.studentAssignments.set(entity.id, entity);
    return entity;
  }

  async updateStudentAssignment(
    id: string,
    tenantId: string,
    data: Partial<StudentRouteAssignmentEntity>,
  ): Promise<StudentRouteAssignmentEntity | null> {
    const existing = this.studentAssignments.get(id);
    if (!existing || existing.tenantId !== tenantId) return null;
    const updated: StudentRouteAssignmentEntity = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.studentAssignments.set(id, updated);
    return updated;
  }

  async findStudentAssignmentById(
    id: string,
    tenantId: string,
  ): Promise<StudentRouteAssignmentEntity | null> {
    const entity = this.studentAssignments.get(id);
    if (!entity || entity.tenantId !== tenantId) return null;
    return entity;
  }

  async listStudentAssignments(
    tenantId: string,
    filter: StudentAssignmentFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<StudentRouteAssignmentEntity>> {
    let items = Array.from(this.studentAssignments.values()).filter((e) => e.tenantId === tenantId);

    if (filter.studentId) {
      items = items.filter((e) => e.studentId === filter.studentId);
    }
    if (filter.routeId) {
      items = items.filter((e) => e.routeId === filter.routeId);
    }
    if (filter.stopId) {
      items = items.filter((e) => e.stopId === filter.stopId);
    }
    if (filter.isActive !== undefined) {
      items = items.filter((e) => e.isActive === filter.isActive);
    }

    const totalItems = items.length;
    const totalPages = Math.ceil(totalItems / pagination.pageSize);
    const start = (pagination.page - 1) * pagination.pageSize;
    const data = items.slice(start, start + pagination.pageSize);

    return {
      data,
      meta: { page: pagination.page, pageSize: pagination.pageSize, totalItems, totalPages },
    };
  }

  async findActiveStudentAssignment(
    studentId: string,
    tenantId: string,
  ): Promise<StudentRouteAssignmentEntity | null> {
    return (
      Array.from(this.studentAssignments.values()).find(
        (e) => e.tenantId === tenantId && e.studentId === studentId && e.isActive,
      ) ?? null
    );
  }
}
