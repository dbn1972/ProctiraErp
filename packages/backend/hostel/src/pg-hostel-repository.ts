/**
 * Postgres-backed hostel repository (raw `pg` — no Prisma).
 *
 * When DATABASE_URL is set, occupancy persists via db/sql/008_hostel_schema.sql.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { withPgTenant, type PgQueryable } from '@proctira/database';
import pg from 'pg';

import {
  BedAssignmentConflictError,
  type GatePassEntity,
  type GatePassRequestedBy,
  type GatePassStatus,
  type HostelAssignmentEntity,
  type HostelAttendanceEntity,
  type HostelAttendanceStatus,
  type HostelBedEntity,
  type HostelBlockEntity,
  type HostelEntity,
  type HostelFeeStructureEntity,
  type HostelLeaveEntity,
  type HostelRepository,
  type HostelRoomEntity,
  type HostelStatus,
  type HostelVisitorEntity,
  type LeaveStatus,
  type MessMeal,
  type MessPlanEntity,
  type MessPlanStatus,
  type MessMenuItemEntity,
  type MessSubscriptionEntity,
  type MessSubscriptionStatus,
  type NewGatePass,
  type NewHostelAttendance,
  type NewHostelFeeStructure,
  type NewMessMenuItem,
  type NewMessPlan,
  type NewMessSubscription,
  type VisitorStatus,
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

function resolveSqlFile(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, `../../../../db/sql/${name}`),
    join(process.cwd(), `db/sql/${name}`),
    join(process.cwd(), `../../db/sql/${name}`),
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
      await pool.query(readFileSync(resolveSqlFile('008_hostel_schema.sql'), 'utf8'));
      await pool.query(readFileSync(resolveSqlFile('040_hostel_ops_schema.sql'), 'utf8'));
      // P2-HOSTEL: unique active bed / student (partial indexes — package-owned guard).
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_hostel_assignments_active_bed
          ON hostel_assignments (tenant_id, bed_id)
          WHERE is_active;
        CREATE UNIQUE INDEX IF NOT EXISTS uq_hostel_assignments_active_student
          ON hostel_assignments (tenant_id, student_id)
          WHERE is_active;
      `);
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

function mapMessPlan(row: Record<string, unknown>): MessPlanEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    hostelId: String(row.hostel_id),
    name: String(row.name),
    mealCount: Number(row.meal_count),
    status: String(row.status) as MessPlanStatus,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapMessMenu(row: Record<string, unknown>): MessMenuItemEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    planId: String(row.plan_id),
    weekday: Number(row.weekday),
    meal: String(row.meal) as MessMeal,
    itemName: String(row.item_name),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapMessSub(row: Record<string, unknown>): MessSubscriptionEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    planId: String(row.plan_id),
    studentId: String(row.student_id),
    startDate: dateOnly(row.start_date),
    endDate: dateOnlyOrNull(row.end_date),
    status: String(row.status) as MessSubscriptionStatus,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapGatePass(row: Record<string, unknown>): GatePassEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    hostelId: String(row.hostel_id),
    studentId: String(row.student_id),
    requestedBy: String(row.requested_by) as GatePassRequestedBy,
    requesterUserId: row.requester_user_id == null ? null : String(row.requester_user_id),
    reason: row.reason == null ? null : String(row.reason),
    expectedOutAt: toDate(row.expected_out_at),
    expectedInAt: toDate(row.expected_in_at),
    status: String(row.status) as GatePassStatus,
    decidedBy: row.decided_by == null ? null : String(row.decided_by),
    outAt: row.out_at == null ? null : toDate(row.out_at),
    inAt: row.in_at == null ? null : toDate(row.in_at),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapFeeStructure(row: Record<string, unknown>): HostelFeeStructureEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    hostelId: String(row.hostel_id),
    roomType: String(row.room_type),
    termLabel: String(row.term_label),
    amountCents: Number(row.amount_cents),
    currency: String(row.currency),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapAttendance(row: Record<string, unknown>): HostelAttendanceEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    blockId: String(row.block_id),
    studentId: String(row.student_id),
    onDate: dateOnly(row.on_date),
    status: String(row.status) as HostelAttendanceStatus,
    reason: row.reason == null ? null : String(row.reason),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

export class PgHostelRepository implements HostelRepository {
  constructor(private readonly pool: PgPoolLike) {}

  /** G-710: every query runs with the tenant GUC bound so RLS applies. */
  private withTenant<T>(tenantId: string, fn: (client: PgQueryable) => Promise<T>): Promise<T> {
    return withPgTenant(this.pool, tenantId, fn);
  }

  private query(tenantId: string, text: string, values?: unknown[]): Promise<pg.QueryResult> {
    return this.withTenant(
      tenantId,
      (client) => client.query(text, values) as unknown as Promise<pg.QueryResult>,
    );
  }

  async ensureSchema(): Promise<void> {
    await ensureHostelSchema(this.pool);
  }

  async createHostel(data: Omit<HostelEntity, 'createdAt' | 'updatedAt'>): Promise<HostelEntity> {
    await this.ensureSchema();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO hostels (id, tenant_id, name, code, address, capacity, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [data.id, data.tenantId, data.name, data.code, data.address, data.capacity, data.status],
    );
    return mapHostel(result.rows[0] as Record<string, unknown>);
  }

  async listHostels(tenantId: string): Promise<HostelEntity[]> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM hostels WHERE tenant_id = $1 ORDER BY name`,
      [tenantId],
    );
    return result.rows.map((row) => mapHostel(row as Record<string, unknown>));
  }

  async findHostelById(id: string, tenantId: string): Promise<HostelEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM hostels WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapHostel(result.rows[0] as Record<string, unknown>);
  }

  async createAssignment(
    data: Omit<HostelAssignmentEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<HostelAssignmentEntity> {
    await this.ensureSchema();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO hostel_assignments
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

  async createActiveAssignment(
    data: Omit<HostelAssignmentEntity, 'createdAt' | 'updatedAt'> & { isActive: true },
  ): Promise<HostelAssignmentEntity> {
    await this.ensureSchema();
    try {
      return await this.withTenant(data.tenantId, async (client) => {
        // Lock the bed row so concurrent active claims serialize.
        const bedResult = await client.query(
          `SELECT * FROM hostel_beds WHERE id = $1 AND tenant_id = $2 LIMIT 1 FOR UPDATE`,
          [data.bedId, data.tenantId],
        );
        const bedRow = bedResult.rows[0] as Record<string, unknown> | undefined;
        if (!bedRow) {
          throw new BedAssignmentConflictError('BED_UNAVAILABLE', 'Bed not found for assignment');
        }
        if (!bedRow.is_available) {
          throw new BedAssignmentConflictError(
            'BED_UNAVAILABLE',
            'Bed is not available for assignment',
          );
        }

        const studentBusy = await client.query(
          `SELECT 1 FROM hostel_assignments
           WHERE tenant_id = $1 AND student_id = $2 AND is_active
           LIMIT 1`,
          [data.tenantId, data.studentId],
        );
        if (studentBusy.rows.length > 0) {
          throw new BedAssignmentConflictError(
            'STUDENT_ALREADY_ASSIGNED',
            'Student already has an active bed assignment',
          );
        }

        const insert = await client.query(
          `INSERT INTO hostel_assignments
             (id, tenant_id, student_id, bed_id, start_date, end_date, is_active)
           VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING *`,
          [data.id, data.tenantId, data.studentId, data.bedId, data.startDate, data.endDate],
        );
        await client.query(
          `UPDATE hostel_beds
           SET is_available = false, updated_at = now()
           WHERE id = $1 AND tenant_id = $2`,
          [data.bedId, data.tenantId],
        );
        return mapAssignment(insert.rows[0] as Record<string, unknown>);
      });
    } catch (err) {
      if (err instanceof BedAssignmentConflictError) throw err;
      const pgErr = err as { code?: string; constraint?: string };
      if (pgErr.code === '23505') {
        if (String(pgErr.constraint ?? '').includes('active_student')) {
          throw new BedAssignmentConflictError(
            'STUDENT_ALREADY_ASSIGNED',
            'Student already has an active bed assignment',
          );
        }
        throw new BedAssignmentConflictError(
          'BED_UNAVAILABLE',
          'Bed is not available for assignment',
        );
      }
      throw err;
    }
  }

  async listAssignments(tenantId: string): Promise<HostelAssignmentEntity[]> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM hostel_assignments WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return result.rows.map((row) => mapAssignment(row as Record<string, unknown>));
  }

  async createLeave(
    data: Omit<HostelLeaveEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<HostelLeaveEntity> {
    await this.ensureSchema();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO hostel_leaves
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
    const result = await this.query(
      tenantId,
      `SELECT * FROM hostel_leaves WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return result.rows.map((row) => mapLeave(row as Record<string, unknown>));
  }

  async findLeaveById(id: string, tenantId: string): Promise<HostelLeaveEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM hostel_leaves WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
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
    const result = await this.query(
      tenantId,
      `UPDATE hostel_leaves
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
    const result = await this.query(
      data.tenantId,
      `INSERT INTO hostel_visitors
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
    const result = await this.query(
      tenantId,
      `SELECT * FROM hostel_visitors WHERE tenant_id = $1 ORDER BY visit_date DESC`,
      [tenantId],
    );
    return result.rows.map((row) => mapVisitor(row as Record<string, unknown>));
  }

  async findVisitorById(id: string, tenantId: string): Promise<HostelVisitorEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM hostel_visitors WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
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
    const result = await this.query(
      tenantId,
      `UPDATE hostel_visitors
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
    const result = await this.query(
      data.tenantId,
      `INSERT INTO hostel_blocks (id, tenant_id, hostel_id, name, floor)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [data.id, data.tenantId, data.hostelId, data.name, data.floor],
    );
    return mapBlock(result.rows[0] as Record<string, unknown>);
  }

  async listBlocks(tenantId: string, hostelId?: string): Promise<HostelBlockEntity[]> {
    await this.ensureSchema();
    if (hostelId) {
      const result = await this.query(
        tenantId,
        `SELECT * FROM hostel_blocks WHERE tenant_id = $1 AND hostel_id = $2 ORDER BY floor, name`,
        [tenantId, hostelId],
      );
      return result.rows.map((row) => mapBlock(row as Record<string, unknown>));
    }
    const result = await this.query(
      tenantId,
      `SELECT * FROM hostel_blocks WHERE tenant_id = $1 ORDER BY floor, name`,
      [tenantId],
    );
    return result.rows.map((row) => mapBlock(row as Record<string, unknown>));
  }

  async createRoom(
    data: Omit<HostelRoomEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<HostelRoomEntity> {
    await this.ensureSchema();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO hostel_rooms (id, tenant_id, block_id, room_number, capacity)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [data.id, data.tenantId, data.blockId, data.roomNumber, data.capacity],
    );
    return mapRoom(result.rows[0] as Record<string, unknown>);
  }

  async listRooms(tenantId: string, blockId?: string): Promise<HostelRoomEntity[]> {
    await this.ensureSchema();
    if (blockId) {
      const result = await this.query(
        tenantId,
        `SELECT * FROM hostel_rooms WHERE tenant_id = $1 AND block_id = $2 ORDER BY room_number`,
        [tenantId, blockId],
      );
      return result.rows.map((row) => mapRoom(row as Record<string, unknown>));
    }
    const result = await this.query(
      tenantId,
      `SELECT * FROM hostel_rooms WHERE tenant_id = $1 ORDER BY room_number`,
      [tenantId],
    );
    return result.rows.map((row) => mapRoom(row as Record<string, unknown>));
  }

  async createBed(
    data: Omit<HostelBedEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<HostelBedEntity> {
    await this.ensureSchema();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO hostel_beds (id, tenant_id, room_id, bed_label, is_available)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [data.id, data.tenantId, data.roomId, data.bedLabel, data.isAvailable],
    );
    return mapBed(result.rows[0] as Record<string, unknown>);
  }

  async listBeds(tenantId: string, roomId?: string): Promise<HostelBedEntity[]> {
    await this.ensureSchema();
    if (roomId) {
      const result = await this.query(
        tenantId,
        `SELECT * FROM hostel_beds WHERE tenant_id = $1 AND room_id = $2 ORDER BY bed_label`,
        [tenantId, roomId],
      );
      return result.rows.map((row) => mapBed(row as Record<string, unknown>));
    }
    const result = await this.query(
      tenantId,
      `SELECT * FROM hostel_beds WHERE tenant_id = $1 ORDER BY bed_label`,
      [tenantId],
    );
    return result.rows.map((row) => mapBed(row as Record<string, unknown>));
  }

  async findBedById(id: string, tenantId: string): Promise<HostelBedEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM hostel_beds WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
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
    const result = await this.query(
      tenantId,
      `UPDATE hostel_beds
       SET is_available = $1, updated_at = now()
       WHERE id = $2 AND tenant_id = $3
       RETURNING *`,
      [data.isAvailable, id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapBed(result.rows[0] as Record<string, unknown>);
  }

  async createMessPlan(data: NewMessPlan): Promise<MessPlanEntity> {
    await this.ensureSchema();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO mess_plans (id, tenant_id, hostel_id, name, meal_count, status)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [data.id, data.tenantId, data.hostelId, data.name, data.mealCount, data.status],
    );
    return mapMessPlan(result.rows[0] as Record<string, unknown>);
  }

  async listMessPlans(tenantId: string, hostelId?: string): Promise<MessPlanEntity[]> {
    await this.ensureSchema();
    if (hostelId) {
      const result = await this.query(
        tenantId,
        `SELECT * FROM mess_plans WHERE tenant_id = $1 AND hostel_id = $2 ORDER BY name`,
        [tenantId, hostelId],
      );
      return result.rows.map((row) => mapMessPlan(row as Record<string, unknown>));
    }
    const result = await this.query(
      tenantId,
      `SELECT * FROM mess_plans WHERE tenant_id = $1 ORDER BY name`,
      [tenantId],
    );
    return result.rows.map((row) => mapMessPlan(row as Record<string, unknown>));
  }

  async findMessPlanById(id: string, tenantId: string): Promise<MessPlanEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM mess_plans WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapMessPlan(result.rows[0] as Record<string, unknown>);
  }

  async createMessMenuItem(data: NewMessMenuItem): Promise<MessMenuItemEntity> {
    await this.ensureSchema();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO mess_menu_items (id, tenant_id, plan_id, weekday, meal, item_name)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [data.id, data.tenantId, data.planId, data.weekday, data.meal, data.itemName],
    );
    return mapMessMenu(result.rows[0] as Record<string, unknown>);
  }

  async listMessMenuItems(tenantId: string, planId: string): Promise<MessMenuItemEntity[]> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM mess_menu_items WHERE tenant_id = $1 AND plan_id = $2
       ORDER BY weekday, meal`,
      [tenantId, planId],
    );
    return result.rows.map((row) => mapMessMenu(row as Record<string, unknown>));
  }

  async createMessSubscription(data: NewMessSubscription): Promise<MessSubscriptionEntity> {
    await this.ensureSchema();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO mess_subscriptions
         (id, tenant_id, plan_id, student_id, start_date, end_date, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        data.id,
        data.tenantId,
        data.planId,
        data.studentId,
        data.startDate,
        data.endDate,
        data.status,
      ],
    );
    return mapMessSub(result.rows[0] as Record<string, unknown>);
  }

  async listMessSubscriptions(
    tenantId: string,
    planId?: string,
  ): Promise<MessSubscriptionEntity[]> {
    await this.ensureSchema();
    if (planId) {
      const result = await this.query(
        tenantId,
        `SELECT * FROM mess_subscriptions WHERE tenant_id = $1 AND plan_id = $2
         ORDER BY created_at DESC`,
        [tenantId, planId],
      );
      return result.rows.map((row) => mapMessSub(row as Record<string, unknown>));
    }
    const result = await this.query(
      tenantId,
      `SELECT * FROM mess_subscriptions WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return result.rows.map((row) => mapMessSub(row as Record<string, unknown>));
  }

  async createGatePass(data: NewGatePass): Promise<GatePassEntity> {
    await this.ensureSchema();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO gate_passes (
         id, tenant_id, hostel_id, student_id, requested_by, requester_user_id,
         reason, expected_out_at, expected_in_at, status, decided_by, out_at, in_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        data.id,
        data.tenantId,
        data.hostelId,
        data.studentId,
        data.requestedBy,
        data.requesterUserId,
        data.reason,
        data.expectedOutAt,
        data.expectedInAt,
        data.status,
        data.decidedBy,
        data.outAt,
        data.inAt,
      ],
    );
    return mapGatePass(result.rows[0] as Record<string, unknown>);
  }

  async listGatePasses(tenantId: string, hostelId?: string): Promise<GatePassEntity[]> {
    await this.ensureSchema();
    if (hostelId) {
      const result = await this.query(
        tenantId,
        `SELECT * FROM gate_passes WHERE tenant_id = $1 AND hostel_id = $2
         ORDER BY created_at DESC`,
        [tenantId, hostelId],
      );
      return result.rows.map((row) => mapGatePass(row as Record<string, unknown>));
    }
    const result = await this.query(
      tenantId,
      `SELECT * FROM gate_passes WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return result.rows.map((row) => mapGatePass(row as Record<string, unknown>));
  }

  async findGatePassById(id: string, tenantId: string): Promise<GatePassEntity | null> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM gate_passes WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapGatePass(result.rows[0] as Record<string, unknown>);
  }

  async updateGatePass(
    id: string,
    tenantId: string,
    data: Partial<Pick<GatePassEntity, 'status' | 'decidedBy' | 'outAt' | 'inAt'>>,
  ): Promise<GatePassEntity | null> {
    await this.ensureSchema();
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (data.status !== undefined) {
      sets.push(`status = $${i++}`);
      values.push(data.status);
    }
    if (data.decidedBy !== undefined) {
      sets.push(`decided_by = $${i++}`);
      values.push(data.decidedBy);
    }
    if (data.outAt !== undefined) {
      sets.push(`out_at = $${i++}`);
      values.push(data.outAt);
    }
    if (data.inAt !== undefined) {
      sets.push(`in_at = $${i++}`);
      values.push(data.inAt);
    }
    if (sets.length === 0) return this.findGatePassById(id, tenantId);
    sets.push(`updated_at = now()`);
    values.push(id, tenantId);
    const result = await this.query(
      tenantId,
      `UPDATE gate_passes SET ${sets.join(', ')}
       WHERE id = $${i++} AND tenant_id = $${i} RETURNING *`,
      values,
    );
    if (!result.rows[0]) return null;
    return mapGatePass(result.rows[0] as Record<string, unknown>);
  }

  async createFeeStructure(data: NewHostelFeeStructure): Promise<HostelFeeStructureEntity> {
    await this.ensureSchema();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO hostel_fee_structures
         (id, tenant_id, hostel_id, room_type, term_label, amount_cents, currency)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        data.id,
        data.tenantId,
        data.hostelId,
        data.roomType,
        data.termLabel,
        data.amountCents,
        data.currency,
      ],
    );
    return mapFeeStructure(result.rows[0] as Record<string, unknown>);
  }

  async listFeeStructures(
    tenantId: string,
    hostelId?: string,
  ): Promise<HostelFeeStructureEntity[]> {
    await this.ensureSchema();
    if (hostelId) {
      const result = await this.query(
        tenantId,
        `SELECT * FROM hostel_fee_structures WHERE tenant_id = $1 AND hostel_id = $2
         ORDER BY room_type, term_label`,
        [tenantId, hostelId],
      );
      return result.rows.map((row) => mapFeeStructure(row as Record<string, unknown>));
    }
    const result = await this.query(
      tenantId,
      `SELECT * FROM hostel_fee_structures WHERE tenant_id = $1 ORDER BY room_type`,
      [tenantId],
    );
    return result.rows.map((row) => mapFeeStructure(row as Record<string, unknown>));
  }

  async upsertAttendance(data: NewHostelAttendance): Promise<HostelAttendanceEntity> {
    await this.ensureSchema();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO hostel_attendance
         (id, tenant_id, block_id, student_id, on_date, status, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (tenant_id, block_id, student_id, on_date) DO UPDATE
         SET status = EXCLUDED.status,
             reason = EXCLUDED.reason,
             updated_at = now()
       RETURNING *`,
      [data.id, data.tenantId, data.blockId, data.studentId, data.onDate, data.status, data.reason],
    );
    return mapAttendance(result.rows[0] as Record<string, unknown>);
  }

  async listAttendance(
    tenantId: string,
    blockId: string,
    onDate: string,
  ): Promise<HostelAttendanceEntity[]> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM hostel_attendance
       WHERE tenant_id = $1 AND block_id = $2 AND on_date = $3
       ORDER BY student_id`,
      [tenantId, blockId, onDate],
    );
    return result.rows.map((row) => mapAttendance(row as Record<string, unknown>));
  }
}

export function createPgHostelRepository(): PgHostelRepository | null {
  const pool = getSharedHostelPool();
  if (!pool) return null;
  return new PgHostelRepository(pool);
}
