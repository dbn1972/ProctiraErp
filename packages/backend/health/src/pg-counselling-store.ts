/**
 * Postgres-backed counselling session store (raw `pg` — no Prisma).
 *
 * When DATABASE_URL is set the health repository overlay persists counselling
 * creates/updates/lists here so UI aggregates and domain POST stay in sync
 * across process restarts.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { withPgTenant } from '@proctira/database';
import pg from 'pg';

import type { CounsellingSessionEntity } from './health-repository.js';
import { decryptPhi, encryptPhi } from './phi-crypto.js';

const { Pool } = pg;

export type PgPoolLike = Pick<pg.Pool, 'query' | 'end'> & Partial<Pick<pg.Pool, 'connect'>>;

let sharedPool: pg.Pool | null = null;
let schemaReady: Promise<void> | null = null;

function resolveDatabaseUrl(): string | null {
  const url = process.env.DATABASE_URL?.trim();
  return url && url.length > 0 ? url : null;
}

export function isPgCounsellingEnabled(): boolean {
  return resolveDatabaseUrl() !== null;
}

export function getSharedCounsellingPool(): pg.Pool | null {
  const url = resolveDatabaseUrl();
  if (!url) return null;
  if (!sharedPool) {
    sharedPool = new Pool({ connectionString: url });
  }
  return sharedPool;
}

function schemaSqlPath(): string {
  // Prefer repo-root SQL when running from monorepo; fall back to packaged copy.
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../../../../db/sql/002_health_counselling_schema.sql'),
    join(process.cwd(), 'db/sql/002_health_counselling_schema.sql'),
    join(process.cwd(), '../../db/sql/002_health_counselling_schema.sql'),
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

export async function ensureCounsellingSchema(pool: PgPoolLike = getSharedCounsellingPool()!): Promise<void> {
  if (!pool) throw new Error('DATABASE_URL is required for counselling schema ensure');
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = readFileSync(schemaSqlPath(), 'utf8');
      await pool.query(sql);
    })();
  }
  await schemaReady;
}

function mapRow(row: Record<string, unknown>): CounsellingSessionEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    studentId: String(row.student_id),
    counsellorId: String(row.counsellor_id),
    sessionDate:
      row.session_date instanceof Date
        ? row.session_date.toISOString().slice(0, 10)
        : String(row.session_date).slice(0, 10),
    sessionType: String(row.session_type),
    reason: decryptPhi(String(row.reason)) ?? '',
    caseNotes: decryptPhi(String(row.case_notes)) ?? '',
    outcome: decryptPhi(row.outcome == null ? null : String(row.outcome)),
    followUpRequired: Boolean(row.follow_up_required),
    followUpDate:
      row.follow_up_date == null
        ? null
        : row.follow_up_date instanceof Date
          ? row.follow_up_date.toISOString().slice(0, 10)
          : String(row.follow_up_date).slice(0, 10),
    status: String(row.status),
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(String(row.updated_at)),
  };
}

export class PgCounsellingStore {
  constructor(private readonly pool: PgPoolLike) {}

  /** G-710: every query runs with the tenant GUC bound so RLS applies. */
  private query(tenantId: string, text: string, values?: unknown[]): Promise<pg.QueryResult> {
    return withPgTenant(this.pool, tenantId, (client) =>
      client.query(text, values) as unknown as Promise<pg.QueryResult>,
    );
  }

  async ensureSchema(): Promise<void> {
    await ensureCounsellingSchema(this.pool);
  }

  async create(
    data: Omit<CounsellingSessionEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<CounsellingSessionEntity> {
    await this.ensureSchema();
    const now = new Date();
    const result = await this.query(data.tenantId, `INSERT INTO counselling_sessions (
        id, tenant_id, student_id, counsellor_id, session_date, session_type,
        reason, case_notes, outcome, follow_up_required, follow_up_date, status,
        created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10,$11::date,$12,$13,$14
      )
      RETURNING *`,
      [
        data.id,
        data.tenantId,
        data.studentId,
        data.counsellorId,
        data.sessionDate,
        data.sessionType,
        encryptPhi(data.reason),
        encryptPhi(data.caseNotes),
        encryptPhi(data.outcome),
        data.followUpRequired,
        data.followUpDate,
        data.status,
        now,
        now,
      ],
    );
    return mapRow(result.rows[0] as Record<string, unknown>);
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<CounsellingSessionEntity>,
  ): Promise<CounsellingSessionEntity | null> {
    await this.ensureSchema();
    const existing = await this.findById(id, tenantId);
    if (!existing) return null;
    const merged: CounsellingSessionEntity = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      studentId: existing.studentId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    const result = await this.query(tenantId, `UPDATE counselling_sessions SET
        counsellor_id = $3,
        session_date = $4::date,
        session_type = $5,
        reason = $6,
        case_notes = $7,
        outcome = $8,
        follow_up_required = $9,
        follow_up_date = $10::date,
        status = $11,
        updated_at = $12
      WHERE id = $1 AND tenant_id = $2
      RETURNING *`,
      [
        id,
        tenantId,
        merged.counsellorId,
        merged.sessionDate,
        merged.sessionType,
        encryptPhi(merged.reason),
        encryptPhi(merged.caseNotes),
        encryptPhi(merged.outcome),
        merged.followUpRequired,
        merged.followUpDate,
        merged.status,
        merged.updatedAt,
      ],
    );
    if (!result.rows[0]) return null;
    return mapRow(result.rows[0] as Record<string, unknown>);
  }

  async findById(id: string, tenantId: string): Promise<CounsellingSessionEntity | null> {
    await this.ensureSchema();
    const result = await this.query(tenantId, `SELECT * FROM counselling_sessions WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [id, tenantId],
    );
    if (!result.rows[0]) return null;
    return mapRow(result.rows[0] as Record<string, unknown>);
  }

  async listByStudent(tenantId: string, studentId: string): Promise<CounsellingSessionEntity[]> {
    await this.ensureSchema();
    const result = await this.query(tenantId, `SELECT * FROM counselling_sessions
       WHERE tenant_id = $1 AND student_id = $2
       ORDER BY session_date DESC`,
      [tenantId, studentId],
    );
    return (result.rows as Record<string, unknown>[]).map(mapRow);
  }

  async listByTenant(tenantId: string): Promise<CounsellingSessionEntity[]> {
    await this.ensureSchema();
    const result = await this.query(tenantId, `SELECT * FROM counselling_sessions
       WHERE tenant_id = $1
       ORDER BY session_date DESC`,
      [tenantId],
    );
    return (result.rows as Record<string, unknown>[]).map(mapRow);
  }
}

export function createPgCounsellingStore(): PgCounsellingStore | null {
  const pool = getSharedCounsellingPool();
  if (!pool) return null;
  return new PgCounsellingStore(pool);
}
