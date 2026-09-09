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
import { ConflictError, NotFoundError, BusinessRuleError } from '@proctira/common';
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import { evaluateTransportAlerts, osmDeepLink } from './alert-evaluator.js';
import { generateDeviceId, generateDeviceKey, hashDeviceKey } from './device-key.js';
import type { TransportFeesPort } from './fees-port.js';
import {
  BUS_ATTENDANCE_STUB_HONESTY_NOTE,
  GPS_STUB_HONESTY_NOTE,
  GpsAttendanceStubStore,
} from './gps-attendance-stub.js';
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
  RecordGpsPingInput,
  RecordBusAttendanceInput,
  IngestGpsBatchInput,
  RegisterVehicleDeviceInput,
  UpsertBusAttendanceInput,
  CreateAlertRuleInput,
  EvaluateAlertsInput,
  CreateTransportFeeStructureInput,
} from './schemas.js';
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
  TripDirection,
} from './transport-repository.js';

export const GPS_LIVE_HONESTY_NOTE =
  'Live map uses last ingested ping per vehicle projected onto an inline SVG (no MapLibre/Leaflet). Each marker links to OpenStreetMap. GPS ingest requires a tenant JWT plus X-Transport-Device-Key; anonymous device-only ingest is not enabled because FORCE RLS needs app.tenant_id.';

export const TRANSPORT_FEE_PENDING_NOTE =
  'FeesService was not injected; a pending transport_fee_links row was recorded instead of an invoice.';

/**
 * Service handling transport business logic.
 */
export class TransportService {
  private readonly gpsAttendance: GpsAttendanceStubStore;

  constructor(
    private readonly repository: TransportRepository,
    gpsAttendance?: GpsAttendanceStubStore,
    private readonly fees?: TransportFeesPort,
  ) {
    this.gpsAttendance = gpsAttendance ?? new GpsAttendanceStubStore();
  }

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
    if (input.status !== undefined)
      updateData.status = input.status as TransportRouteEntity['status'];
    if (input.startLocation !== undefined) updateData.startLocation = input.startLocation;
    if (input.endLocation !== undefined) updateData.endLocation = input.endLocation;
    if (input.distanceKm !== undefined) updateData.distanceKm = input.distanceKm;
    if (input.estimatedDurationMinutes !== undefined)
      updateData.estimatedDurationMinutes = input.estimatedDurationMinutes;
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
  async createStop(tenantId: string, input: CreateRouteStopInput): Promise<RouteStopEntity> {
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
  async createVehicle(tenantId: string, input: CreateVehicleInput): Promise<VehicleEntity> {
    // Check for duplicate registration number
    const existing = await this.repository.findVehicleByRegistration(
      input.registrationNumber,
      tenantId,
    );
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
      const duplicate = await this.repository.findVehicleByRegistration(
        input.registrationNumber,
        tenantId,
      );
      if (duplicate) {
        throw new ConflictError(
          `Vehicle with registration number '${input.registrationNumber}' already exists`,
        );
      }
    }

    const updateData: Partial<VehicleEntity> = {};
    if (input.registrationNumber !== undefined)
      updateData.registrationNumber = input.registrationNumber;
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
    const existingAssignment = await this.repository.findActiveDriverAssignment(
      input.vehicleId,
      tenantId,
    );
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
    actorId = 'transport',
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
    const existingAssignment = await this.repository.findActiveStudentAssignment(
      input.studentId,
      tenantId,
    );
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

    const created = await this.repository.createStudentAssignment(assignment);
    await this.linkTransportFee(tenantId, actorId, created);
    return created;
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

  // ─── GPS / attendance-on-bus stubs (G-602) ─────────────────────────────────

  /**
   * Accept a GPS ping for a vehicle (sandbox telematics).
   * @throws NotFoundError if vehicle missing in tenant
   */
  async recordGpsPing(tenantId: string, vehicleId: string, input: RecordGpsPingInput) {
    await this.getVehicleById(tenantId, vehicleId);
    const ping = this.gpsAttendance.recordGpsPing({
      tenantId,
      vehicleId,
      latitude: input.latitude,
      longitude: input.longitude,
      recordedAt: input.recordedAt ? new Date(input.recordedAt) : undefined,
      speedKph: input.speedKph,
      headingDeg: input.headingDeg,
    });
    return {
      ...ping,
      mode: 'sandbox' as const,
      honestyNote: GPS_STUB_HONESTY_NOTE,
    };
  }

  async listGpsPings(tenantId: string, vehicleId: string) {
    await this.getVehicleById(tenantId, vehicleId);
    return {
      data: this.gpsAttendance.listGpsPings(tenantId, vehicleId),
      mode: 'sandbox' as const,
      honestyNote: GPS_STUB_HONESTY_NOTE,
    };
  }

  /**
   * Record a student board/alight event on a bus (sandbox scanner).
   */
  async recordBusAttendance(tenantId: string, input: RecordBusAttendanceInput) {
    await this.getVehicleById(tenantId, input.vehicleId);
    if (input.routeId) {
      await this.getRouteById(tenantId, input.routeId);
    }
    const event = this.gpsAttendance.recordBusAttendance({
      tenantId,
      vehicleId: input.vehicleId,
      routeId: input.routeId,
      studentId: input.studentId,
      eventType: input.eventType,
      recordedAt: input.recordedAt ? new Date(input.recordedAt) : undefined,
    });
    return {
      ...event,
      mode: 'sandbox' as const,
      honestyNote: BUS_ATTENDANCE_STUB_HONESTY_NOTE,
    };
  }

  async listBusAttendance(
    tenantId: string,
    filter: { vehicleId?: string; studentId?: string; routeId?: string } = {},
  ) {
    return {
      data: this.gpsAttendance.listBusAttendance(tenantId, filter),
      mode: 'sandbox' as const,
      honestyNote: BUS_ATTENDANCE_STUB_HONESTY_NOTE,
    };
  }

  // ─── Wave 9 / G-920 ops ──────────────────────────────────────────────────

  async listAllStops(tenantId: string) {
    return this.repository.listAllStops(tenantId);
  }

  async registerVehicleDevice(
    tenantId: string,
    vehicleId: string,
    input: RegisterVehicleDeviceInput = {},
  ) {
    await this.getVehicleById(tenantId, vehicleId);
    const existing = await this.repository.findDeviceByVehicleId(vehicleId, tenantId);
    if (existing) {
      throw new ConflictError('Vehicle already has an active GPS device. Rotate by deactivating first.');
    }
    const plaintext = generateDeviceKey();
    const deviceId = input.deviceId?.trim() || generateDeviceId();
    const taken = await this.repository.findDeviceByDeviceId(deviceId, tenantId);
    if (taken) {
      throw new ConflictError(`Device id '${deviceId}' is already registered`);
    }
    const device = await this.repository.registerVehicleDevice({
      id: uuidv4(),
      tenantId,
      vehicleId,
      deviceId,
      deviceKeyHash: hashDeviceKey(plaintext),
      isActive: true,
    });
    return {
      id: device.id,
      vehicleId: device.vehicleId,
      deviceId: device.deviceId,
      deviceKey: plaintext,
      honestyNote:
        'Store the device key now — only the SHA-256 hash is persisted. Send it as X-Transport-Device-Key on POST /transport/gps.',
    };
  }

  async ingestGpsBatch(
    tenantId: string,
    deviceKey: string | undefined,
    input: IngestGpsBatchInput,
  ) {
    if (!deviceKey) {
      throw new BusinessRuleError('X-Transport-Device-Key header is required');
    }
    const device = await this.repository.findDeviceByDeviceId(input.deviceId, tenantId);
    if (!device || hashDeviceKey(deviceKey) !== device.deviceKeyHash) {
      throw new NotFoundError('Unknown device or invalid device key');
    }
    await this.getVehicleById(tenantId, device.vehicleId);
    const results = [];
    for (const ping of input.pings) {
      const recordedAt = ping.recordedAt ? new Date(ping.recordedAt) : new Date();
      const stored = await this.repository.ingestGpsPing({
        id: uuidv4(),
        tenantId,
        vehicleId: device.vehicleId,
        deviceId: device.deviceId,
        pingId: ping.pingId,
        latitude: ping.latitude,
        longitude: ping.longitude,
        recordedAt,
        speedKph: ping.speedKph ?? null,
        headingDeg: ping.headingDeg ?? null,
      });
      this.gpsAttendance.recordGpsPing({
        tenantId,
        vehicleId: device.vehicleId,
        latitude: ping.latitude,
        longitude: ping.longitude,
        recordedAt,
        speedKph: ping.speedKph,
        headingDeg: ping.headingDeg,
      });
      results.push({
        ...stored.ping,
        duplicate: stored.duplicate,
        osmUrl: osmDeepLink(stored.ping.latitude, stored.ping.longitude),
      });
    }
    return { data: results, vehicleId: device.vehicleId, deviceId: device.deviceId };
  }

  async getLiveMap(tenantId: string) {
    const [vehicles, pings, stops] = await Promise.all([
      this.repository.listVehicles(tenantId, {}, { page: 1, pageSize: 100 }),
      this.repository.listLatestGpsPingPerVehicle(tenantId),
      this.repository.listAllStops(tenantId),
    ]);
    const vehicleById = new Map(vehicles.data.map((v) => [v.id, v]));
    return {
      honestyNote: GPS_LIVE_HONESTY_NOTE,
      vehicles: pings.map((p) => ({
        vehicleId: p.vehicleId,
        registrationNumber: vehicleById.get(p.vehicleId)?.registrationNumber ?? null,
        latitude: p.latitude,
        longitude: p.longitude,
        recordedAt: p.recordedAt,
        speedKph: p.speedKph,
        headingDeg: p.headingDeg,
        osmUrl: osmDeepLink(p.latitude, p.longitude),
      })),
      stops: stops
        .filter((s) => s.latitude != null && s.longitude != null)
        .map((s) => ({
          id: s.id,
          routeId: s.routeId,
          name: s.name,
          latitude: s.latitude,
          longitude: s.longitude,
          stopOrder: s.stopOrder,
          pickupTime: s.pickupTime,
          dropoffTime: s.dropoffTime,
          osmUrl: osmDeepLink(s.latitude as number, s.longitude as number),
        })),
    };
  }

  async upsertTripAttendance(
    tenantId: string,
    input: UpsertBusAttendanceInput,
    actorId = 'transport',
  ) {
    await this.getRouteById(tenantId, input.routeId);
    if (input.stopId) {
      const stop = await this.repository.findStopById(input.stopId, tenantId);
      if (!stop) {
        throw new NotFoundError(`Route stop with id '${input.stopId}' not found`);
      }
      if (stop.routeId !== input.routeId) {
        throw new BusinessRuleError('The specified stop does not belong to the specified route');
      }
    }
    return this.repository.upsertBusAttendance({
      id: uuidv4(),
      tenantId,
      routeId: input.routeId,
      tripDate: input.tripDate,
      direction: input.direction,
      studentId: input.studentId,
      stopId: input.stopId ?? null,
      status: input.status,
      recordedAt: new Date(),
      recordedBy: actorId,
    });
  }

  async getTripAttendance(
    tenantId: string,
    filter: { routeId: string; tripDate: string; direction: TripDirection },
  ) {
    await this.getRouteById(tenantId, filter.routeId);
    const [rows, assignments] = await Promise.all([
      this.repository.listBusAttendanceTrip(tenantId, filter),
      this.repository.listStudentAssignments(
        tenantId,
        { routeId: filter.routeId, isActive: true },
        { page: 1, pageSize: 200 },
      ),
    ]);
    const boarded = rows.filter((r) => r.status === 'boarded').length;
    const alighted = rows.filter((r) => r.status === 'alighted').length;
    const absent = rows.filter((r) => r.status === 'absent').length;
    return {
      data: rows,
      assigned: assignments.meta.totalItems,
      summary: {
        boarded,
        alighted,
        absent,
        unmarked: Math.max(0, assignments.meta.totalItems - rows.length),
      },
    };
  }

  async createAlertRule(tenantId: string, input: CreateAlertRuleInput) {
    if (input.routeId) {
      await this.getRouteById(tenantId, input.routeId);
    }
    return this.repository.createAlertRule({
      id: uuidv4(),
      tenantId,
      kind: input.kind,
      threshold: input.threshold,
      channels: input.channels ?? [],
      routeId: input.routeId ?? null,
      isActive: true,
    });
  }

  async listAlertRules(tenantId: string) {
    return this.repository.listAlertRules(tenantId);
  }

  async evaluateAlerts(
    tenantId: string,
    input: EvaluateAlertsInput = {},
    now = new Date(),
  ) {
    const tripDate = input.tripDate ?? now.toISOString().slice(0, 10);
    const [rules, pings, stops, routes, assignments] = await Promise.all([
      this.repository.listAlertRules(tenantId),
      this.repository.listLatestGpsPingPerVehicle(tenantId),
      this.repository.listAllStops(tenantId),
      this.repository.listRoutes(tenantId, {}, { page: 1, pageSize: 100 }),
      this.repository.listStudentAssignments(
        tenantId,
        { routeId: input.routeId, isActive: true },
        { page: 1, pageSize: 500 },
      ),
    ]);
    const driverAssignments = await this.repository.listDriverAssignments(
      tenantId,
      { isActive: true },
      { page: 1, pageSize: 200 },
    );
    const routeByVehicle = new Map(
      driverAssignments.data
        .filter((d) => d.routeId)
        .map((d) => [d.vehicleId, d.routeId as string]),
    );
    const attendance = input.routeId
      ? await this.repository.listBusAttendanceTrip(tenantId, {
          routeId: input.routeId,
          tripDate,
          direction: 'pickup',
        })
      : [];
    const drafts = evaluateTransportAlerts({
      now,
      tripDate,
      pings: pings.map((p) => ({
        vehicleId: p.vehicleId,
        routeId: routeByVehicle.get(p.vehicleId) ?? null,
        latitude: p.latitude,
        longitude: p.longitude,
        recordedAt: p.recordedAt,
      })),
      stops: stops.map((s) => ({
        id: s.id,
        routeId: s.routeId,
        latitude: s.latitude,
        longitude: s.longitude,
        pickupTime: s.pickupTime,
      })),
      rules: rules.map((r) => ({
        id: r.id,
        kind: r.kind,
        threshold: Number(r.threshold),
        routeId: r.routeId,
        isActive: r.isActive,
      })),
      attendance: attendance.map((a) => ({
        studentId: a.studentId,
        routeId: a.routeId,
        status: a.status,
        stopId: a.stopId,
      })),
      assignments: assignments.data.map((a) => ({
        studentId: a.studentId,
        routeId: a.routeId,
        stopId: a.stopId,
      })),
      routeDeparture: Object.fromEntries(routes.data.map((r) => [r.id, r.departureTime])),
    });
    const created = [];
    for (const draft of drafts) {
      const alert = await this.repository.createAlert({
        id: uuidv4(),
        tenantId,
        ruleId: draft.ruleId,
        kind: draft.kind,
        vehicleId: draft.vehicleId,
        routeId: draft.routeId,
        studentId: draft.studentId,
        message: draft.message,
        payload: draft.payload,
        acknowledgedAt: null,
        acknowledgedBy: null,
      });
      created.push(alert);
    }
    return { data: created, evaluated: drafts.length };
  }

  async listAlerts(tenantId: string) {
    return this.repository.listAlerts(tenantId);
  }

  async acknowledgeAlert(tenantId: string, id: string, actorId: string) {
    const updated = await this.repository.acknowledgeAlert(id, tenantId, actorId);
    if (!updated) {
      throw new NotFoundError(`Alert with id '${id}' not found`);
    }
    return updated;
  }

  async createTransportFeeStructure(
    tenantId: string,
    input: CreateTransportFeeStructureInput,
    actorId = 'transport',
  ) {
    if (input.routeId) await this.getRouteById(tenantId, input.routeId);
    if (input.stopId) {
      const stop = await this.repository.findStopById(input.stopId, tenantId);
      if (!stop) throw new NotFoundError(`Route stop with id '${input.stopId}' not found`);
    }
    let feesStructureId: string | null = null;
    if (this.fees) {
      const fees = await this.fees.createFeeStructure(tenantId, actorId, {
        name: input.name,
        category: 'transport',
        amountCents: input.amountCents,
        currency: input.currency,
      });
      feesStructureId = fees.id;
    }
    return this.repository.createTransportFeeStructure({
      id: uuidv4(),
      tenantId,
      name: input.name,
      routeId: input.routeId ?? null,
      stopId: input.stopId ?? null,
      minDistanceKm: input.minDistanceKm ?? null,
      maxDistanceKm: input.maxDistanceKm ?? null,
      amountCents: input.amountCents,
      currency: input.currency ?? 'INR',
      feesStructureId,
      isActive: true,
    });
  }

  async listTransportFeeStructures(tenantId: string) {
    return this.repository.listTransportFeeStructures(tenantId);
  }

  async listFeeLinks(tenantId: string) {
    return this.repository.listFeeLinks(tenantId);
  }

  private matchFeeBand(
    bands: Awaited<ReturnType<TransportRepository['listTransportFeeStructures']>>,
    assignment: StudentRouteAssignmentEntity,
    routeDistanceKm: number | null,
  ) {
    const active = bands.filter((b) => b.isActive);
    const byStop = assignment.stopId
      ? active.find((b) => b.stopId === assignment.stopId)
      : undefined;
    if (byStop) return byStop;
    const byRoute = active.find((b) => b.routeId === assignment.routeId && !b.stopId);
    if (byRoute) {
      if (routeDistanceKm != null && (byRoute.minDistanceKm != null || byRoute.maxDistanceKm != null)) {
        const min = byRoute.minDistanceKm ?? 0;
        const max = byRoute.maxDistanceKm ?? Number.POSITIVE_INFINITY;
        if (routeDistanceKm >= min && routeDistanceKm <= max) return byRoute;
      } else {
        return byRoute;
      }
    }
    return active.find((b) => !b.routeId && !b.stopId) ?? null;
  }

  private async linkTransportFee(
    tenantId: string,
    actorId: string,
    assignment: StudentRouteAssignmentEntity,
  ) {
    const existing = await this.repository.findFeeLinkByAssignment(assignment.id, tenantId);
    if (existing) return existing;
    const [bands, route] = await Promise.all([
      this.repository.listTransportFeeStructures(tenantId),
      this.repository.findRouteById(assignment.routeId, tenantId),
    ]);
    const band = this.matchFeeBand(bands, assignment, route?.distanceKm ?? null);
    if (!band) {
      return this.repository.createFeeLink({
        id: uuidv4(),
        tenantId,
        assignmentId: assignment.id,
        studentId: assignment.studentId,
        transportFeeStructureId: null,
        feesInvoiceId: null,
        feesStructureId: null,
        status: 'skipped',
        reason: 'No matching transport fee band for this route/stop',
      });
    }
    if (!this.fees) {
      return this.repository.createFeeLink({
        id: uuidv4(),
        tenantId,
        assignmentId: assignment.id,
        studentId: assignment.studentId,
        transportFeeStructureId: band.id,
        feesInvoiceId: null,
        feesStructureId: band.feesStructureId,
        status: 'pending',
        reason: TRANSPORT_FEE_PENDING_NOTE,
      });
    }
    let invoiceId: string | null = null;
    try {
      if (band.feesStructureId && this.fees.bulkInvoiceClass) {
        const bulk = await this.fees.bulkInvoiceClass(tenantId, actorId, {
          structureId: band.feesStructureId,
          studentIds: [assignment.studentId],
        });
        invoiceId = bulk.created[0]?.id ?? null;
      }
      if (!invoiceId) {
        const invoice = await this.fees.createInvoice(tenantId, actorId, {
          studentId: assignment.studentId,
          title: `Transport — ${band.name}`,
          description: 'Stop/route transport fee',
          amountCents: band.amountCents,
          currency: band.currency,
        });
        invoiceId = invoice.id;
      }
      return this.repository.createFeeLink({
        id: uuidv4(),
        tenantId,
        assignmentId: assignment.id,
        studentId: assignment.studentId,
        transportFeeStructureId: band.id,
        feesInvoiceId: invoiceId,
        feesStructureId: band.feesStructureId,
        status: 'invoiced',
        reason: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Fees service rejected the invoice';
      return this.repository.createFeeLink({
        id: uuidv4(),
        tenantId,
        assignmentId: assignment.id,
        studentId: assignment.studentId,
        transportFeeStructureId: band.id,
        feesInvoiceId: null,
        feesStructureId: band.feesStructureId,
        status: 'pending',
        reason: message,
      });
    }
  }
}
