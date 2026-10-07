/**
 * Postgres-backed transport repository (raw `pg` — no Prisma).
 *
 * When DATABASE_URL is set, transport CRUD persists via db/sql/006_transport_schema.sql.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { ConflictError } from '@proctira/common';
import {
  createDatabaseSchemaReadinessCheck,
  getSharedPgPool,
  withPgTenant,
} from '@proctira/database';
import type pg from 'pg';

import type {
  AlertRuleEntity,
  AlertKind,
  BusAttendanceEntity,
  BusAttendanceStatus,
  DriverAssignmentEntity,
  DriverAssignmentFilter,
  GpsPingEntity,
  RouteFilter,
  RouteStopEntity,
  RouteStatus,
  StudentAssignmentFilter,
  StudentRouteAssignmentEntity,
  TransportAlertEntity,
  TransportFeeLinkEntity,
  TransportFeeLinkStatus,
  TransportFeeStructureEntity,
  TransportRepository,
  TransportRouteEntity,
  TripDirection,
  VehicleDeviceEntity,
  VehicleEntity,
  VehicleFilter,
  VehicleStatus,
} from './transport-repository.js';
import { FEE_LINK_LEASE_PREFIX } from './transport-repository.js';

export type PgPoolLike = Pick<pg.Pool, 'query' | 'end'> & Partial<Pick<pg.Pool, 'connect'>>;

const ensureTransportSchemaReady = createDatabaseSchemaReadinessCheck('transport', 'transport');

export function getSharedTransportPool(): pg.Pool | null {
  return getSharedPgPool();
}

export async function ensureTransportSchema(
  pool: PgPoolLike = getSharedTransportPool()!,
): Promise<void> {
  if (!pool) throw new Error('DATABASE_URL is required for transport schema ensure');
  await ensureTransportSchemaReady(pool);
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function dateOnly(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function numOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return [];
}

function mapRouteRow(row: Record<string, unknown>): TransportRouteEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    name: String(row.name),
    description: row.description == null ? null : String(row.description),
    status: String(row.status) as RouteStatus,
    startLocation: String(row.start_location),
    endLocation: String(row.end_location),
    distanceKm: numOrNull(row.distance_km),
    estimatedDurationMinutes: numOrNull(row.estimated_duration_minutes),
    operatingDays: stringArray(row.operating_days),
    departureTime: row.departure_time == null ? null : String(row.departure_time),
    returnTime: row.return_time == null ? null : String(row.return_time),
    institutionId: row.institution_id == null ? null : String(row.institution_id),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapStopRow(row: Record<string, unknown>): RouteStopEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    routeId: String(row.route_id),
    name: String(row.name),
    latitude: numOrNull(row.latitude),
    longitude: numOrNull(row.longitude),
    stopOrder: Number(row.stop_order),
    pickupTime: row.pickup_time == null ? null : String(row.pickup_time),
    dropoffTime: row.dropoff_time == null ? null : String(row.dropoff_time),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapVehicleRow(row: Record<string, unknown>): VehicleEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    registrationNumber: String(row.registration_number),
    make: row.make == null ? null : String(row.make),
    model: row.model == null ? null : String(row.model),
    year: row.year == null ? null : Number(row.year),
    capacity: Number(row.capacity),
    status: String(row.status) as VehicleStatus,
    insuranceExpiry: row.insurance_expiry == null ? null : String(row.insurance_expiry),
    lastServiceDate: row.last_service_date == null ? null : String(row.last_service_date),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapDriverAssignmentRow(row: Record<string, unknown>): DriverAssignmentEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    vehicleId: String(row.vehicle_id),
    driverId: String(row.driver_id),
    routeId: row.route_id == null ? null : String(row.route_id),
    startDate: dateOnly(row.start_date)!,
    endDate: dateOnly(row.end_date),
    isActive: Boolean(row.is_active),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapStudentAssignmentRow(row: Record<string, unknown>): StudentRouteAssignmentEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    studentId: String(row.student_id),
    routeId: String(row.route_id),
    stopId: row.stop_id == null ? null : String(row.stop_id),
    startDate: dateOnly(row.start_date)!,
    endDate: dateOnly(row.end_date),
    isActive: Boolean(row.is_active),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapDeviceRow(row: Record<string, unknown>): VehicleDeviceEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    vehicleId: String(row.vehicle_id),
    deviceId: String(row.device_id),
    deviceKeyHash: String(row.device_key_hash),
    isActive: Boolean(row.is_active),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapGpsPingRow(row: Record<string, unknown>): GpsPingEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    vehicleId: String(row.vehicle_id),
    deviceId: String(row.device_id),
    pingId: String(row.ping_id),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    recordedAt: toDate(row.recorded_at),
    speedKph: numOrNull(row.speed_kph),
    headingDeg: numOrNull(row.heading_deg),
    createdAt: toDate(row.created_at),
  };
}

function mapAttendanceRow(row: Record<string, unknown>): BusAttendanceEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    routeId: String(row.route_id),
    tripDate: dateOnly(row.trip_date)!,
    direction: String(row.direction) as TripDirection,
    studentId: String(row.student_id),
    stopId: row.stop_id == null ? null : String(row.stop_id),
    status: String(row.status) as BusAttendanceStatus,
    recordedAt: toDate(row.recorded_at),
    recordedBy: row.recorded_by == null ? null : String(row.recorded_by),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapAlertRuleRow(row: Record<string, unknown>): AlertRuleEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    kind: String(row.kind) as AlertKind,
    threshold: Number(row.threshold),
    channels: stringArray(row.channels),
    routeId: row.route_id == null ? null : String(row.route_id),
    isActive: Boolean(row.is_active),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function mapAlertRow(row: Record<string, unknown>): TransportAlertEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    ruleId: String(row.rule_id),
    kind: String(row.kind) as AlertKind,
    vehicleId: row.vehicle_id == null ? null : String(row.vehicle_id),
    routeId: row.route_id == null ? null : String(row.route_id),
    studentId: row.student_id == null ? null : String(row.student_id),
    message: String(row.message),
    payload: jsonObject(row.payload),
    acknowledgedAt: row.acknowledged_at == null ? null : toDate(row.acknowledged_at),
    acknowledgedBy: row.acknowledged_by == null ? null : String(row.acknowledged_by),
    createdAt: toDate(row.created_at),
  };
}

function mapFeeStructureRow(row: Record<string, unknown>): TransportFeeStructureEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    name: String(row.name),
    routeId: row.route_id == null ? null : String(row.route_id),
    stopId: row.stop_id == null ? null : String(row.stop_id),
    minDistanceKm: numOrNull(row.min_distance_km),
    maxDistanceKm: numOrNull(row.max_distance_km),
    amountCents: Number(row.amount_cents),
    currency: String(row.currency),
    feesStructureId: row.fees_structure_id == null ? null : String(row.fees_structure_id),
    isActive: Boolean(row.is_active),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapFeeLinkRow(row: Record<string, unknown>): TransportFeeLinkEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    assignmentId: String(row.assignment_id),
    studentId: String(row.student_id),
    transportFeeStructureId:
      row.transport_fee_structure_id == null ? null : String(row.transport_fee_structure_id),
    feesInvoiceId: row.fees_invoice_id == null ? null : String(row.fees_invoice_id),
    feesStructureId: row.fees_structure_id == null ? null : String(row.fees_structure_id),
    status: String(row.status) as TransportFeeLinkStatus,
    reason: row.reason == null ? null : String(row.reason),
    createdAt: toDate(row.created_at),
  };
}

function paginatedMeta(pagination: PaginationOptions, totalItems: number) {
  return {
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalItems,
    totalPages: Math.ceil(totalItems / pagination.pageSize),
  };
}

export class PgTransportRepository implements TransportRepository {
  constructor(private readonly pool: PgPoolLike) {}

  /** G-710: every query runs with the tenant GUC bound so RLS applies. */
  private query(tenantId: string, text: string, values?: unknown[]): Promise<pg.QueryResult> {
    return withPgTenant(
      this.pool,
      tenantId,
      (client) => client.query(text, values) as unknown as Promise<pg.QueryResult>,
    );
  }

  /**
   * PRC-M448: `UPDATE ... SET <only provided columns>, updated_at = now()` in one statement.
   * Column map values may carry a `::type` cast suffix. Undefined fields are left untouched.
   */
  private async partialUpdate(
    tenantId: string,
    table: string,
    id: string,
    data: Record<string, unknown>,
    columns: Record<string, string>,
  ): Promise<Record<string, unknown> | null> {
    const sets: string[] = [];
    const values: unknown[] = [id, tenantId];
    for (const [key, spec] of Object.entries(columns)) {
      if (data[key] === undefined) continue;
      const [column = spec, cast] = spec.split('::');
      values.push(data[key]);
      sets.push(`${column} = $${values.length}${cast ? `::${cast}` : ''}`);
    }
    sets.push('updated_at = now()');
    const result = await this.query(
      tenantId,
      `UPDATE ${table} SET ${sets.join(', ')} WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      values,
    );
    return (result.rows[0] as Record<string, unknown> | undefined) ?? null;
  }

  async ensureSchema(): Promise<void> {
    await ensureTransportSchema(this.pool);
  }

  // ─── Route Operations ────────────────────────────────────────────────────

  async createRoute(
    data: Omit<TransportRouteEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<TransportRouteEntity> {
    await this.ensureSchema();
    const now = new Date();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO transport_routes (
        id, tenant_id, name, description, status, start_location, end_location,
        distance_km, estimated_duration_minutes, operating_days, departure_time,
        return_time, institution_id, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
      )
      RETURNING *`,
      [
        data.id,
        data.tenantId,
        data.name,
        data.description,
        data.status,
        data.startLocation,
        data.endLocation,
        data.distanceKm,
        data.estimatedDurationMinutes,
        data.operatingDays,
        data.departureTime,
        data.returnTime,
        data.institutionId,
        now,
        now,
      ],
    );
    return mapRouteRow(result.rows[0] as Record<string, unknown>);
  }

  async updateRoute(
    id: string,
    tenantId: string,
    data: Partial<TransportRouteEntity>,
  ): Promise<TransportRouteEntity | null> {
    await this.ensureSchema();
    // PRC-M448: single-statement partial UPDATE of only the provided fields, so concurrent
    // edits to different fields no longer revert each other.
    const row = await this.partialUpdate(
      tenantId,
      'transport_routes',
      id,
      data as Record<string, unknown>,
      {
        name: 'name',
        description: 'description',
        status: 'status',
        startLocation: 'start_location',
        endLocation: 'end_location',
        distanceKm: 'distance_km',
        estimatedDurationMinutes: 'estimated_duration_minutes',
        operatingDays: 'operating_days',
        departureTime: 'departure_time',
        returnTime: 'return_time',
        institutionId: 'institution_id',
      },
    );
    return row ? mapRouteRow(row) : null;
  }

  async findRouteById(id: string, tenantId: string): Promise<TransportRouteEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM transport_routes WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapRouteRow(result.rows[0] as Record<string, unknown>);
  }

  async listRoutes(
    tenantId: string,
    filter: RouteFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<TransportRouteEntity>> {
    await this.ensureSchema();
    const conditions = ['tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (filter.status) {
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }
    if (filter.institutionId) {
      params.push(filter.institutionId);
      conditions.push(`institution_id = $${params.length}`);
    }
    if (filter.search) {
      params.push(`%${filter.search.toLowerCase()}%`);
      conditions.push(`LOWER(name) LIKE $${params.length}`);
    }

    const where = conditions.join(' AND ');
    const countResult = await this.query(
      tenantId,
      `SELECT COUNT(*)::int AS total FROM transport_routes WHERE ${where}`,
      params,
    );
    const totalItems = Number((countResult.rows[0] as { total: number }).total);
    const offset = (pagination.page - 1) * pagination.pageSize;
    params.push(pagination.pageSize, offset);
    const dataResult = await this.query(
      tenantId,
      `SELECT * FROM transport_routes
       WHERE ${where}
       ORDER BY name
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return {
      data: (dataResult.rows as Record<string, unknown>[]).map(mapRouteRow),
      meta: paginatedMeta(pagination, totalItems),
    };
  }

  async deleteRoute(id: string, tenantId: string): Promise<boolean> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `DELETE FROM transport_routes WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  // ─── Stop Operations ─────────────────────────────────────────────────────

  async createStop(
    data: Omit<RouteStopEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<RouteStopEntity> {
    await this.ensureSchema();
    const now = new Date();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO transport_stops (
        id, tenant_id, route_id, name, latitude, longitude, stop_order,
        pickup_time, dropoff_time, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
      )
      RETURNING *`,
      [
        data.id,
        data.tenantId,
        data.routeId,
        data.name,
        data.latitude,
        data.longitude,
        data.stopOrder,
        data.pickupTime,
        data.dropoffTime,
        now,
        now,
      ],
    );
    return mapStopRow(result.rows[0] as Record<string, unknown>);
  }

  async updateStop(
    id: string,
    tenantId: string,
    data: Partial<RouteStopEntity>,
  ): Promise<RouteStopEntity | null> {
    await this.ensureSchema();
    // PRC-M448: single-statement partial UPDATE of only the provided fields, so concurrent
    // edits to different fields no longer revert each other.
    const row = await this.partialUpdate(
      tenantId,
      'transport_stops',
      id,
      data as Record<string, unknown>,
      {
        routeId: 'route_id',
        name: 'name',
        latitude: 'latitude',
        longitude: 'longitude',
        stopOrder: 'stop_order',
        pickupTime: 'pickup_time',
        dropoffTime: 'dropoff_time',
      },
    );
    return row ? mapStopRow(row) : null;
  }

  async findStopById(id: string, tenantId: string): Promise<RouteStopEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM transport_stops WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapStopRow(result.rows[0] as Record<string, unknown>);
  }

  async listStopsByRoute(routeId: string, tenantId: string): Promise<RouteStopEntity[]> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM transport_stops
       WHERE route_id = $1 AND tenant_id = $2
       ORDER BY stop_order ASC`,
      [routeId, tenantId],
    );
    return (result.rows as Record<string, unknown>[]).map(mapStopRow);
  }

  async deleteStop(id: string, tenantId: string): Promise<boolean> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `DELETE FROM transport_stops WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  // ─── Vehicle Operations ──────────────────────────────────────────────────

  async createVehicle(
    data: Omit<VehicleEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<VehicleEntity> {
    await this.ensureSchema();
    const now = new Date();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO transport_vehicles (
        id, tenant_id, registration_number, make, model, year, capacity, status,
        insurance_expiry, last_service_date, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
      )
      RETURNING *`,
      [
        data.id,
        data.tenantId,
        data.registrationNumber,
        data.make,
        data.model,
        data.year,
        data.capacity,
        data.status,
        data.insuranceExpiry,
        data.lastServiceDate,
        now,
        now,
      ],
    );
    return mapVehicleRow(result.rows[0] as Record<string, unknown>);
  }

  async updateVehicle(
    id: string,
    tenantId: string,
    data: Partial<VehicleEntity>,
  ): Promise<VehicleEntity | null> {
    await this.ensureSchema();
    // PRC-M448: single-statement partial UPDATE of only the provided fields, so concurrent
    // edits to different fields no longer revert each other.
    const row = await this.partialUpdate(
      tenantId,
      'transport_vehicles',
      id,
      data as Record<string, unknown>,
      {
        registrationNumber: 'registration_number',
        make: 'make',
        model: 'model',
        year: 'year',
        capacity: 'capacity',
        status: 'status',
        insuranceExpiry: 'insurance_expiry',
        lastServiceDate: 'last_service_date',
      },
    );
    return row ? mapVehicleRow(row) : null;
  }

  async findVehicleById(id: string, tenantId: string): Promise<VehicleEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM transport_vehicles WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapVehicleRow(result.rows[0] as Record<string, unknown>);
  }

  async findVehicleByRegistration(
    registrationNumber: string,
    tenantId: string,
  ): Promise<VehicleEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM transport_vehicles
       WHERE registration_number = $1 AND tenant_id = $2
       LIMIT 1`,
      [registrationNumber, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapVehicleRow(result.rows[0] as Record<string, unknown>);
  }

  async listVehicles(
    tenantId: string,
    filter: VehicleFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<VehicleEntity>> {
    await this.ensureSchema();
    const conditions = ['tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (filter.status) {
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }
    if (filter.search) {
      const search = `%${filter.search.toLowerCase()}%`;
      params.push(search, search, search);
      conditions.push(
        `(LOWER(registration_number) LIKE $${params.length - 2}
          OR LOWER(COALESCE(make, '')) LIKE $${params.length - 1}
          OR LOWER(COALESCE(model, '')) LIKE $${params.length})`,
      );
    }

    const where = conditions.join(' AND ');
    const countResult = await this.query(
      tenantId,
      `SELECT COUNT(*)::int AS total FROM transport_vehicles WHERE ${where}`,
      params,
    );
    const totalItems = Number((countResult.rows[0] as { total: number }).total);
    const offset = (pagination.page - 1) * pagination.pageSize;
    params.push(pagination.pageSize, offset);
    const dataResult = await this.query(
      tenantId,
      `SELECT * FROM transport_vehicles
       WHERE ${where}
       ORDER BY registration_number
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return {
      data: (dataResult.rows as Record<string, unknown>[]).map(mapVehicleRow),
      meta: paginatedMeta(pagination, totalItems),
    };
  }

  async deleteVehicle(id: string, tenantId: string): Promise<boolean> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `DELETE FROM transport_vehicles WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  // ─── Driver Assignment Operations ────────────────────────────────────────

  async createDriverAssignment(
    data: Omit<DriverAssignmentEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<DriverAssignmentEntity> {
    await this.ensureSchema();
    const now = new Date();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO transport_driver_assignments (
        id, tenant_id, vehicle_id, driver_id, route_id, start_date, end_date,
        is_active, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6::date,$7::date,$8,$9,$10
      )
      RETURNING *`,
      [
        data.id,
        data.tenantId,
        data.vehicleId,
        data.driverId,
        data.routeId,
        data.startDate,
        data.endDate,
        data.isActive,
        now,
        now,
      ],
    );
    return mapDriverAssignmentRow(result.rows[0] as Record<string, unknown>);
  }

  async updateDriverAssignment(
    id: string,
    tenantId: string,
    data: Partial<DriverAssignmentEntity>,
  ): Promise<DriverAssignmentEntity | null> {
    await this.ensureSchema();
    // PRC-M448: single-statement partial UPDATE of only the provided fields, so concurrent
    // edits to different fields no longer revert each other.
    const row = await this.partialUpdate(
      tenantId,
      'transport_driver_assignments',
      id,
      data as Record<string, unknown>,
      {
        vehicleId: 'vehicle_id',
        driverId: 'driver_id',
        routeId: 'route_id',
        startDate: 'start_date::date',
        endDate: 'end_date::date',
        isActive: 'is_active',
      },
    );
    return row ? mapDriverAssignmentRow(row) : null;
  }

  async findDriverAssignmentById(
    id: string,
    tenantId: string,
  ): Promise<DriverAssignmentEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM transport_driver_assignments WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapDriverAssignmentRow(result.rows[0] as Record<string, unknown>);
  }

  async listDriverAssignments(
    tenantId: string,
    filter: DriverAssignmentFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<DriverAssignmentEntity>> {
    await this.ensureSchema();
    const conditions = ['tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (filter.vehicleId) {
      params.push(filter.vehicleId);
      conditions.push(`vehicle_id = $${params.length}`);
    }
    if (filter.driverId) {
      params.push(filter.driverId);
      conditions.push(`driver_id = $${params.length}`);
    }
    if (filter.routeId) {
      params.push(filter.routeId);
      conditions.push(`route_id = $${params.length}`);
    }
    if (filter.isActive !== undefined) {
      params.push(filter.isActive);
      conditions.push(`is_active = $${params.length}`);
    }

    const where = conditions.join(' AND ');
    const countResult = await this.query(
      tenantId,
      `SELECT COUNT(*)::int AS total FROM transport_driver_assignments WHERE ${where}`,
      params,
    );
    const totalItems = Number((countResult.rows[0] as { total: number }).total);
    const offset = (pagination.page - 1) * pagination.pageSize;
    params.push(pagination.pageSize, offset);
    const dataResult = await this.query(
      tenantId,
      `SELECT * FROM transport_driver_assignments
       WHERE ${where}
       ORDER BY start_date DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return {
      data: (dataResult.rows as Record<string, unknown>[]).map(mapDriverAssignmentRow),
      meta: paginatedMeta(pagination, totalItems),
    };
  }

  async findActiveDriverAssignment(
    vehicleId: string,
    tenantId: string,
  ): Promise<DriverAssignmentEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM transport_driver_assignments
       WHERE vehicle_id = $1 AND tenant_id = $2 AND is_active = true
       LIMIT 1`,
      [vehicleId, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapDriverAssignmentRow(result.rows[0] as Record<string, unknown>);
  }

  // ─── Student Assignment Operations ───────────────────────────────────────

  async createStudentAssignment(
    data: Omit<StudentRouteAssignmentEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<StudentRouteAssignmentEntity> {
    await this.ensureSchema();
    const now = new Date();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO transport_student_assignments (
        id, tenant_id, student_id, route_id, stop_id, start_date, end_date,
        is_active, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6::date,$7::date,$8,$9,$10
      )
      RETURNING *`,
      [
        data.id,
        data.tenantId,
        data.studentId,
        data.routeId,
        data.stopId,
        data.startDate,
        data.endDate,
        data.isActive,
        now,
        now,
      ],
    );
    return mapStudentAssignmentRow(result.rows[0] as Record<string, unknown>);
  }

  async updateStudentAssignment(
    id: string,
    tenantId: string,
    data: Partial<StudentRouteAssignmentEntity>,
  ): Promise<StudentRouteAssignmentEntity | null> {
    await this.ensureSchema();
    // PRC-M448: single-statement partial UPDATE of only the provided fields, so concurrent
    // edits to different fields no longer revert each other.
    const row = await this.partialUpdate(
      tenantId,
      'transport_student_assignments',
      id,
      data as Record<string, unknown>,
      {
        studentId: 'student_id',
        routeId: 'route_id',
        stopId: 'stop_id',
        startDate: 'start_date::date',
        endDate: 'end_date::date',
        isActive: 'is_active',
      },
    );
    return row ? mapStudentAssignmentRow(row) : null;
  }

  async findStudentAssignmentById(
    id: string,
    tenantId: string,
  ): Promise<StudentRouteAssignmentEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM transport_student_assignments WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapStudentAssignmentRow(result.rows[0] as Record<string, unknown>);
  }

  async listStudentAssignments(
    tenantId: string,
    filter: StudentAssignmentFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<StudentRouteAssignmentEntity>> {
    await this.ensureSchema();
    const conditions = ['tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (filter.studentId) {
      params.push(filter.studentId);
      conditions.push(`student_id = $${params.length}`);
    }
    if (filter.routeId) {
      params.push(filter.routeId);
      conditions.push(`route_id = $${params.length}`);
    }
    if (filter.stopId) {
      params.push(filter.stopId);
      conditions.push(`stop_id = $${params.length}`);
    }
    if (filter.isActive !== undefined) {
      params.push(filter.isActive);
      conditions.push(`is_active = $${params.length}`);
    }

    const where = conditions.join(' AND ');
    const countResult = await this.query(
      tenantId,
      `SELECT COUNT(*)::int AS total FROM transport_student_assignments WHERE ${where}`,
      params,
    );
    const totalItems = Number((countResult.rows[0] as { total: number }).total);
    const offset = (pagination.page - 1) * pagination.pageSize;
    params.push(pagination.pageSize, offset);
    const dataResult = await this.query(
      tenantId,
      `SELECT * FROM transport_student_assignments
       WHERE ${where}
       ORDER BY start_date DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return {
      data: (dataResult.rows as Record<string, unknown>[]).map(mapStudentAssignmentRow),
      meta: paginatedMeta(pagination, totalItems),
    };
  }

  async findActiveStudentAssignment(
    studentId: string,
    tenantId: string,
  ): Promise<StudentRouteAssignmentEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM transport_student_assignments
       WHERE student_id = $1 AND tenant_id = $2 AND is_active = true
       LIMIT 1`,
      [studentId, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapStudentAssignmentRow(result.rows[0] as Record<string, unknown>);
  }

  async listAllStops(tenantId: string): Promise<RouteStopEntity[]> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM transport_stops WHERE tenant_id = $1 ORDER BY route_id, stop_order`,
      [tenantId],
    );
    return (result.rows as Record<string, unknown>[]).map(mapStopRow);
  }

  async registerVehicleDevice(
    data: Omit<VehicleDeviceEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<VehicleDeviceEntity> {
    await this.ensureSchema();
    const now = new Date();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO transport_vehicle_devices (
        id, tenant_id, vehicle_id, device_id, device_key_hash, is_active, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *`,
      [
        data.id,
        data.tenantId,
        data.vehicleId,
        data.deviceId,
        data.deviceKeyHash,
        data.isActive,
        now,
        now,
      ],
    );
    return mapDeviceRow(result.rows[0] as Record<string, unknown>);
  }

  async findDeviceByDeviceId(
    deviceId: string,
    tenantId: string,
  ): Promise<VehicleDeviceEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM transport_vehicle_devices
       WHERE device_id = $1 AND tenant_id = $2 AND is_active = true
       LIMIT 1`,
      [deviceId, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapDeviceRow(result.rows[0] as Record<string, unknown>);
  }

  async findDeviceByVehicleId(
    vehicleId: string,
    tenantId: string,
  ): Promise<VehicleDeviceEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM transport_vehicle_devices
       WHERE vehicle_id = $1 AND tenant_id = $2 AND is_active = true
       LIMIT 1`,
      [vehicleId, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapDeviceRow(result.rows[0] as Record<string, unknown>);
  }

  async ingestGpsPing(
    data: Omit<GpsPingEntity, 'createdAt'>,
  ): Promise<{ ping: GpsPingEntity; duplicate: boolean }> {
    await this.ensureSchema();
    const now = new Date();
    const inserted = await this.query(
      data.tenantId,
      `INSERT INTO transport_gps_pings (
        id, tenant_id, vehicle_id, device_id, ping_id, latitude, longitude,
        recorded_at, speed_kph, heading_deg, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (tenant_id, device_id, ping_id) DO NOTHING
      RETURNING *`,
      [
        data.id,
        data.tenantId,
        data.vehicleId,
        data.deviceId,
        data.pingId,
        data.latitude,
        data.longitude,
        data.recordedAt,
        data.speedKph,
        data.headingDeg,
        now,
      ],
    );
    if (inserted.rows[0]) {
      return { ping: mapGpsPingRow(inserted.rows[0] as Record<string, unknown>), duplicate: false };
    }
    const existing = await this.query(
      data.tenantId,
      `SELECT * FROM transport_gps_pings
       WHERE tenant_id = $1 AND device_id = $2 AND ping_id = $3
       LIMIT 1`,
      [data.tenantId, data.deviceId, data.pingId],
    );
    return { ping: mapGpsPingRow(existing.rows[0] as Record<string, unknown>), duplicate: true };
  }

  async ingestGpsPings(
    tenantId: string,
    rows: Array<Omit<GpsPingEntity, 'createdAt'>>,
  ): Promise<Array<{ ping: GpsPingEntity; duplicate: boolean }>> {
    await this.ensureSchema();
    // PRC-M446: whole batch in one withPgTenant transaction (one connection, one commit).
    return withPgTenant(this.pool, tenantId, async (client) => {
      const q = (text: string, values: unknown[]) =>
        client.query(text, values) as unknown as Promise<pg.QueryResult>;
      const now = new Date();
      const out: Array<{ ping: GpsPingEntity; duplicate: boolean }> = [];
      for (const data of rows) {
        const inserted = await q(
          `INSERT INTO transport_gps_pings (
            id, tenant_id, vehicle_id, device_id, ping_id, latitude, longitude,
            recorded_at, speed_kph, heading_deg, created_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
          ON CONFLICT (tenant_id, device_id, ping_id) DO NOTHING
          RETURNING *`,
          [
            data.id,
            tenantId,
            data.vehicleId,
            data.deviceId,
            data.pingId,
            data.latitude,
            data.longitude,
            data.recordedAt,
            data.speedKph,
            data.headingDeg,
            now,
          ],
        );
        if (inserted.rows[0]) {
          out.push({
            ping: mapGpsPingRow(inserted.rows[0] as Record<string, unknown>),
            duplicate: false,
          });
          continue;
        }
        const existing = await q(
          `SELECT * FROM transport_gps_pings
           WHERE tenant_id = $1 AND device_id = $2 AND ping_id = $3
           LIMIT 1`,
          [tenantId, data.deviceId, data.pingId],
        );
        out.push({
          ping: mapGpsPingRow(existing.rows[0] as Record<string, unknown>),
          duplicate: true,
        });
      }
      return out;
    });
  }

  async listGpsPingsForVehicle(tenantId: string, vehicleId: string): Promise<GpsPingEntity[]> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM transport_gps_pings
       WHERE tenant_id = $1 AND vehicle_id = $2
       ORDER BY recorded_at DESC`,
      [tenantId, vehicleId],
    );
    return (result.rows as Record<string, unknown>[]).map(mapGpsPingRow);
  }

  async listLatestGpsPingPerVehicle(tenantId: string): Promise<GpsPingEntity[]> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT DISTINCT ON (vehicle_id) *
       FROM transport_gps_pings
       WHERE tenant_id = $1
       ORDER BY vehicle_id, recorded_at DESC`,
      [tenantId],
    );
    return (result.rows as Record<string, unknown>[]).map(mapGpsPingRow);
  }

  async upsertBusAttendance(
    data: Omit<BusAttendanceEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<BusAttendanceEntity> {
    await this.ensureSchema();
    const now = new Date();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO transport_bus_attendance (
        id, tenant_id, route_id, trip_date, direction, student_id, stop_id,
        status, recorded_at, recorded_by, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (tenant_id, route_id, trip_date, direction, student_id)
      DO UPDATE SET
        stop_id = EXCLUDED.stop_id,
        status = EXCLUDED.status,
        recorded_at = EXCLUDED.recorded_at,
        recorded_by = EXCLUDED.recorded_by,
        updated_at = EXCLUDED.updated_at
      RETURNING *`,
      [
        data.id,
        data.tenantId,
        data.routeId,
        data.tripDate,
        data.direction,
        data.studentId,
        data.stopId,
        data.status,
        data.recordedAt,
        data.recordedBy,
        now,
        now,
      ],
    );
    return mapAttendanceRow(result.rows[0] as Record<string, unknown>);
  }

  async listBusAttendanceTrip(
    tenantId: string,
    filter: { routeId: string; tripDate: string; direction: TripDirection },
  ): Promise<BusAttendanceEntity[]> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM transport_bus_attendance
       WHERE tenant_id = $1 AND route_id = $2 AND trip_date = $3 AND direction = $4
       ORDER BY recorded_at`,
      [tenantId, filter.routeId, filter.tripDate, filter.direction],
    );
    return (result.rows as Record<string, unknown>[]).map(mapAttendanceRow);
  }

  async createAlertRule(
    data: Omit<AlertRuleEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<AlertRuleEntity> {
    await this.ensureSchema();
    const now = new Date();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO transport_alert_rules (
        id, tenant_id, kind, threshold, channels, route_id, is_active, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *`,
      [
        data.id,
        data.tenantId,
        data.kind,
        data.threshold,
        data.channels,
        data.routeId,
        data.isActive,
        now,
        now,
      ],
    );
    return mapAlertRuleRow(result.rows[0] as Record<string, unknown>);
  }

  async listAlertRules(tenantId: string): Promise<AlertRuleEntity[]> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM transport_alert_rules WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return (result.rows as Record<string, unknown>[]).map(mapAlertRuleRow);
  }

  async createAlert(data: Omit<TransportAlertEntity, 'createdAt'>): Promise<TransportAlertEntity> {
    await this.ensureSchema();
    const now = new Date();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO transport_alerts (
        id, tenant_id, rule_id, kind, vehicle_id, route_id, student_id,
        message, payload, acknowledged_at, acknowledged_by, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *`,
      [
        data.id,
        data.tenantId,
        data.ruleId,
        data.kind,
        data.vehicleId,
        data.routeId,
        data.studentId,
        data.message,
        JSON.stringify(data.payload),
        data.acknowledgedAt,
        data.acknowledgedBy,
        now,
      ],
    );
    return mapAlertRow(result.rows[0] as Record<string, unknown>);
  }

  async listAlerts(tenantId: string): Promise<TransportAlertEntity[]> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM transport_alerts WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return (result.rows as Record<string, unknown>[]).map(mapAlertRow);
  }

  async acknowledgeAlert(
    id: string,
    tenantId: string,
    acknowledgedBy: string,
  ): Promise<TransportAlertEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `UPDATE transport_alerts
       SET acknowledged_at = now(), acknowledged_by = $3
       WHERE id = $1 AND tenant_id = $2
       RETURNING *`,
      [id, tenantId, acknowledgedBy],
    );
    if (!result.rows[0]) return null;
    return mapAlertRow(result.rows[0] as Record<string, unknown>);
  }

  async createTransportFeeStructure(
    data: Omit<TransportFeeStructureEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<TransportFeeStructureEntity> {
    await this.ensureSchema();
    const now = new Date();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO transport_fee_structures (
        id, tenant_id, name, route_id, stop_id, min_distance_km, max_distance_km,
        amount_cents, currency, fees_structure_id, is_active, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *`,
      [
        data.id,
        data.tenantId,
        data.name,
        data.routeId,
        data.stopId,
        data.minDistanceKm,
        data.maxDistanceKm,
        data.amountCents,
        data.currency,
        data.feesStructureId,
        data.isActive,
        now,
        now,
      ],
    );
    return mapFeeStructureRow(result.rows[0] as Record<string, unknown>);
  }

  async listTransportFeeStructures(tenantId: string): Promise<TransportFeeStructureEntity[]> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM transport_fee_structures WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return (result.rows as Record<string, unknown>[]).map(mapFeeStructureRow);
  }

  async createFeeLink(
    data: Omit<TransportFeeLinkEntity, 'createdAt'>,
  ): Promise<TransportFeeLinkEntity> {
    await this.ensureSchema();
    const now = new Date();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO transport_fee_links (
        id, tenant_id, assignment_id, student_id, transport_fee_structure_id,
        fees_invoice_id, fees_structure_id, status, reason, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (tenant_id, assignment_id) DO NOTHING
      RETURNING *`,
      [
        data.id,
        data.tenantId,
        data.assignmentId,
        data.studentId,
        data.transportFeeStructureId,
        data.feesInvoiceId,
        data.feesStructureId,
        data.status,
        data.reason,
        now,
      ],
    );
    // PRC-H108: a concurrent request won the insert for this assignment.
    // Return the existing link instead of a duplicate (and avoid a second
    // invoice downstream). Requires db/sql/121 unique index.
    if (!result.rows[0]) {
      const existing = await this.findFeeLinkByAssignment(data.assignmentId, data.tenantId);
      if (existing) return existing;
      throw new ConflictError('Transport fee link already exists for this assignment');
    }
    return mapFeeLinkRow(result.rows[0] as Record<string, unknown>);
  }

  async listFeeLinks(tenantId: string): Promise<TransportFeeLinkEntity[]> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM transport_fee_links WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return (result.rows as Record<string, unknown>[]).map(mapFeeLinkRow);
  }

  async setTransportFeeStructureFeesId(
    id: string,
    tenantId: string,
    feesStructureId: string,
  ): Promise<TransportFeeStructureEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `UPDATE transport_fee_structures SET fees_structure_id = $3, updated_at = now()
       WHERE id = $1 AND tenant_id = $2
       RETURNING *`,
      [id, tenantId, feesStructureId],
    );
    if (!result.rows[0]) return null;
    return mapFeeStructureRow(result.rows[0] as Record<string, unknown>);
  }

  async claimPendingFeeLinks(
    tenantId: string,
    leaseToken: string,
    leaseExpiresAt: Date,
    limit: number,
  ): Promise<TransportFeeLinkEntity[]> {
    await this.ensureSchema();
    // PRC-M439: SKIP LOCKED + lease marker so concurrent workers never claim the same link.
    const result = await this.query(
      tenantId,
      `UPDATE transport_fee_links l
          SET reason = $2
        WHERE l.id IN (
          SELECT id FROM transport_fee_links
           WHERE tenant_id = $1 AND status = 'pending'
             AND (reason IS NULL OR reason NOT LIKE '${FEE_LINK_LEASE_PREFIX}%'
                  OR COALESCE(NULLIF(split_part(reason, ':', 3), ''), '0')::bigint < $3)
           ORDER BY created_at
           LIMIT $4
           FOR UPDATE SKIP LOCKED
        )
        RETURNING l.*`,
      [
        tenantId,
        `${FEE_LINK_LEASE_PREFIX}${leaseToken}:${leaseExpiresAt.getTime()}`,
        Date.now(),
        limit,
      ],
    );
    return (result.rows as Record<string, unknown>[]).map(mapFeeLinkRow);
  }

  async settleFeeLink(
    id: string,
    tenantId: string,
    patch: { status: TransportFeeLinkStatus; feesInvoiceId: string | null; reason: string | null },
    leaseToken?: string,
  ): Promise<TransportFeeLinkEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `UPDATE transport_fee_links
          SET status = $3, fees_invoice_id = $4, reason = $5
        WHERE id = $1 AND tenant_id = $2 AND status = 'pending'
          AND ($6::text IS NULL OR reason LIKE $6::text || '%')
        RETURNING *`,
      [
        id,
        tenantId,
        patch.status,
        patch.feesInvoiceId,
        patch.reason,
        leaseToken ? `${FEE_LINK_LEASE_PREFIX}${leaseToken}:` : null,
      ],
    );
    if (!result.rows[0]) return null;
    return mapFeeLinkRow(result.rows[0] as Record<string, unknown>);
  }

  async countPendingFeeLinks(tenantId: string): Promise<number> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT COUNT(*)::int AS n FROM transport_fee_links WHERE tenant_id = $1 AND status = 'pending'`,
      [tenantId],
    );
    return Number((result.rows[0] as { n?: number } | undefined)?.n ?? 0);
  }

  async findFeeLinkByAssignment(
    assignmentId: string,
    tenantId: string,
  ): Promise<TransportFeeLinkEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM transport_fee_links
       WHERE assignment_id = $1 AND tenant_id = $2
       LIMIT 1`,
      [assignmentId, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapFeeLinkRow(result.rows[0] as Record<string, unknown>);
  }
}

export function createPgTransportRepository(): PgTransportRepository | null {
  const pool = getSharedTransportPool();
  if (!pool) return null;
  return new PgTransportRepository(pool);
}
