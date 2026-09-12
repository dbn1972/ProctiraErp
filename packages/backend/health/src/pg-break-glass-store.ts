/**
 * Postgres store for health-local PHI break-glass grants (P0-09).
 * Dual-control: requester ≠ approver; TTL enforced via expires_at.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { withPgTenant, type PgQueryable } from '@proctira/database';

import {
  getSharedCounsellingPool,
  isPgCounsellingEnabled,
  type PgPoolLike,
} from './pg-counselling-store.js';
import {
  isHealthPhiFieldPath,
  type CreateHealthBreakGlassInput,
  type HealthBreakGlassGrant,
  type HealthPhiFieldPath,
} from './phi-field-acl.js';

let schemaReady: Promise<void> | null = null;

export function isPgBreakGlassEnabled(): boolean {
  return isPgCounsellingEnabled();
}

function schemaSqlPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../../../../db/sql/049_health_phi_breakglass_schema.sql'),
    join(process.cwd(), 'db/sql/049_health_phi_breakglass_schema.sql'),
    join(process.cwd(), '../../db/sql/049_health_phi_breakglass_schema.sql'),
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

export async function ensureBreakGlassSchema(
  pool: PgPoolLike = getSharedCounsellingPool()!,
): Promise<void> {
  if (!pool) throw new Error('DATABASE_URL is required for health break-glass schema ensure');
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = readFileSync(schemaSqlPath(), 'utf8');
      await pool.query(sql);
    })();
  }
  await schemaReady;
}

function mapRow(row: Record<string, unknown>): HealthBreakGlassGrant {
  const fieldPathRaw = String(row.field_path);
  if (!isHealthPhiFieldPath(fieldPathRaw)) {
    throw new Error(`Unknown health PHI field_path: ${fieldPathRaw}`);
  }
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    requesterUserId: String(row.requester_user_id),
    approverUserId: row.approver_user_id == null ? null : String(row.approver_user_id),
    studentId: String(row.student_id),
    fieldPath: fieldPathRaw,
    justification: String(row.justification),
    status: String(row.status) as HealthBreakGlassGrant['status'],
    durationMinutes: Number(row.duration_minutes),
    approvedAt:
      row.approved_at == null
        ? null
        : row.approved_at instanceof Date
          ? row.approved_at.toISOString()
          : String(row.approved_at),
    expiresAt:
      row.expires_at == null
        ? null
        : row.expires_at instanceof Date
          ? row.expires_at.toISOString()
          : String(row.expires_at),
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

export type CreateBreakGlassInput = CreateHealthBreakGlassInput;

export class PgBreakGlassStore {
  constructor(private readonly pool: PgPoolLike) {}

  private withTenant<T>(tenantId: string, fn: (client: PgQueryable) => Promise<T>): Promise<T> {
    return withPgTenant(this.pool, tenantId, fn);
  }

  async ensureSchema(): Promise<void> {
    await ensureBreakGlassSchema(this.pool);
  }

  async create(input: CreateBreakGlassInput): Promise<HealthBreakGlassGrant> {
    await this.ensureSchema();
    const id = randomUUID();
    return this.withTenant(input.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO health_phi_break_glass
           (id, tenant_id, requester_user_id, approver_user_id, student_id, field_path,
            justification, status, duration_minutes, approved_at, expires_at, created_at, updated_at)
         VALUES ($1,$2,$3,NULL,$4,$5,$6,'pending',$7,NULL,NULL,NOW(),NOW())
         RETURNING *`,
        [
          id,
          input.tenantId,
          input.requesterUserId,
          input.studentId,
          input.fieldPath,
          input.justification,
          input.durationMinutes,
        ],
      );
      return mapRow(result.rows[0] as Record<string, unknown>);
    });
  }

  async findById(id: string, tenantId: string): Promise<HealthBreakGlassGrant | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM health_phi_break_glass WHERE id=$1 AND tenant_id=$2`,
        [id, tenantId],
      );
      if (result.rows.length === 0) return null;
      return mapRow(result.rows[0] as Record<string, unknown>);
    });
  }

  async findActiveGrant(
    tenantId: string,
    requesterUserId: string,
    studentId: string,
    fieldPath: HealthPhiFieldPath,
    now: Date = new Date(),
  ): Promise<HealthBreakGlassGrant | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      await client.query(
        `UPDATE health_phi_break_glass
         SET status='expired', updated_at=NOW()
         WHERE tenant_id=$1 AND status='approved' AND expires_at IS NOT NULL AND expires_at <= $2`,
        [tenantId, now.toISOString()],
      );
      const result = await client.query(
        `SELECT * FROM health_phi_break_glass
         WHERE tenant_id=$1
           AND requester_user_id=$2
           AND student_id=$3
           AND field_path=$4
           AND status='approved'
           AND expires_at > $5
         ORDER BY expires_at DESC
         LIMIT 1`,
        [tenantId, requesterUserId, studentId, fieldPath, now.toISOString()],
      );
      if (result.rows.length === 0) return null;
      return mapRow(result.rows[0] as Record<string, unknown>);
    });
  }

  async approve(
    id: string,
    tenantId: string,
    approverUserId: string,
  ): Promise<HealthBreakGlassGrant | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const existing = await client.query(
        `SELECT * FROM health_phi_break_glass WHERE id=$1 AND tenant_id=$2`,
        [id, tenantId],
      );
      if (existing.rows.length === 0) return null;
      const row = mapRow(existing.rows[0] as Record<string, unknown>);
      if (row.status !== 'pending') return row;
      if (row.requesterUserId === approverUserId) {
        throw new Error('DUAL_CONTROL_VIOLATION');
      }
      const approvedAt = new Date();
      const expiresAt = new Date(approvedAt.getTime() + row.durationMinutes * 60_000);
      const result = await client.query(
        `UPDATE health_phi_break_glass
         SET status='approved',
             approver_user_id=$3,
             approved_at=$4,
             expires_at=$5,
             updated_at=NOW()
         WHERE id=$1 AND tenant_id=$2 AND status='pending'
         RETURNING *`,
        [id, tenantId, approverUserId, approvedAt.toISOString(), expiresAt.toISOString()],
      );
      if (result.rows.length === 0) return null;
      return mapRow(result.rows[0] as Record<string, unknown>);
    });
  }

  async deny(
    id: string,
    tenantId: string,
    approverUserId: string,
  ): Promise<HealthBreakGlassGrant | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const existing = await client.query(
        `SELECT * FROM health_phi_break_glass WHERE id=$1 AND tenant_id=$2`,
        [id, tenantId],
      );
      if (existing.rows.length === 0) return null;
      const row = mapRow(existing.rows[0] as Record<string, unknown>);
      if (row.status !== 'pending') return row;
      if (row.requesterUserId === approverUserId) {
        throw new Error('DUAL_CONTROL_VIOLATION');
      }
      const result = await client.query(
        `UPDATE health_phi_break_glass
         SET status='denied',
             approver_user_id=$3,
             updated_at=NOW()
         WHERE id=$1 AND tenant_id=$2 AND status='pending'
         RETURNING *`,
        [id, tenantId, approverUserId],
      );
      if (result.rows.length === 0) return null;
      return mapRow(result.rows[0] as Record<string, unknown>);
    });
  }

  async list(
    tenantId: string,
    options: { studentId?: string; limit?: number } = {},
  ): Promise<HealthBreakGlassGrant[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
      const result = options.studentId
        ? await client.query(
            `SELECT * FROM health_phi_break_glass
             WHERE tenant_id=$1 AND student_id=$2
             ORDER BY created_at DESC LIMIT $3`,
            [tenantId, options.studentId, limit],
          )
        : await client.query(
            `SELECT * FROM health_phi_break_glass
             WHERE tenant_id=$1
             ORDER BY created_at DESC LIMIT $2`,
            [tenantId, limit],
          );
      return result.rows.map((r) => mapRow(r as Record<string, unknown>));
    });
  }
}

export function createPgBreakGlassStore(
  pool: PgPoolLike | null = getSharedCounsellingPool(),
): PgBreakGlassStore | null {
  if (!pool || !isPgBreakGlassEnabled()) return null;
  return new PgBreakGlassStore(pool);
}
