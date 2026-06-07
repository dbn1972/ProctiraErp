/**
 * Transport Service
 *
 * Business logic for school transport management including routes, stops,
 * vehicles, driver assignments, and student route assignments.
 *
 * Requirements: 1.2 (Transport_Module)
 * - Track school transport routes with stops and schedules
 * - Manage vehicle records and driver assignments
 * - Assign students to transport routes
 */
import {
  ConflictError,
  NotFoundError,
  BusinessRuleError,
  ValidationError,
} from '@proctira/common';
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

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
import type {
  CreateTransportRouteInput,
  UpdateTransportRouteInput,
  CreateRouteStopInput,
  UpdateRouteStopInput,
  CreateVehicleInput,
  UpdateVehicleInput,
  CreateDriverAssignmentInput,
  UpdateDriverAssignmentInput,
  CreateStudentAssignmentInput,
  UpdateStudentAssignmentInput,
} from './schemas.js';

/**
 * Service handling transport business logic.
 */
export class TransportService {
  constructor(private readonly repository: TransportRepository) {}

  // ─── Route Operations ────────────────────────────────────────────────────

  /**
   * Create a new transport route.
   */
  async createRoute(
    tenantId: string,
    input: CreateTransportRouteInput,
  ): Promise<TransportRouteEntity> {
    const route: Omit<TransportRouteEntity, 'createdAt' | 'updatedAt'> = {
      id: uuidv4(),
      tenantId,
      name: input.name,
      description: input.description ?? null,
      status: 'active',
      startLocation: input.startLocation,
      endLocation: input.endLocation,
      distanceKm: input.distanceKm ?? null,
      estimatedDurationMinutes: input.estimatedDurationMinutes ?? null,
      operatingDays: input.operatingDays,
      departureTime: input.departureTime ?? null,
      returnTime: input.returnTime ?? null,
      institutionId: input.institutionId ?? null,
    };

    return this.repository.createRoute(route);
  }

  /**
   * Update an existing transport route.
   *
   * @throws NotFoundError if route not found
   */
  async updateRoute(
    tenantId: string,
    id: string,
    input: UpdateTransportRouteInput,
  ): Promise<TransportRouteEntity> {
    const existing = await this.repository.findRouteById(id, tenantId);
    if (!existing) {
      throw new NotFoundError(`Transport route with id '${id}' not found`);
    }

    const updateData: Partial<TransportRouteEntity> = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.status !== undefined) updateData.status = input.status as TransportRouteEntity['status'];
    if (input.startLocation !== undefined) updateData.startLocation = input.startLocation;
    if (input.endLocation !== undefined) updateData.endLocation = input.endLocation;
    if (input.distanceKm !== undefined) updateData.distanceKm = input.distanceKm;
    if (input.estimatedDurationMinutes !== undefined) updateData.estimatedDurationMinutes = input.estimatedDurationMinutes;
    if (input.operatingDays !== undefined) updateData.operatingDays = input.operatingDays;
    if (input.departureTime !== undefined) updateData.departureTime = input.departureTime;
    if (input.returnTime !== undefined) updateData.returnTime = input.returnTime;
    if (input.institutionId !== undefined) updateData.institutionId = input.institutionId;

    const updated = await this.repository.updateRoute(id, tenantId, updateData);
    if (!updated) {
      throw new NotFoundError(`Transport route with id '${id}' not found`);
    }

    return updated;
  }

  /**
   * Get a transport route by ID.
   *
   * @throws NotFoundError if route not found
   */
  async getRouteById(tenantId: string, id: string): Promise<TransportRouteEntity> {
    const route = await this.repository.findRouteById(id, tenantId);
    if (!route) {
      throw new NotFoundError(`Transport route with id '${id}' not found`);
    }
    return route;
  }

  /**
   * List transport routes with pagination and filtering.
   */
  async listRoutes(
    tenantId: string,
    filter: RouteFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<TransportRouteEntity>> {
    return this.repository.listRoutes(tenantId, filter, pagination);
  }

  /**
   * Delete a transport route.
   *
   * @throws NotFoundError if route not found
   * @throws BusinessRuleError if route has active student assignments
   */
  async deleteRoute(tenantId: string, id: string): Promise<void> {
    const existing = await this.repository.findRouteById(id, tenantId);
    if (!existing) {
      throw new NotFoundError(`Transport route with id '${id}' not found`);
    }

    // Check for active student assignments
    const assignments = await this.repository.listStudentAssignments(
      tenantId,
      { routeId: id, isActive: true },
      { page: 1, pageSize: 1 },
    );
    if (assignments.meta.totalItems > 0) {
      throw new BusinessRuleError(
        'Cannot delete a transport route with active student assignments. Deactivate assignments first.',
      );
    }

    await this.repository.deleteRoute(id, tenantId);
  }

  // ─── Route Stop Operations ───────────────────────────────────────────────

  /**
   * Create a stop on a transport route.
   *
   * @throws NotFoundError if route not found
   */
  async createStop(
    tenantId: string,
    input: CreateRouteStopInput,
  ): Promise<RouteStopEntity> {
    // Validate route exists
    const route = await this.repository.findRouteById(input.routeId, tenantId);
    if (!route) {
      throw new NotFoundError(`Transport route with id '${input.routeId}' not found`);
    }

    const stop: Omit<RouteStopEntity, 'createdAt' | 'updatedAt'> = {
      id: uuidv4(),
      tenantId,
      routeId: input.routeId,
      name: input.name,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      stopOrder: input.stopOrder,
      pickupTime: input.pickupTime ?? null,
      dropoffTime: input.dropoffTime ?? null,
    };

    return this.repository.createStop(stop);
  }

  /**
   * Update a route stop.
   *
   * @throws NotFoundError if stop not found
   */
  async updateStop(
    tenantId: string,
    id: string,
    input: UpdateRouteStopInput,
  ): Promise<RouteStopEntity> {
    const existing = await this.repository.findStopById(id, tenantId);
    if (!existing) {
      throw new NotFoundError(`Route stop with id '${id}' not found`);
    }

    const updateData: Partial<RouteStopEntity> = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.latitude !== undefined) updateData.latitude = input.latitude;
    if (input.longitude !== undefined) updateData.longitude = input.longitude;
    if (input.stopOrder !== undefined) updateData.stopOrder = input.stopOrder;
    if (input.pickupTime !== undefined) updateData.pickupTime = input.pickupTime;
    if (input.dropoffTime !== undefined) updateData.dropoffTime = input.dropoffTime;

    const updated = await this.repository.updateStop(id, tenantId, updateData);
    if (!updated) {
      throw new NotFoundError(`Route stop with id '${id}' not found`);
    }

    return updated;
  }

  /**
   * List stops for a transport route, ordered by stopOrder.
   *
   * @throws NotFoundError if route not found
   */
  async listStopsByRoute(tenantId: string, routeId: string): Promise<RouteStopEntity[]> {
    const route = await this.repository.findRouteById(routeId, tenantId);
    if (!route) {
      throw new NotFoundError(`Transport route with id '${routeId}' not found`);
    }

    const stops = await this.repository.listStopsByRoute(routeId, tenantId);
    return stops.sort((a, b) => a.stopOrder - b.stopOrder);
  }

  /**
   * Delete a route stop.
   *
   * @throws NotFoundError if stop not found
   */
  async deleteStop(tenantId: string, id: string): Promise<void> {
    const existing = await this.repository.findStopById(id, tenantId);
    if (!existing) {
      throw new NotFoundError(`Route stop with id '${id}' not found`);
    }

    await this.repository.deleteStop(id, tenantId);
  }

  // ─── Vehicle Operations ──────────────────────────────────────────────────

  /**
   * Create a new vehicle record.
   *
   * @throws ConflictError if registration number already exists
   */
  async createVehicle(
    tenantId: string,
    input: CreateVehicleInput,
  ): Promise<VehicleEntity> {
    // Check for duplicate registration number
    const existing = await this.repository.findVehicleByRegistration(input.registrationNumber, tenantId);
    if (existing) {
      throw new ConflictError(
        `Vehicle with registration number '${input.registrationNumber}' already exists`,
      );
    }

    const vehicle: Omit<VehicleEntity, 'createdAt' | 'updatedAt'> = {
      id: uuidv4(),
      tenantId,
      registrationNumber: input.registrationNumber,
      make: input.make ?? null,
      model: input.model ?? null,
      year: input.year ?? null,
      capacity: input.capacity,
      status: 'active',
      insuranceExpiry: input.insuranceExpiry ?? null,
      lastServiceDate: input.lastServiceDate ?? null,
    };

    return this.repository.createVehicle(vehicle);
  }

  /**
   * Update a vehicle record.
   *
   * @throws NotFoundError if vehicle not found
   * @throws ConflictError if new registration number already exists
   */
  async updateVehicle(
    tenantId: string,
    id: string,
    input: UpdateVehicleInput,
  ): Promise<VehicleEntity> {
    const existing = await this.repository.findVehicleById(id, tenantId);
    if (!existing) {
      throw new NotFoundError(`Vehicle with id '${id}' not found`);
    }

    // Check for duplicate registration number if being changed
    if (input.registrationNumber && input.registrationNumber !== existing.registrationNumber) {
      const duplicate = await this.repository.findVehicleByRegistration(input.registrationNumber, tenantId);
      if (duplicate) {
        throw new ConflictError(
          `Vehicle with registration number '${input.registrationNumber}' already exists`,
        );
      }
    }

    const updateData: Partial<VehicleEntity> = {};
    if (input.registrationNumber !== undefined) updateData.registrationNumber = input.registrationNumber;
    if (input.make !== undefined) updateData.make = input.make;
    if (input.model !== undefined) updateData.model = input.model;
    if (input.year !== undefined) updateData.year = input.year;
    if (input.capacity !== undefined) updateData.capacity = input.capacity;
    if (input.status !== undefined) updateData.status = input.status as VehicleEntity['status'];
    if (input.insuranceExpiry !== undefined) updateData.insuranceExpiry = input.insuranceExpiry;
    if (input.lastServiceDate !== undefined) updateData.lastServiceDate = input.lastServiceDate;

    const updated = await this.repository.updateVehicle(id, tenantId, updateData);
    if (!updated) {
      throw new NotFoundError(`Vehicle with id '${id}' not found`);
    }

    return updated;
  }

  /**
   * Get a vehicle by ID.
   *
   * @throws NotFoundError if vehicle not found
   */
  async getVehicleById(tenantId: string, id: string): Promise<VehicleEntity> {
    const vehicle = await this.repository.findVehicleById(id, tenantId);
    if (!vehicle) {
      throw new NotFoundError(`Vehicle with id '${id}' not found`);
    }
    return vehicle;
  }

  /**
   * List vehicles with pagination and filtering.
   */
  async listVehicles(
    tenantId: string,
    filter: VehicleFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<VehicleEntity>> {
    return this.repository.listVehicles(tenantId, filter, pagination);
  }

  /**
   * Delete a vehicle record.
   *
   * @throws NotFoundError if vehicle not found
   * @throws BusinessRuleError if vehicle has active driver assignment
   */
  async deleteVehicle(tenantId: string, id: string): Promise<void> {
    const existing = await this.repository.findVehicleById(id, tenantId);
    if (!existing) {
      throw new NotFoundError(`Vehicle with id '${id}' not found`);
    }

    const activeAssignment = await this.repository.findActiveDriverAssignment(id, tenantId);
    if (activeAssignment) {
      throw new BusinessRuleError(
        'Cannot delete a vehicle with an active driver assignment. End the assignment first.',
      );
    }

    await this.repository.deleteVehicle(id, tenantId);
  }

  // ─── Driver Assignment Operations ────────────────────────────────────────

  /**
   * Create a driver assignment (assign a driver to a vehicle and optionally a route).
   *
   * @throws NotFoundError if vehicle not found
   * @throws NotFoundError if route not found (when routeId provided)
   * @throws BusinessRuleError if vehicle already has an active driver assignment
   */
  async createDriverAssignment(
    tenantId: string,
    input: CreateDriverAssignmentInput,
  ): Promise<DriverAssignmentEntity> {
    // Validate vehicle exists
    const vehicle = await this.repository.findVehicleById(input.vehicleId, tenantId);
    if (!vehicle) {
      throw new NotFoundError(`Vehicle with id '${input.vehicleId}' not found`);
    }

    if (vehicle.status !== 'active') {
      throw new BusinessRuleError('Cannot assign a driver to a vehicle that is not active');
    }

    // Validate route exists if provided
    if (input.routeId) {
      const route = await this.repository.findRouteById(input.routeId, tenantId);
      if (!route) {
        throw new NotFoundError(`Transport route with id '${input.routeId}' not found`);
      }
    }

    // Check for existing active assignment on this vehicle
    const existingAssignment = await this.repository.findActiveDriverAssignment(input.vehicleId, tenantId);
    if (existingAssignment) {
      throw new BusinessRuleError(
        'Vehicle already has an active driver assignment. End the current assignment first.',
      );
    }

    const assignment: Omit<DriverAssignmentEntity, 'createdAt' | 'updatedAt'> = {
      id: uuidv4(),
      tenantId,
      vehicleId: input.vehicleId,
      driverId: input.driverId,
      routeId: input.routeId ?? null,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      isActive: true,
    };

    return this.repository.createDriverAssignment(assignment);
  }

  /**
   * Update a driver assignment.
   *
   * @throws NotFoundError if assignment not found
   */
  async updateDriverAssignment(
    tenantId: string,
    id: string,
    input: UpdateDriverAssignmentInput,
  ): Promise<DriverAssignmentEntity> {
    const existing = await this.repository.findDriverAssignmentById(id, tenantId);
    if (!existing) {
      throw new NotFoundError(`Driver assignment with id '${id}' not found`);
    }

    // Validate route if being changed
    if (input.routeId) {
      const route = await this.repository.findRouteById(input.routeId, tenantId);
      if (!route) {
        throw new NotFoundError(`Transport route with id '${input.routeId}' not found`);
      }
    }

    const updateData: Partial<DriverAssignmentEntity> = {};
    if (input.routeId !== undefined) updateData.routeId = input.routeId;
    if (input.endDate !== undefined) updateData.endDate = input.endDate;
    if (input.isActive !== undefined) updateData.isActive = input.isActive;

    const updated = await this.repository.updateDriverAssignment(id, tenantId, updateData);
    if (!updated) {
      throw new NotFoundError(`Driver assignment with id '${id}' not found`);
    }

    return updated;
  }

  /**
   * List driver assignments with pagination and filtering.
   */
  async listDriverAssignments(
    tenantId: string,
    filter: DriverAssignmentFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<DriverAssignmentEntity>> {
    return this.repository.listDriverAssignments(tenantId, filter, pagination);
  }

  // ─── Student Route Assignment Operations ─────────────────────────────────

  /**
   * Assign a student to a transport route.
   *
   * @throws NotFoundError if route not found
   * @throws NotFoundError if stop not found (when stopId provided)
   * @throws BusinessRuleError if route is not active
   * @throws BusinessRuleError if student already has an active route assignment
   */
  async createStudentAssignment(
    tenantId: string,
    input: CreateStudentAssignmentInput,
  ): Promise<StudentRouteAssignmentEntity> {
    // Validate route exists and is active
    const route = await this.repository.findRouteById(input.routeId, tenantId);
    if (!route) {
      throw new NotFoundError(`Transport route with id '${input.routeId}' not found`);
    }

    if (route.status !== 'active') {
      throw new BusinessRuleError('Cannot assign a student to an inactive transport route');
    }

    // Validate stop exists and belongs to route if provided
    if (input.stopId) {
      const stop = await this.repository.findStopById(input.stopId, tenantId);
      if (!stop) {
        throw new NotFoundError(`Route stop with id '${input.stopId}' not found`);
      }
      if (stop.routeId !== input.routeId) {
        throw new BusinessRuleError('The specified stop does not belong to the specified route');
      }
    }

    // Check for existing active assignment for this student
    const existingAssignment = await this.repository.findActiveStudentAssignment(input.studentId, tenantId);
    if (existingAssignment) {
      throw new BusinessRuleError(
        'Student already has an active transport route assignment. End the current assignment first.',
      );
    }

    const assignment: Omit<StudentRouteAssignmentEntity, 'createdAt' | 'updatedAt'> = {
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      routeId: input.routeId,
      stopId: input.stopId ?? null,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      isActive: true,
    };

    return this.repository.createStudentAssignment(assignment);
  }

  /**
   * Update a student route assignment.
   *
   * @throws NotFoundError if assignment not found
   */
  async updateStudentAssignment(
    tenantId: string,
    id: string,
    input: UpdateStudentAssignmentInput,
  ): Promise<StudentRouteAssignmentEntity> {
    const existing = await this.repository.findStudentAssignmentById(id, tenantId);
    if (!existing) {
      throw new NotFoundError(`Student route assignment with id '${id}' not found`);
    }

    // Validate stop if being changed
    if (input.stopId) {
      const stop = await this.repository.findStopById(input.stopId, tenantId);
      if (!stop) {
        throw new NotFoundError(`Route stop with id '${input.stopId}' not found`);
      }
      if (stop.routeId !== existing.routeId) {
        throw new BusinessRuleError('The specified stop does not belong to the assigned route');
      }
    }

    const updateData: Partial<StudentRouteAssignmentEntity> = {};
    if (input.stopId !== undefined) updateData.stopId = input.stopId;
    if (input.endDate !== undefined) updateData.endDate = input.endDate;
    if (input.isActive !== undefined) updateData.isActive = input.isActive;

    const updated = await this.repository.updateStudentAssignment(id, tenantId, updateData);
    if (!updated) {
      throw new NotFoundError(`Student route assignment with id '${id}' not found`);
    }

    return updated;
  }

  /**
   * List student route assignments with pagination and filtering.
   */
  async listStudentAssignments(
    tenantId: string,
    filter: StudentAssignmentFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<StudentRouteAssignmentEntity>> {
    return this.repository.listStudentAssignments(tenantId, filter, pagination);
  }
}
