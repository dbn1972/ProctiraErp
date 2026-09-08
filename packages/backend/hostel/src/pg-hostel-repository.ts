/**
 * Postgres-backed hostel repository (raw `pg` — no Prisma).
 *
 * When DATABASE_URL is set, occupancy persists via db/sql/008_hostel_schema.sql.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { withPgTenant } from '@proctira/database';
import pg from 'pg';

import type {
  HostelAssignmentEntity,
  HostelBedEntity,
  HostelBlockEntity,
  HostelEntity,
  HostelLeaveEntity,
  HostelRepository,
  HostelRoomEntity,
  HostelStatus,
  HostelVisitorEntity,
  LeaveStatus,
  VisitorStatus,
} from './hostel-repository.js';

const { Pool } = pg;

export type PgPoolLike = Pick<pg.Pool, 'query' | 'end'> & Partial<Pick<pg.Pool, 'connect'>>;

let sharedPool: pg.Pool | null = null;
let schemaReady: Promise<void> | null = null;

function resolveDatabaseUrl(): string | null {
  const url = process.env.DATABASE_URL?.trim();
  return url && url.length > 0 ? url : null;
}

export function getSharedHostelPool(): pg.Pool | null {
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
    join(here, '../../../../db/sql/008_hostel_schema.sql'),
    join(process.cwd(), 'db/sql/008_hostel_schema.sql'),
    join(process.cwd(), '../../db/sql/008_hostel_schema.sql'),
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

export async function ensureHostelSchema(pool: PgPoolLike = getSharedHostelPool()!): Promise<void> {
  if (!pool) throw new Error('DATABASE_URL is required for hostel schema ensure');
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

function dateOnly(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function dateOnlyOrNull(value: unknown): string | null {
  if (value == null) return null;
  return dateOnly(value);
}

function mapHostel(row: Record<string, unknown>): HostelEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    name: String(row.name),
    code: String(row.code),
    address: row.address == null ? null : String(row.address),
    capacity: Number(row.capacity),
    status: String(row.status) as HostelStatus,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapAssignment(row: Record<string, unknown>): HostelAssignmentEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    studentId: String(row.student_id),
    bedId: String(row.bed_id),
    startDate: dateOnly(row.start_date),
    endDate: dateOnlyOrNull(row.end_date),
    isActive: Boolean(row.is_active),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapLeave(row: Record<string, unknown>): HostelLeaveEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    studentId: String(row.student_id),
    hostelId: String(row.hostel_id),
    startDate: dateOnly(row.start_date),
    endDate: dateOnly(row.end_date),
    reason: row.reason == null ? null : String(row.reason),
    status: String(row.status) as LeaveStatus,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapVisitor(row: Record<string, unknown>): HostelVisitorEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    hostelId: String(row.hostel_id),
    visitorName: String(row.visitor_name),
    studentId: String(row.student_id),
    visitDate: dateOnly(row.visit_date),
    status: String(row.status) as VisitorStatus,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapBlock(row: Record<string, unknown>): HostelBlockEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    hostelId: String(row.hostel_id),
    name: String(row.name),
    floor: Number(row.floor),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapRoom(row: Record<string, unknown>): HostelRoomEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    blockId: String(row.block_id),
    roomNumber: String(row.room_number),
    capacity: Number(row.capacity),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapBed(row: Record<string, unknown>): HostelBedEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    roomId: String(row.room_id),
    bedLabel: String(row.bed_label),
    isAvailable: Boolean(row.is_available),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

export class PgHostelRepository implements HostelRepository {
  constructor(private readonly pool: PgPoolLike) {}

  /** G-710: every query runs with the tenant GUC bound so RLS applies. */
  private query(tenantId: string, text: string, values?: unknown[]): Promise<pg.QueryResult> {
    return withPgTenant(this.pool, tenantId, (client) =>
      client.query(text, values) as unknown as Promise<pg.QueryResult>,
    );
  }

  async ensureSchema(): Promise<void> {
    await ensureHostelSchema(this.pool);
  }

  async createHostel(data: Omit<HostelEntity, 'createdAt' | 'updatedAt'>): Promise<HostelEntity> {
    await this.ensureSchema();
    const result = await this.query(data.tenantId, `INSERT INTO hostels (id, tenant_id, name, code, address, capacity, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [data.id, data.tenantId, data.name, data.code, data.address, data.capacity, data.status],
    );
    return mapHostel(result.rows[0] as Record<string, unknown>);
  }

  async listHostels(tenantId: string): Promise<HostelEntity[]> {
    await this.ensureSchema();
    const result = await this.query(tenantId, `SELECT * FROM hostels WHERE tenant_id = $1 ORDER BY name`,
      [tenantId],
    );
    return result.rows.map((row) => mapHostel(row as Record<string, unknown>));
  }

  async findHostelById(id: string, tenantId: string): Promise<HostelEntity | null> {
    await this.ensureSchema();
    const result = await this.query(tenantId, `SELECT * FROM hostels WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapHostel(result.rows[0] as Record<string, unknown>);
  }

  async createAssignment(
    data: Omit<HostelAssignmentEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<HostelAssignmentEntity> {
    await this.ensureSchema();
    const result = await this.query(data.tenantId, `INSERT INTO hostel_assignments
         (id, tenant_id, student_id, bed_id, start_date, end_date, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        data.id,
        data.tenantId,
        data.studentId,
        data.bedId,
        data.startDate,
        data.endDate,
        data.isActive,
      ],
    );
    return mapAssignment(result.rows[0] as Record<string, unknown>);
  }

  async listAssignments(tenantId: string): Promise<HostelAssignmentEntity[]> {
    await this.ensureSchema();
    const result = await this.query(tenantId, `SELECT * FROM hostel_assignments WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return result.rows.map((row) => mapAssignment(row as Record<string, unknown>));
  }

  async createLeave(
    data: Omit<HostelLeaveEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<HostelLeaveEntity> {
    await this.ensureSchema();
    const result = await this.query(data.tenantId, `INSERT INTO hostel_leaves
         (id, tenant_id, student_id, hostel_id, start_date, end_date, reason, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        data.id,
        data.tenantId,
        data.studentId,
        data.hostelId,
        data.startDate,
        data.endDate,
        data.reason,
        data.status,
      ],
    );
    return mapLeave(result.rows[0] as Record<string, unknown>);
  }

  async listLeaves(tenantId: string): Promise<HostelLeaveEntity[]> {
    await this.ensureSchema();
    const result = await this.query(tenantId, `SELECT * FROM hostel_leaves WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return result.rows.map((row) => mapLeave(row as Record<string, unknown>));
  }

  async findLeaveById(id: string, tenantId: string): Promise<HostelLeaveEntity | null> {
    await this.ensureSchema();
    const result = await this.query(tenantId, `SELECT * FROM hostel_leaves WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapLeave(result.rows[0] as Record<string, unknown>);
  }

  async updateLeave(
    id: string,
    tenantId: string,
    data: Partial<Pick<HostelLeaveEntity, 'status'>>,
  ): Promise<HostelLeaveEntity | null> {
    await this.ensureSchema();
    if (data.status === undefined) {
      return this.findLeaveById(id, tenantId);
    }
    const result = await this.query(tenantId, `UPDATE hostel_leaves
       SET status = $1, updated_at = now()
       WHERE id = $2 AND tenant_id = $3
       RETURNING *`,
      [data.status, id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapLeave(result.rows[0] as Record<string, unknown>);
  }

  async createVisitor(
    data: Omit<HostelVisitorEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<HostelVisitorEntity> {
    await this.ensureSchema();
    const result = await this.query(data.tenantId, `INSERT INTO hostel_visitors
         (id, tenant_id, hostel_id, visitor_name, student_id, visit_date, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        data.id,
        data.tenantId,
        data.hostelId,
        data.visitorName,
        data.studentId,
        data.visitDate,
        data.status,
      ],
    );
    return mapVisitor(result.rows[0] as Record<string, unknown>);
  }

  async listVisitors(tenantId: string): Promise<HostelVisitorEntity[]> {
    await this.ensureSchema();
    const result = await this.query(tenantId, `SELECT * FROM hostel_visitors WHERE tenant_id = $1 ORDER BY visit_date DESC`,
      [tenantId],
    );
    return result.rows.map((row) => mapVisitor(row as Record<string, unknown>));
  }

  async findVisitorById(id: string, tenantId: string): Promise<HostelVisitorEntity | null> {
    await this.ensureSchema();
    const result = await this.query(tenantId, `SELECT * FROM hostel_visitors WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapVisitor(result.rows[0] as Record<string, unknown>);
  }

  async updateVisitor(
    id: string,
    tenantId: string,
    data: Partial<Pick<HostelVisitorEntity, 'status'>>,
  ): Promise<HostelVisitorEntity | null> {
    await this.ensureSchema();
    if (data.status === undefined) {
      return this.findVisitorById(id, tenantId);
    }
    const result = await this.query(tenantId, `UPDATE hostel_visitors
       SET status = $1, updated_at = now()
       WHERE id = $2 AND tenant_id = $3
       RETURNING *`,
      [data.status, id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapVisitor(result.rows[0] as Record<string, unknown>);
  }

  async createBlock(
    data: Omit<HostelBlockEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<HostelBlockEntity> {
    await this.ensureSchema();
    const result = await this.query(data.tenantId, `INSERT INTO hostel_blocks (id, tenant_id, hostel_id, name, floor)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [data.id, data.tenantId, data.hostelId, data.name, data.floor],
    );
    return mapBlock(result.rows[0] as Record<string, unknown>);
  }

  async listBlocks(tenantId: string, hostelId?: string): Promise<HostelBlockEntity[]> {
    await this.ensureSchema();
    if (hostelId) {
      const result = await this.query(tenantId, `SELECT * FROM hostel_blocks WHERE tenant_id = $1 AND hostel_id = $2 ORDER BY floor, name`,
        [tenantId, hostelId],
      );
      return result.rows.map((row) => mapBlock(row as Record<string, unknown>));
    }
    const result = await this.query(tenantId, `SELECT * FROM hostel_blocks WHERE tenant_id = $1 ORDER BY floor, name`,
      [tenantId],
    );
    return result.rows.map((row) => mapBlock(row as Record<string, unknown>));
  }

  async createRoom(
    data: Omit<HostelRoomEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<HostelRoomEntity> {
    await this.ensureSchema();
    const result = await this.query(data.tenantId, `INSERT INTO hostel_rooms (id, tenant_id, block_id, room_number, capacity)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [data.id, data.tenantId, data.blockId, data.roomNumber, data.capacity],
    );
    return mapRoom(result.rows[0] as Record<string, unknown>);
  }

  async listRooms(tenantId: string, blockId?: string): Promise<HostelRoomEntity[]> {
    await this.ensureSchema();
    if (blockId) {
      const result = await this.query(tenantId, `SELECT * FROM hostel_rooms WHERE tenant_id = $1 AND block_id = $2 ORDER BY room_number`,
        [tenantId, blockId],
      );
      return result.rows.map((row) => mapRoom(row as Record<string, unknown>));
    }
    const result = await this.query(tenantId, `SELECT * FROM hostel_rooms WHERE tenant_id = $1 ORDER BY room_number`,
      [tenantId],
    );
    return result.rows.map((row) => mapRoom(row as Record<string, unknown>));
  }

  async createBed(
    data: Omit<HostelBedEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<HostelBedEntity> {
    await this.ensureSchema();
    const result = await this.query(data.tenantId, `INSERT INTO hostel_beds (id, tenant_id, room_id, bed_label, is_available)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [data.id, data.tenantId, data.roomId, data.bedLabel, data.isAvailable],
    );
    return mapBed(result.rows[0] as Record<string, unknown>);
  }

  async listBeds(tenantId: string, roomId?: string): Promise<HostelBedEntity[]> {
    await this.ensureSchema();
    if (roomId) {
      const result = await this.query(tenantId, `SELECT * FROM hostel_beds WHERE tenant_id = $1 AND room_id = $2 ORDER BY bed_label`,
        [tenantId, roomId],
      );
      return result.rows.map((row) => mapBed(row as Record<string, unknown>));
    }
    const result = await this.query(tenantId, `SELECT * FROM hostel_beds WHERE tenant_id = $1 ORDER BY bed_label`,
      [tenantId],
    );
    return result.rows.map((row) => mapBed(row as Record<string, unknown>));
  }

  async findBedById(id: string, tenantId: string): Promise<HostelBedEntity | null> {
    await this.ensureSchema();
    const result = await this.query(tenantId, `SELECT * FROM hostel_beds WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapBed(result.rows[0] as Record<string, unknown>);
  }

  async updateBed(
    id: string,
    tenantId: string,
    data: Partial<Pick<HostelBedEntity, 'isAvailable'>>,
  ): Promise<HostelBedEntity | null> {
    await this.ensureSchema();
    if (data.isAvailable === undefined) {
      return this.findBedById(id, tenantId);
    }
    const result = await this.query(tenantId, `UPDATE hostel_beds
       SET is_available = $1, updated_at = now()
       WHERE id = $2 AND tenant_id = $3
       RETURNING *`,
      [data.isAvailable, id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapBed(result.rows[0] as Record<string, unknown>);
  }
}

export function createPgHostelRepository(): PgHostelRepository | null {
  const pool = getSharedHostelPool();
  if (!pool) return null;
  return new PgHostelRepository(pool);
}
