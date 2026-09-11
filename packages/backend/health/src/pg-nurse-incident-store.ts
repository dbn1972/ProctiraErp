/**
 * Postgres nurse / clinic visit incidents (Wave 10 Option B).
 * Schema: db/sql/046_health_incidents_etl_schema.sql
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { withPgTenant } from '@proctira/database';

import type { NurseIncidentEntity } from './health-repository.js';
import {
  getSharedCounsellingPool,
  isPgCounsellingEnabled,
  type PgPoolLike,
} from './pg-counselling-store.js';

let schemaReady: Promise<void> | null = null;

export function isPgNurseIncidentEnabled(): boolean {
  return isPgCounsellingEnabled();
}

function schemaSqlPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../../../../db/sql/046_health_incidents_etl_schema.sql'),
    join(process.cwd(), 'db/sql/046_health_incidents_etl_schema.sql'),
    join(process.cwd(), '../../db/sql/046_health_incidents_etl_schema.sql'),
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

export async function ensureNurseIncidentSchema(
  pool: PgPoolLike = getSharedCounsellingPool()!,
): Promise<void> {
  if (!pool) throw new Error('DATABASE_URL is required for nurse incident schema ensure');
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

function mapRow(row: Record<string, unknown>): NurseIncidentEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    studentId: String(row.student_id),
    institutionId: row.institution_id == null ? null : String(row.institution_id),
    incidentAt: toDate(row.incident_at),
    category: String(row.category),
    severity: String(row.severity) as NurseIncidentEntity['severity'],
    notes: String(row.notes ?? ''),
    reportedBy: String(row.reported_by),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

export class PgNurseIncidentStore {
  constructor(private readonly pool: PgPoolLike) {}

  private async ensureSchema(): Promise<void> {
    await ensureNurseIncidentSchema(this.pool);
  }

  private async query(tenantId: string, text: string, params: unknown[] = []) {
    return withPgTenant(this.pool, tenantId, (client) => client.query(text, params));
  }

  async create(
    data: Omit<NurseIncidentEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<NurseIncidentEntity> {
    await this.ensureSchema();
    const now = new Date();
    const result = await this.query(
      data.tenantId,
      `INSERT INTO health_nurse_incidents (
        id, tenant_id, student_id, institution_id, incident_at, category, severity,
        notes, reported_by, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        data.id,
        data.tenantId,
        data.studentId,
        data.institutionId,
        data.incidentAt,
        data.category,
        data.severity,
        data.notes,
        data.reportedBy,
        now,
        now,
      ],
    );
    return mapRow(result.rows[0] as Record<string, unknown>);
  }

  async listByTenant(tenantId: string): Promise<NurseIncidentEntity[]> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM health_nurse_incidents
       WHERE tenant_id=$1 ORDER BY incident_at DESC`,
      [tenantId],
    );
    return result.rows.map((r) => mapRow(r as Record<string, unknown>));
  }

  async listByStudent(tenantId: string, studentId: string): Promise<NurseIncidentEntity[]> {
    await this.ensureSchema();
    const result = await this.query(
      tenantId,
      `SELECT * FROM health_nurse_incidents
       WHERE tenant_id=$1 AND student_id=$2 ORDER BY incident_at DESC`,
      [tenantId, studentId],
    );
    return result.rows.map((r) => mapRow(r as Record<string, unknown>));
  }
}

export function createPgNurseIncidentStore(): PgNurseIncidentStore | null {
  const pool = getSharedCounsellingPool();
  if (!pool) return null;
  return new PgNurseIncidentStore(pool);
}
