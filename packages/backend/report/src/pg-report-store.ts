import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getSharedPgPool,
  withPgTenant,
  withPlatformScope,
  type PgQueryable,
} from '@proctira/database';

import type { CatalogueReportFormat, CatalogueReportKey } from './catalogue.js';
import type {
  ReportArtifactRecord,
  ReportRunRecord,
  ReportScheduleRecord,
  ReportStore,
  ScheduleCadence,
} from './report-store.js';

function schemaSqlPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../../../../db/sql/037_reports_schema.sql'),
    join(process.cwd(), 'db/sql/037_reports_schema.sql'),
    join(process.cwd(), '../../db/sql/037_reports_schema.sql'),
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

let schemaReady: Promise<void> | null = null;

async function ensureSchema(pool: PgQueryable): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await pool.query(readFileSync(schemaSqlPath(), 'utf8'));
    })();
  }
  await schemaReady;
}

function asDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function parseRecipients(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function mapArtifact(row: Record<string, unknown>): ReportArtifactRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    reportKey: String(row.report_key) as CatalogueReportKey,
    format: String(row.format) as CatalogueReportFormat,
    objectKey: String(row.object_key),
    sha256: String(row.sha256),
    sizeBytes: Number(row.size_bytes),
    requestedBy: String(row.requested_by),
    createdAt: asDate(row.created_at),
  };
}

function mapSchedule(row: Record<string, unknown>): ReportScheduleRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    reportKey: String(row.report_key) as CatalogueReportKey,
    format: String(row.format) as CatalogueReportFormat,
    cadence: String(row.cadence) as ScheduleCadence,
    hour: Number(row.hour ?? 6),
    nextRunAt: asDate(row.next_run_at),
    recipients: parseRecipients(row.recipients),
    enabled: Boolean(row.enabled),
    createdBy: String(row.created_by ?? 'system'),
    lastRunAt: row.last_run_at == null ? null : asDate(row.last_run_at),
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}

function mapRun(row: Record<string, unknown>): ReportRunRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    scheduleId: row.schedule_id == null ? null : String(row.schedule_id),
    artifactId: row.artifact_id == null ? null : String(row.artifact_id),
    reportKey: String(row.report_key) as CatalogueReportKey,
    format: String(row.format) as CatalogueReportFormat,
    source: String(row.source) as ReportRunRecord['source'],
    status: String(row.status) as ReportRunRecord['status'],
    sha256: row.sha256 == null ? null : String(row.sha256),
    objectKey: row.object_key == null ? null : String(row.object_key),
    sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
    error: row.error == null ? null : String(row.error),
    createdAt: asDate(row.created_at),
    completedAt: row.completed_at == null ? null : asDate(row.completed_at),
  };
}

export class PgReportStore implements ReportStore {
  constructor(private readonly pool: PgQueryable) {}

  private async tenant<T>(tenantId: string, fn: (client: PgQueryable) => Promise<T>): Promise<T> {
    await ensureSchema(this.pool);
    return withPgTenant(this.pool as never, tenantId, fn);
  }

  async insertArtifact(record: ReportArtifactRecord): Promise<ReportArtifactRecord> {
    return this.tenant(record.tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO report_artifacts
           (id, tenant_id, report_key, format, object_key, sha256, size_bytes, requested_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [
          record.id,
          record.tenantId,
          record.reportKey,
          record.format,
          record.objectKey,
          record.sha256,
          record.sizeBytes,
          record.requestedBy,
          record.createdAt,
        ],
      );
      return mapArtifact(rows[0] as Record<string, unknown>);
    });
  }

  async getArtifact(tenantId: string, id: string): Promise<ReportArtifactRecord | null> {
    return this.tenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM report_artifacts WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [tenantId, id],
      );
      return rows[0] ? mapArtifact(rows[0] as Record<string, unknown>) : null;
    });
  }

  async listArtifacts(tenantId: string, reportKey?: string): Promise<ReportArtifactRecord[]> {
    return this.tenant(tenantId, async (client) => {
      const { rows } = reportKey
        ? await client.query(
            `SELECT * FROM report_artifacts WHERE tenant_id = $1 AND report_key = $2 ORDER BY created_at DESC`,
            [tenantId, reportKey],
          )
        : await client.query(
            `SELECT * FROM report_artifacts WHERE tenant_id = $1 ORDER BY created_at DESC`,
            [tenantId],
          );
      return (rows as Record<string, unknown>[]).map(mapArtifact);
    });
  }

  async insertSchedule(record: ReportScheduleRecord): Promise<ReportScheduleRecord> {
    return this.tenant(record.tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO report_schedules
           (id, tenant_id, report_key, format, cadence, hour, next_run_at, recipients, enabled, created_by, last_run_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13)
         RETURNING *`,
        [
          record.id,
          record.tenantId,
          record.reportKey,
          record.format,
          record.cadence,
          record.hour,
          record.nextRunAt,
          JSON.stringify(record.recipients),
          record.enabled,
          record.createdBy,
          record.lastRunAt,
          record.createdAt,
          record.updatedAt,
        ],
      );
      return mapSchedule(rows[0] as Record<string, unknown>);
    });
  }

  async getSchedule(tenantId: string, id: string): Promise<ReportScheduleRecord | null> {
    return this.tenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM report_schedules WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [tenantId, id],
      );
      return rows[0] ? mapSchedule(rows[0] as Record<string, unknown>) : null;
    });
  }

  async listSchedules(tenantId: string): Promise<ReportScheduleRecord[]> {
    return this.tenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM report_schedules WHERE tenant_id = $1 ORDER BY created_at DESC`,
        [tenantId],
      );
      return (rows as Record<string, unknown>[]).map(mapSchedule);
    });
  }

  async updateSchedule(
    tenantId: string,
    id: string,
    patch: Partial<
      Pick<
        ReportScheduleRecord,
        'enabled' | 'nextRunAt' | 'lastRunAt' | 'recipients' | 'cadence' | 'format' | 'hour'
      >
    >,
  ): Promise<ReportScheduleRecord | null> {
    return this.tenant(tenantId, async (client) => {
      const sets: string[] = ['updated_at = now()'];
      const values: unknown[] = [];
      let i = 1;
      if (patch.enabled !== undefined) {
        sets.push(`enabled = $${i++}`);
        values.push(patch.enabled);
      }
      if (patch.nextRunAt !== undefined) {
        sets.push(`next_run_at = $${i++}`);
        values.push(patch.nextRunAt);
      }
      if (patch.lastRunAt !== undefined) {
        sets.push(`last_run_at = $${i++}`);
        values.push(patch.lastRunAt);
      }
      if (patch.recipients !== undefined) {
        sets.push(`recipients = $${i++}::jsonb`);
        values.push(JSON.stringify(patch.recipients));
      }
      if (patch.cadence !== undefined) {
        sets.push(`cadence = $${i++}`);
        values.push(patch.cadence);
      }
      if (patch.format !== undefined) {
        sets.push(`format = $${i++}`);
        values.push(patch.format);
      }
      if (patch.hour !== undefined) {
        sets.push(`hour = $${i++}`);
        values.push(patch.hour);
      }
      values.push(tenantId, id);
      const { rows } = await client.query(
        `UPDATE report_schedules SET ${sets.join(', ')}
          WHERE tenant_id = $${i++} AND id = $${i}
          RETURNING *`,
        values,
      );
      return rows[0] ? mapSchedule(rows[0] as Record<string, unknown>) : null;
    });
  }

  async deleteSchedule(tenantId: string, id: string): Promise<boolean> {
    return this.tenant(tenantId, async (client) => {
      const { rowCount } = await client.query(
        `DELETE FROM report_schedules WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      return Number(rowCount ?? 0) > 0;
    });
  }

  async listDueSchedules(now: Date): Promise<ReportScheduleRecord[]> {
    await ensureSchema(this.pool);
    return withPlatformScope(this.pool as never, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM report_schedules
          WHERE enabled AND next_run_at <= $1
          ORDER BY next_run_at ASC`,
        [now],
      );
      return (rows as Record<string, unknown>[]).map(mapSchedule);
    });
  }

  async insertRun(record: ReportRunRecord): Promise<ReportRunRecord> {
    return this.tenant(record.tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO report_runs
           (id, tenant_id, schedule_id, artifact_id, report_key, format, source, status, sha256, object_key, size_bytes, error, created_at, completed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING *`,
        [
          record.id,
          record.tenantId,
          record.scheduleId,
          record.artifactId,
          record.reportKey,
          record.format,
          record.source,
          record.status,
          record.sha256,
          record.objectKey,
          record.sizeBytes,
          record.error,
          record.createdAt,
          record.completedAt,
        ],
      );
      return mapRun(rows[0] as Record<string, unknown>);
    });
  }

  async updateRun(
    tenantId: string,
    id: string,
    patch: Partial<
      Pick<
        ReportRunRecord,
        'status' | 'artifactId' | 'error' | 'completedAt' | 'sha256' | 'objectKey' | 'sizeBytes'
      >
    >,
  ): Promise<ReportRunRecord | null> {
    return this.tenant(tenantId, async (client) => {
      const sets: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      if (patch.status !== undefined) {
        sets.push(`status = $${i++}`);
        values.push(patch.status);
      }
      if (patch.artifactId !== undefined) {
        sets.push(`artifact_id = $${i++}`);
        values.push(patch.artifactId);
      }
      if (patch.error !== undefined) {
        sets.push(`error = $${i++}`);
        values.push(patch.error);
      }
      if (patch.completedAt !== undefined) {
        sets.push(`completed_at = $${i++}`);
        values.push(patch.completedAt);
      }
      if (patch.sha256 !== undefined) {
        sets.push(`sha256 = $${i++}`);
        values.push(patch.sha256);
      }
      if (patch.objectKey !== undefined) {
        sets.push(`object_key = $${i++}`);
        values.push(patch.objectKey);
      }
      if (patch.sizeBytes !== undefined) {
        sets.push(`size_bytes = $${i++}`);
        values.push(patch.sizeBytes);
      }
      if (sets.length === 0) {
        const existing = await client.query(
          `SELECT * FROM report_runs WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
          [tenantId, id],
        );
        return existing.rows[0]
          ? mapRun(existing.rows[0] as Record<string, unknown>)
          : null;
      }
      values.push(tenantId, id);
      const { rows } = await client.query(
        `UPDATE report_runs SET ${sets.join(', ')}
          WHERE tenant_id = $${i++} AND id = $${i}
          RETURNING *`,
        values,
      );
      return rows[0] ? mapRun(rows[0] as Record<string, unknown>) : null;
    });
  }

  async listRuns(
    tenantId: string,
    filter?: { reportKey?: string; scheduleId?: string; templateId?: string },
  ): Promise<ReportRunRecord[]> {
    return this.tenant(tenantId, async (client) => {
      const clauses = ['tenant_id = $1'];
      const values: unknown[] = [tenantId];
      let i = 2;
      const key = filter?.reportKey ?? filter?.templateId;
      if (key) {
        clauses.push(`report_key = $${i++}`);
        values.push(key);
      }
      if (filter?.scheduleId) {
        clauses.push(`schedule_id = $${i++}`);
        values.push(filter.scheduleId);
      }
      const { rows } = await client.query(
        `SELECT * FROM report_runs WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC`,
        values,
      );
      return (rows as Record<string, unknown>[]).map(mapRun);
    });
  }
}

export function tryCreatePgReportStore(): PgReportStore | null {
  const pool = getSharedPgPool();
  return pool ? new PgReportStore(pool) : null;
}
