/**
 * Postgres-backed communication repository (raw `pg` — no Prisma).
 *
 * When DATABASE_URL is set, campaigns/emergency persist via db/sql/007_communication_schema.sql.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import type {
  CampaignEntity,
  CampaignStatus,
  CommunicationRepository,
  EmergencyBlastEntity,
  EmergencyStatus,
} from './communication-repository.js';

const { Pool } = pg;

export type PgPoolLike = Pick<pg.Pool, 'query' | 'end'>;

let sharedPool: pg.Pool | null = null;
let schemaReady: Promise<void> | null = null;

function resolveDatabaseUrl(): string | null {
  const url = process.env.DATABASE_URL?.trim();
  return url && url.length > 0 ? url : null;
}

export function getSharedCommunicationPool(): pg.Pool | null {
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
    join(here, '../../../../db/sql/007_communication_schema.sql'),
    join(process.cwd(), 'db/sql/007_communication_schema.sql'),
    join(process.cwd(), '../../db/sql/007_communication_schema.sql'),
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

export async function ensureCommunicationSchema(
  pool: PgPoolLike = getSharedCommunicationPool()!,
): Promise<void> {
  if (!pool) throw new Error('DATABASE_URL is required for communication schema ensure');
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

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return [];
}

function asRecord(value: unknown): Record<string, unknown> {
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
      // fall through
    }
  }
  return {};
}

function mapCampaignRow(row: Record<string, unknown>): CampaignEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    name: String(row.name),
    status: String(row.status) as CampaignStatus,
    channels: stringArray(row.channels),
    body: String(row.body ?? ''),
    audienceJson: asRecord(row.audience_json),
    scheduledAt: row.scheduled_at == null ? null : toDate(row.scheduled_at),
    sentAt: row.sent_at == null ? null : toDate(row.sent_at),
    createdBy: row.created_by == null ? null : String(row.created_by),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapEmergencyRow(row: Record<string, unknown>): EmergencyBlastEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    reason: String(row.reason),
    channels: stringArray(row.channels),
    status: String(row.status) as EmergencyStatus,
    confirmActor1: row.confirm_actor_1 == null ? null : String(row.confirm_actor_1),
    confirmActor2: row.confirm_actor_2 == null ? null : String(row.confirm_actor_2),
    confirmedAt: row.confirmed_at == null ? null : toDate(row.confirmed_at),
    createdBy: row.created_by == null ? null : String(row.created_by),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

export class PgCommunicationRepository implements CommunicationRepository {
  constructor(private readonly pool: PgPoolLike) {}

  async ensureSchema(): Promise<void> {
    await ensureCommunicationSchema(this.pool);
  }

  async createCampaign(
    data: Omit<CampaignEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<CampaignEntity> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `INSERT INTO comms_campaigns (
         id, tenant_id, name, status, channels, body, audience_json,
         scheduled_at, sent_at, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)
       RETURNING *`,
      [
        data.id,
        data.tenantId,
        data.name,
        data.status,
        data.channels,
        data.body,
        JSON.stringify(data.audienceJson ?? {}),
        data.scheduledAt,
        data.sentAt,
        data.createdBy,
      ],
    );
    return mapCampaignRow(result.rows[0] as Record<string, unknown>);
  }

  async listCampaigns(tenantId: string): Promise<CampaignEntity[]> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `SELECT * FROM comms_campaigns WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return result.rows.map((row) => mapCampaignRow(row as Record<string, unknown>));
  }

  async findCampaignById(id: string, tenantId: string): Promise<CampaignEntity | null> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `SELECT * FROM comms_campaigns WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapCampaignRow(result.rows[0] as Record<string, unknown>);
  }

  async createEmergencyBlast(
    data: Omit<EmergencyBlastEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<EmergencyBlastEntity> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `INSERT INTO comms_emergency_blasts (
         id, tenant_id, reason, channels, status,
         confirm_actor_1, confirm_actor_2, confirmed_at, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        data.id,
        data.tenantId,
        data.reason,
        data.channels,
        data.status,
        data.confirmActor1,
        data.confirmActor2,
        data.confirmedAt,
        data.createdBy,
      ],
    );
    return mapEmergencyRow(result.rows[0] as Record<string, unknown>);
  }

  async listEmergencyBlasts(tenantId: string): Promise<EmergencyBlastEntity[]> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `SELECT * FROM comms_emergency_blasts WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return result.rows.map((row) => mapEmergencyRow(row as Record<string, unknown>));
  }

  async findEmergencyBlastById(id: string, tenantId: string): Promise<EmergencyBlastEntity | null> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `SELECT * FROM comms_emergency_blasts WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapEmergencyRow(result.rows[0] as Record<string, unknown>);
  }

  async updateEmergencyBlast(
    id: string,
    tenantId: string,
    data: Partial<
      Pick<EmergencyBlastEntity, 'confirmActor1' | 'confirmActor2' | 'confirmedAt' | 'status'>
    >,
  ): Promise<EmergencyBlastEntity | null> {
    await this.ensureSchema();
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (data.confirmActor1 !== undefined) {
      sets.push(`confirm_actor_1 = $${i++}`);
      values.push(data.confirmActor1);
    }
    if (data.confirmActor2 !== undefined) {
      sets.push(`confirm_actor_2 = $${i++}`);
      values.push(data.confirmActor2);
    }
    if (data.confirmedAt !== undefined) {
      sets.push(`confirmed_at = $${i++}`);
      values.push(data.confirmedAt);
    }
    if (data.status !== undefined) {
      sets.push(`status = $${i++}`);
      values.push(data.status);
    }

    if (sets.length === 0) {
      return this.findEmergencyBlastById(id, tenantId);
    }

    sets.push(`updated_at = now()`);
    values.push(id, tenantId);

    const result = await this.pool.query(
      `UPDATE comms_emergency_blasts
       SET ${sets.join(', ')}
       WHERE id = $${i++} AND tenant_id = $${i}
       RETURNING *`,
      values,
    );
    if (!result.rows[0]) return null;
    return mapEmergencyRow(result.rows[0] as Record<string, unknown>);
  }
}

export function createPgCommunicationRepository(): PgCommunicationRepository | null {
  const pool = getSharedCommunicationPool();
  if (!pool) return null;
  return new PgCommunicationRepository(pool);
}
