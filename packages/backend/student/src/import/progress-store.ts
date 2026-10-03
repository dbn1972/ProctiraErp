/**
 * PRC-H092: import progress stores.
 *
 * - QueueProgressStore (default): process-local, writes through to the ImportQueue snapshot
 *   map and records the owning tenant so polls are tenant-scoped.
 * - PgImportProgressStore: `student_import_jobs` (migration 152, RLS) so polling works from
 *   any gateway instance and survives restarts.
 */
import { createDatabaseSchemaReadinessCheck, withPgTenant } from '@proctira/database';

import type { ImportProgress, ImportProgressStore, ImportQueue } from './types.js';

type Pool = Parameters<typeof withPgTenant>[0];

const ensureImportJobsSchema = createDatabaseSchemaReadinessCheck(
  'student-import',
  'studentImportJobs',
);

export class QueueProgressStore implements ImportProgressStore {
  private readonly owners = new Map<string, string>();

  constructor(private readonly queue: ImportQueue) {}

  async get(tenantId: string, jobId: string): Promise<ImportProgress | null> {
    if (this.owners.get(jobId) !== tenantId) return null;
    return this.queue.getProgress(jobId);
  }

  async update(tenantId: string, jobId: string, progress: Partial<ImportProgress>): Promise<void> {
    const owner = this.owners.get(jobId);
    if (owner && owner !== tenantId) return;
    this.owners.set(jobId, tenantId);
    await this.queue.updateProgress(jobId, progress);
  }
}

function rowToProgress(row: Record<string, unknown>): ImportProgress {
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? String(v) : undefined);
  return {
    jobId: String(row['job_id']),
    status: row['status'] as ImportProgress['status'],
    totalRows: Number(row['total_rows'] ?? 0),
    processedRows: Number(row['processed_rows'] ?? 0),
    progressPercent: Number(row['progress_percent'] ?? 0),
    ...(row['result'] ? { result: row['result'] as ImportProgress['result'] } : {}),
    ...(row['error_message'] ? { errorMessage: String(row['error_message']) } : {}),
    startedAt: iso(row['started_at']) ?? new Date(0).toISOString(),
    ...(row['completed_at'] ? { completedAt: iso(row['completed_at']) } : {}),
  };
}

export class PgImportProgressStore implements ImportProgressStore {
  constructor(private readonly pool: Pool) {}

  async get(tenantId: string, jobId: string): Promise<ImportProgress | null> {
    await ensureImportJobsSchema(this.pool as never);
    return withPgTenant(this.pool, tenantId, async (client) => {
      const res = await client.query(
        `SELECT * FROM student_import_jobs WHERE tenant_id = $1 AND job_id = $2`,
        [tenantId, jobId],
      );
      const row = res.rows[0] as Record<string, unknown> | undefined;
      return row ? rowToProgress(row) : null;
    });
  }

  async update(tenantId: string, jobId: string, progress: Partial<ImportProgress>): Promise<void> {
    await ensureImportJobsSchema(this.pool as never);
    await withPgTenant(this.pool, tenantId, async (client) => {
      const res = await client.query(
        `SELECT * FROM student_import_jobs WHERE tenant_id = $1 AND job_id = $2 FOR UPDATE`,
        [tenantId, jobId],
      );
      const existing = res.rows[0] as Record<string, unknown> | undefined;
      const merged: ImportProgress = {
        ...(existing
          ? rowToProgress(existing)
          : {
              jobId,
              status: 'queued' as const,
              totalRows: 0,
              processedRows: 0,
              progressPercent: 0,
              startedAt: new Date().toISOString(),
            }),
        ...progress,
        jobId,
      };
      await client.query(
        `INSERT INTO student_import_jobs (
           tenant_id, job_id, status, total_rows, processed_rows, progress_percent,
           result, error_message, started_at, completed_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::timestamptz, $10::timestamptz, now())
         ON CONFLICT (tenant_id, job_id) DO UPDATE SET
           status = EXCLUDED.status,
           total_rows = EXCLUDED.total_rows,
           processed_rows = EXCLUDED.processed_rows,
           progress_percent = EXCLUDED.progress_percent,
           result = EXCLUDED.result,
           error_message = EXCLUDED.error_message,
           started_at = EXCLUDED.started_at,
           completed_at = EXCLUDED.completed_at,
           updated_at = now()`,
        [
          tenantId,
          jobId,
          merged.status,
          merged.totalRows,
          merged.processedRows,
          Math.max(0, Math.min(100, Math.round(merged.progressPercent))),
          merged.result ? JSON.stringify(merged.result) : null,
          merged.errorMessage ?? null,
          merged.startedAt,
          merged.completedAt ?? null,
        ],
      );
    });
  }
}
