/**
 * Postgres-backed staff leave repository (raw `pg` — no Prisma).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import { InMemoryStaffLeaveRepository } from './in-memory-leave-repository.js';
import type {
  StaffLeaveEntity,
  StaffLeaveRepository,
  StaffLeaveStatus,
  StaffLeaveType,
} from './leave-repository.js';

const { Pool } = pg;

export type PgPoolLike = Pick<pg.Pool, 'query' | 'end'>;

let sharedPool: pg.Pool | null = null;
let schemaReady: Promise<void> | null = null;

function resolveDatabaseUrl(): string | null {
  const url = process.env.DATABASE_URL?.trim();
  return url && url.length > 0 ? url : null;
}

export function isPgStaffLeaveEnabled(): boolean {
  return resolveDatabaseUrl() !== null;
}

export function getSharedStaffLeavePool(): pg.Pool | null {
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
    join(here, '../../../../db/sql/013_hr_leave_schema.sql'),
    join(process.cwd(), 'db/sql/013_hr_leave_schema.sql'),
    join(process.cwd(), '../../db/sql/013_hr_leave_schema.sql'),
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

export async function ensureStaffLeaveSchema(
  pool: PgPoolLike = getSharedStaffLeavePool()!,
): Promise<void> {
  if (!pool) throw new Error('DATABASE_URL is required for staff leave schema ensure');
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = readFileSync(schemaSqlPath(), 'utf8');
      await pool.query(sql);
    })();
  }
  await schemaReady;
}

function toDateStr(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function mapLeave(row: Record<string, unknown>): StaffLeaveEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    staffId: String(row.staff_id),
    leaveType: String(row.leave_type) as StaffLeaveType,
    startDate: toDateStr(row.start_date),
    endDate: toDateStr(row.end_date),
    reason: row.reason == null ? null : String(row.reason),
    status: String(row.status) as StaffLeaveStatus,
    decidedBy: row.decided_by == null ? null : String(row.decided_by),
    decidedAt: row.decided_at == null ? null : new Date(String(row.decided_at)),
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(String(row.updated_at)),
  };
}

export class PgStaffLeaveRepository implements StaffLeaveRepository {
  constructor(private readonly pool: PgPoolLike) {}

  async ensureSchema(): Promise<void> {
    await ensureStaffLeaveSchema(this.pool);
  }

  async createLeave(
    data: Omit<StaffLeaveEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<StaffLeaveEntity> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `INSERT INTO staff_leave_requests (
         id, tenant_id, staff_id, leave_type, start_date, end_date, reason, status, decided_by, decided_at
       ) VALUES ($1,$2,$3,$4,$5::date,$6::date,$7,$8,$9,$10) RETURNING *`,
      [
        data.id,
        data.tenantId,
        data.staffId,
        data.leaveType,
        data.startDate,
        data.endDate,
        data.reason,
        data.status,
        data.decidedBy,
        data.decidedAt,
      ],
    );
    return mapLeave(result.rows[0] as Record<string, unknown>);
  }

  async listLeaves(tenantId: string): Promise<StaffLeaveEntity[]> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `SELECT * FROM staff_leave_requests WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return result.rows.map((row) => mapLeave(row as Record<string, unknown>));
  }

  async findLeaveById(id: string, tenantId: string): Promise<StaffLeaveEntity | null> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `SELECT * FROM staff_leave_requests WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapLeave(result.rows[0] as Record<string, unknown>);
  }

  async updateLeave(
    id: string,
    tenantId: string,
    data: Partial<Pick<StaffLeaveEntity, 'status' | 'decidedBy' | 'decidedAt'>>,
  ): Promise<StaffLeaveEntity | null> {
    await this.ensureSchema();
    const existing = await this.findLeaveById(id, tenantId);
    if (!existing) return null;
    const status = data.status ?? existing.status;
    const decidedBy = data.decidedBy !== undefined ? data.decidedBy : existing.decidedBy;
    const decidedAt = data.decidedAt !== undefined ? data.decidedAt : existing.decidedAt;
    const result = await this.pool.query(
      `UPDATE staff_leave_requests
       SET status = $3, decided_by = $4, decided_at = $5, updated_at = now()
       WHERE id = $1 AND tenant_id = $2
       RETURNING *`,
      [id, tenantId, status, decidedBy, decidedAt],
    );
    if (!result.rows[0]) return null;
    return mapLeave(result.rows[0] as Record<string, unknown>);
  }
}

export function createStaffLeaveRepository(): StaffLeaveRepository {
  const pool = getSharedStaffLeavePool();
  if (pool) {
    return new PgStaffLeaveRepository(pool);
  }
  return new InMemoryStaffLeaveRepository();
}
