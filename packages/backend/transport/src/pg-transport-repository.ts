/**
 * Postgres-backed transport repository (raw `pg` — no Prisma).
 *
 * When DATABASE_URL is set, transport CRUD persists via db/sql/006_transport_schema.sql.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import type { PaginationOptions, PaginatedResult } from '@proctira/common';

import type {
  DriverAssignmentEntity,
  DriverAssignmentFilter,
  RouteFilter,
  RouteStopEntity,
  RouteStatus,
  StudentAssignmentFilter,
  StudentRouteAssignmentEntity,
  TransportRepository,
  TransportRouteEntity,
  VehicleEntity,
  VehicleFilter,
  VehicleStatus,
} from './transport-repository.js';

const { Pool } = pg;

export type PgPoolLike = Pick<pg.Pool, 'query' | 'end'>;

let sharedPool: pg.Pool | null = null;
let schemaReady: Promise<void> | null = null;

function resolveDatabaseUrl(): string | null {
  const url = process.env.DATABASE_URL?.trim();
  return url && url.length > 0 ? url : null;
}

export function getSharedTransportPool(): pg.Pool | null {
  const url = resolveDatabaseUrl();
  if (!url) return null;
  if (!sharedPool) {
    sharedPool = new Pool({ connectionString: url });
  }
  return sharedPool;
}

function schemaSqlPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../../../../db/sql/006_transport_schema.sql'),
    join(process.cwd(), 'db/sql/006_transport_schema.sql'),
    join(process.cwd(), '../../db/sql/006_transport_schema.sql'),
  ];
  for (const path of candidates) {
    try {
      readFileSync(path, 'utf8');
      return path;
    } catch {
      // try next
    }
  }
  return candidates[0]!;
}

export async function ensureTransportSchema(pool: PgPoolLike = getSharedTransportPool()!): Promise<void> {
  if (!pool) throw new Error('DATABASE_URL is required for transport schema ensure');
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = readFileSync(schemaSqlPath(), 'utf8');
      await pool.query(sql);
    })();
  }
  await schemaReady;
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

  async ensureSchema(): Promise<void> {
    await ensureTransportSchema(this.pool);
  }

  // ─── Route Operations ────────────────────────────────────────────────────

  async createRoute(
    data: Omit<TransportRouteEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<TransportRouteEntity> {
    await this.ensureSchema();
    const now = new Date();
    const result = await this.pool.query(
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
    const existing = await this.findRouteById(id, tenantId);
    if (!existing) return null;
    const merged: TransportRouteEntity = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    const result = await this.pool.query(
      `UPDATE transport_routes SET
        name = $3,
        description = $4,
        status = $5,
        start_location = $6,
        end_location = $7,
        distance_km = $8,
        estimated_duration_minutes = $9,
        operating_days = $10,
        departure_time = $11,
        return_time = $12,
        institution_id = $13,
        updated_at = $14
      WHERE id = $1 AND tenant_id = $2
      RETURNING *`,
      [
        id,
        tenantId,
        merged.name,
        merged.description,
        merged.status,
        merged.startLocation,
        merged.endLocation,
        merged.distanceKm,
        merged.estimatedDurationMinutes,
        merged.operatingDays,
        merged.departureTime,
        merged.returnTime,
        merged.institutionId,
        merged.updatedAt,
      ],
    );
    if (!result.rows[0]) return null;
    return mapRouteRow(result.rows[0] as Record<string, unknown>);
  }

  async findRouteById(id: string, tenantId: string): Promise<TransportRouteEntity | null> {
    await this.ensureSchema();
    const result = await this.pool.query(
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
    const countResult = await this.pool.query(
      `SELECT COUNT(*)::int AS total FROM transport_routes WHERE ${where}`,
      params,
    );
    const totalItems = Number((countResult.rows[0] as { total: number }).total);
    const offset = (pagination.page - 1) * pagination.pageSize;
    params.push(pagination.pageSize, offset);
    const dataResult = await this.pool.query(
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
    const result = await this.pool.query(
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
    const result = await this.pool.query(
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
    const existing = await this.findStopById(id, tenantId);
    if (!existing) return null;
    const merged: RouteStopEntity = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    const result = await this.pool.query(
      `UPDATE transport_stops SET
        route_id = $3,
        name = $4,
        latitude = $5,
        longitude = $6,
        stop_order = $7,
        pickup_time = $8,
        dropoff_time = $9,
        updated_at = $10
      WHERE id = $1 AND tenant_id = $2
      RETURNING *`,
      [
        id,
        tenantId,
        merged.routeId,
        merged.name,
        merged.latitude,
        merged.longitude,
        merged.stopOrder,
        merged.pickupTime,
        merged.dropoffTime,
        merged.updatedAt,
      ],
    );
    if (!result.rows[0]) return null;
    return mapStopRow(result.rows[0] as Record<string, unknown>);
  }

  async findStopById(id: string, tenantId: string): Promise<RouteStopEntity | null> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `SELECT * FROM transport_stops WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapStopRow(result.rows[0] as Record<string, unknown>);
  }

  async listStopsByRoute(routeId: string, tenantId: string): Promise<RouteStopEntity[]> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `SELECT * FROM transport_stops
       WHERE route_id = $1 AND tenant_id = $2
       ORDER BY stop_order ASC`,
      [routeId, tenantId],
    );
    return (result.rows as Record<string, unknown>[]).map(mapStopRow);
  }

  async deleteStop(id: string, tenantId: string): Promise<boolean> {
    await this.ensureSchema();
    const result = await this.pool.query(
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
    const result = await this.pool.query(
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
    const existing = await this.findVehicleById(id, tenantId);
    if (!existing) return null;
    const merged: VehicleEntity = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    const result = await this.pool.query(
      `UPDATE transport_vehicles SET
        registration_number = $3,
        make = $4,
        model = $5,
        year = $6,
        capacity = $7,
        status = $8,
        insurance_expiry = $9,
        last_service_date = $10,
        updated_at = $11
      WHERE id = $1 AND tenant_id = $2
      RETURNING *`,
      [
        id,
        tenantId,
        merged.registrationNumber,
        merged.make,
        merged.model,
        merged.year,
        merged.capacity,
        merged.status,
        merged.insuranceExpiry,
        merged.lastServiceDate,
        merged.updatedAt,
      ],
    );
    if (!result.rows[0]) return null;
    return mapVehicleRow(result.rows[0] as Record<string, unknown>);
  }

  async findVehicleById(id: string, tenantId: string): Promise<VehicleEntity | null> {
    await this.ensureSchema();
    const result = await this.pool.query(
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
    const result = await this.pool.query(
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
    const countResult = await this.pool.query(
      `SELECT COUNT(*)::int AS total FROM transport_vehicles WHERE ${where}`,
      params,
    );
    const totalItems = Number((countResult.rows[0] as { total: number }).total);
    const offset = (pagination.page - 1) * pagination.pageSize;
    params.push(pagination.pageSize, offset);
    const dataResult = await this.pool.query(
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
    const result = await this.pool.query(
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
    const result = await this.pool.query(
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
    const existing = await this.findDriverAssignmentById(id, tenantId);
    if (!existing) return null;
    const merged: DriverAssignmentEntity = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    const result = await this.pool.query(
      `UPDATE transport_driver_assignments SET
        vehicle_id = $3,
        driver_id = $4,
        route_id = $5,
        start_date = $6::date,
        end_date = $7::date,
        is_active = $8,
        updated_at = $9
      WHERE id = $1 AND tenant_id = $2
      RETURNING *`,
      [
        id,
        tenantId,
        merged.vehicleId,
        merged.driverId,
        merged.routeId,
        merged.startDate,
        merged.endDate,
        merged.isActive,
        merged.updatedAt,
      ],
    );
    if (!result.rows[0]) return null;
    return mapDriverAssignmentRow(result.rows[0] as Record<string, unknown>);
  }

  async findDriverAssignmentById(
    id: string,
    tenantId: string,
  ): Promise<DriverAssignmentEntity | null> {
    await this.ensureSchema();
    const result = await this.pool.query(
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
    const countResult = await this.pool.query(
      `SELECT COUNT(*)::int AS total FROM transport_driver_assignments WHERE ${where}`,
      params,
    );
    const totalItems = Number((countResult.rows[0] as { total: number }).total);
    const offset = (pagination.page - 1) * pagination.pageSize;
    params.push(pagination.pageSize, offset);
    const dataResult = await this.pool.query(
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
    const result = await this.pool.query(
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
    const result = await this.pool.query(
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
    const existing = await this.findStudentAssignmentById(id, tenantId);
    if (!existing) return null;
    const merged: StudentRouteAssignmentEntity = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    const result = await this.pool.query(
      `UPDATE transport_student_assignments SET
        student_id = $3,
        route_id = $4,
        stop_id = $5,
        start_date = $6::date,
        end_date = $7::date,
        is_active = $8,
        updated_at = $9
      WHERE id = $1 AND tenant_id = $2
      RETURNING *`,
      [
        id,
        tenantId,
        merged.studentId,
        merged.routeId,
        merged.stopId,
        merged.startDate,
        merged.endDate,
        merged.isActive,
        merged.updatedAt,
      ],
    );
    if (!result.rows[0]) return null;
    return mapStudentAssignmentRow(result.rows[0] as Record<string, unknown>);
  }

  async findStudentAssignmentById(
    id: string,
    tenantId: string,
  ): Promise<StudentRouteAssignmentEntity | null> {
    await this.ensureSchema();
    const result = await this.pool.query(
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
    const countResult = await this.pool.query(
      `SELECT COUNT(*)::int AS total FROM transport_student_assignments WHERE ${where}`,
      params,
    );
    const totalItems = Number((countResult.rows[0] as { total: number }).total);
    const offset = (pagination.page - 1) * pagination.pageSize;
    params.push(pagination.pageSize, offset);
    const dataResult = await this.pool.query(
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
    const result = await this.pool.query(
      `SELECT * FROM transport_student_assignments
       WHERE student_id = $1 AND tenant_id = $2 AND is_active = true
       LIMIT 1`,
      [studentId, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapStudentAssignmentRow(result.rows[0] as Record<string, unknown>);
  }
}

export function createPgTransportRepository(): PgTransportRepository | null {
  const pool = getSharedTransportPool();
  if (!pool) return null;
  return new PgTransportRepository(pool);
}
