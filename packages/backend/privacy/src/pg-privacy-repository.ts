/**
 * Postgres-backed privacy repository (raw `pg` — no Prisma).
 *
 * Maps to db/sql/067_privacy_legal_hold_erasure.sql and
 * db/sql/078_privacy_lifecycle_complete.sql. Every query runs inside withPgTenant.
 */
import {
  createDatabaseSchemaReadinessCheck,
  getSharedPgPool,
  withPgTenant,
  type PgQueryable,
} from '@proctira/database';
import type pg from 'pg';

import {
  CORRECTION_VALUE_REDACTED,
  NON_TERMINAL_ANONYMIZATION_JOB_STATUSES,
} from './privacy-repository.js';
import type {
  ReleaseStalledErasureResult,
  AnonymizationJobEntity,
  CorrectionRequestEntity,
  ErasureRequestEntity,
  LegalHoldEntity,
  OffboardChecklistItem,
  ListPage,
  PrivacyRepository,
  TenantOffboardJobEntity,
} from './privacy-repository.js';
import type {
  AnonymizationJobStatus,
  CorrectionStatus,
  ErasureRequestType,
  ErasureStatus,
  LegalHoldScope,
  OffboardJobStatus,
} from './schemas.js';

export type PgPoolLike = Pick<pg.Pool, 'query' | 'end'> & Partial<Pick<pg.Pool, 'connect'>>;

const ensurePrivacySchemaReady = createDatabaseSchemaReadinessCheck('privacy', 'privacy');

export function getSharedPrivacyPool(): pg.Pool | null {
  return getSharedPgPool();
}

export async function ensurePrivacySchema(
  pool: PgPoolLike = getSharedPrivacyPool()!,
): Promise<void> {
  if (!pool) throw new Error('DATABASE_URL is required for privacy schema ensure');
  await ensurePrivacySchemaReady(pool);
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function toDateOrNull(value: unknown): Date | null {
  if (value == null) return null;
  return toDate(value);
}

function parseStringArray(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseChecklist(raw: unknown): OffboardChecklistItem[] {
  if (raw == null) return [];
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      domain: String(row.domain ?? ''),
      status: String(row.status ?? 'pending') as OffboardChecklistItem['status'],
      note: row.note == null ? undefined : String(row.note),
    };
  });
}

function mapLegalHold(row: Record<string, unknown>): LegalHoldEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    scope: String(row.scope) as LegalHoldScope,
    subjectType: row.subject_type == null ? null : String(row.subject_type),
    subjectId: row.subject_id == null ? null : String(row.subject_id),
    reason: String(row.reason),
    placedBy: String(row.placed_by),
    placedAt: toDate(row.placed_at),
    releasedBy: row.released_by == null ? null : String(row.released_by),
    releasedAt: toDateOrNull(row.released_at),
    active: Boolean(row.active),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapErasure(row: Record<string, unknown>): ErasureRequestEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    subjectType: String(row.subject_type),
    subjectId: String(row.subject_id),
    status: String(row.status) as ErasureStatus,
    requestType: String(row.request_type) as ErasureRequestType,
    reason: row.reason == null ? null : String(row.reason),
    requestedBy: String(row.requested_by),
    reviewedBy: row.reviewed_by == null ? null : String(row.reviewed_by),
    statusReason: row.status_reason == null ? null : String(row.status_reason),
    completedAt: toDateOrNull(row.completed_at),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapCorrection(row: Record<string, unknown>): CorrectionRequestEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    subjectType: String(row.subject_type),
    subjectId: String(row.subject_id),
    fieldPath: String(row.field_path),
    currentValue: row.current_value == null ? null : String(row.current_value),
    requestedValue: String(row.requested_value),
    reason: row.reason == null ? null : String(row.reason),
    status: String(row.status) as CorrectionStatus,
    requestedBy: String(row.requested_by),
    reviewedBy: row.reviewed_by == null ? null : String(row.reviewed_by),
    statusReason: row.status_reason == null ? null : String(row.status_reason),
    appliedAt: toDateOrNull(row.applied_at),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapAnonymization(row: Record<string, unknown>): AnonymizationJobEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    erasureRequestId: String(row.erasure_request_id),
    subjectType: String(row.subject_type),
    subjectId: String(row.subject_id),
    requestType: String(row.request_type) as ErasureRequestType,
    status: String(row.status) as AnonymizationJobStatus,
    actorId: String(row.actor_id),
    statusReason: row.status_reason == null ? null : String(row.status_reason),
    fieldsTouched: parseStringArray(row.fields_touched),
    residualNote: row.residual_note == null ? null : String(row.residual_note),
    startedAt: toDateOrNull(row.started_at),
    completedAt: toDateOrNull(row.completed_at),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapOffboard(row: Record<string, unknown>): TenantOffboardJobEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    status: String(row.status) as OffboardJobStatus,
    reason: String(row.reason),
    requestedBy: String(row.requested_by),
    statusReason: row.status_reason == null ? null : String(row.status_reason),
    checklist: parseChecklist(row.checklist),
    residualNote: row.residual_note == null ? null : String(row.residual_note),
    startedAt: toDateOrNull(row.started_at),
    completedAt: toDateOrNull(row.completed_at),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

async function insertAnonymizationJob(
  client: PgQueryable,
  data: Omit<AnonymizationJobEntity, 'createdAt' | 'updatedAt'>,
): Promise<AnonymizationJobEntity> {
  const result = await client.query(
    `INSERT INTO privacy_anonymization_jobs (
       id, tenant_id, erasure_request_id, subject_type, subject_id,
       request_type, status, actor_id, status_reason, fields_touched,
       residual_note, started_at, completed_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13)
     RETURNING *`,
    [
      data.id,
      data.tenantId,
      data.erasureRequestId,
      data.subjectType,
      data.subjectId,
      data.requestType,
      data.status,
      data.actorId,
      data.statusReason,
      JSON.stringify(data.fieldsTouched ?? []),
      data.residualNote,
      data.startedAt,
      data.completedAt,
    ],
  );
  return mapAnonymization(result.rows[0] as Record<string, unknown>);
}
export class PgPrivacyRepository implements PrivacyRepository {
  constructor(private readonly pool: PgPoolLike) {}

  private withTenant<T>(tenantId: string, fn: (client: PgQueryable) => Promise<T>): Promise<T> {
    return withPgTenant(this.pool, tenantId, fn);
  }

  async ensureSchema(): Promise<void> {
    await ensurePrivacySchema(this.pool);
  }

  async createLegalHold(
    data: Omit<LegalHoldEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<LegalHoldEntity> {
    await this.ensureSchema();
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO privacy_legal_holds (
           id, tenant_id, scope, subject_type, subject_id, reason,
           placed_by, placed_at, released_by, released_at, active
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.scope,
          data.subjectType,
          data.subjectId,
          data.reason,
          data.placedBy,
          data.placedAt,
          data.releasedBy,
          data.releasedAt,
          data.active,
        ],
      );
      return mapLegalHold(result.rows[0] as Record<string, unknown>);
    });
  }

  async updateLegalHold(
    id: string,
    tenantId: string,
    data: Partial<Pick<LegalHoldEntity, 'active' | 'releasedBy' | 'releasedAt'>>,
  ): Promise<LegalHoldEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const existing = await client.query(
        `SELECT * FROM privacy_legal_holds WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [id, tenantId],
      );
      if (!existing.rows[0]) return null;
      const cur = mapLegalHold(existing.rows[0] as Record<string, unknown>);
      const result = await client.query(
        `UPDATE privacy_legal_holds SET
           active = $3,
           released_by = $4,
           released_at = $5,
           updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2
         RETURNING *`,
        [
          id,
          tenantId,
          data.active ?? cur.active,
          data.releasedBy !== undefined ? data.releasedBy : cur.releasedBy,
          data.releasedAt !== undefined ? data.releasedAt : cur.releasedAt,
        ],
      );
      return mapLegalHold(result.rows[0] as Record<string, unknown>);
    });
  }

  async findLegalHoldById(id: string, tenantId: string): Promise<LegalHoldEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM privacy_legal_holds WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [id, tenantId],
      );
      if (!result.rows[0]) return null;
      return mapLegalHold(result.rows[0] as Record<string, unknown>);
    });
  }

  async findActiveHold(
    tenantId: string,
    subject?: { subjectType?: string; subjectId?: string },
  ): Promise<Pick<LegalHoldEntity, 'id' | 'scope'> | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      // One query served by idx_privacy_legal_holds_tenant_active /
      // idx_privacy_legal_holds_subject_active (db/sql/067).
      const result = await client.query(
        `SELECT id, scope FROM privacy_legal_holds
         WHERE tenant_id = $1 AND active = true
           AND (
             scope = 'tenant'
             OR (scope = 'subject' AND $3::text IS NOT NULL AND subject_id = $3::text
                 AND ($2::text IS NULL OR subject_type = $2::text))
           )
         ORDER BY (scope = 'tenant') DESC
         LIMIT 1`,
        [tenantId, subject?.subjectType ?? null, subject?.subjectId ?? null],
      );
      const row = result.rows[0] as { id: unknown; scope: unknown } | undefined;
      return row
        ? { id: String(row.id), scope: String(row.scope) as LegalHoldEntity['scope'] }
        : null;
    });
  }
  async listActiveLegalHolds(tenantId: string, page?: ListPage): Promise<LegalHoldEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM privacy_legal_holds
         WHERE tenant_id = $1 AND active = true
         ORDER BY placed_at DESC${page ? ' LIMIT $2 OFFSET $3' : ''}`,
        page ? [tenantId, page.limit, page.offset] : [tenantId],
      );
      return result.rows.map((row) => mapLegalHold(row as Record<string, unknown>));
    });
  }

  async createErasureRequest(
    data: Omit<ErasureRequestEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<ErasureRequestEntity> {
    await this.ensureSchema();
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO privacy_erasure_requests (
           id, tenant_id, subject_type, subject_id, status, request_type,
           reason, requested_by, reviewed_by, status_reason, completed_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.subjectType,
          data.subjectId,
          data.status,
          data.requestType,
          data.reason,
          data.requestedBy,
          data.reviewedBy,
          data.statusReason,
          data.completedAt,
        ],
      );
      return mapErasure(result.rows[0] as Record<string, unknown>);
    });
  }

  async updateErasureRequest(
    id: string,
    tenantId: string,
    data: Partial<
      Pick<ErasureRequestEntity, 'status' | 'reviewedBy' | 'statusReason' | 'completedAt'>
    >,
    options?: { expectedStatus?: ErasureRequestEntity['status'] },
  ): Promise<ErasureRequestEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const existing = await client.query(
        `SELECT * FROM privacy_erasure_requests WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [id, tenantId],
      );
      if (!existing.rows[0]) return null;
      const cur = mapErasure(existing.rows[0] as Record<string, unknown>);
      // $7 is the optional compare-and-set status (PRC-H076): a concurrent writer
      // that moved the row since we read it makes this UPDATE a no-op.
      const result = await client.query(
        `UPDATE privacy_erasure_requests SET
           status = $3,
           reviewed_by = $4,
           status_reason = $5,
           completed_at = $6,
           updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2
           AND ($7::text IS NULL OR status = $7::text)
         RETURNING *`,
        [
          id,
          tenantId,
          data.status ?? cur.status,
          data.reviewedBy !== undefined ? data.reviewedBy : cur.reviewedBy,
          data.statusReason !== undefined ? data.statusReason : cur.statusReason,
          data.completedAt !== undefined ? data.completedAt : cur.completedAt,
          options?.expectedStatus ?? null,
        ],
      );
      if (!result.rows[0]) return null;
      return mapErasure(result.rows[0] as Record<string, unknown>);
    });
  }

  async findErasureRequestById(id: string, tenantId: string): Promise<ErasureRequestEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM privacy_erasure_requests WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [id, tenantId],
      );
      if (!result.rows[0]) return null;
      return mapErasure(result.rows[0] as Record<string, unknown>);
    });
  }

  async listErasureRequests(tenantId: string, page?: ListPage): Promise<ErasureRequestEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM privacy_erasure_requests
         WHERE tenant_id = $1
         ORDER BY created_at DESC${page ? ' LIMIT $2 OFFSET $3' : ''}`,
        page ? [tenantId, page.limit, page.offset] : [tenantId],
      );
      return result.rows.map((row) => mapErasure(row as Record<string, unknown>));
    });
  }

  async createCorrectionRequest(
    data: Omit<CorrectionRequestEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<CorrectionRequestEntity> {
    await this.ensureSchema();
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO privacy_correction_requests (
           id, tenant_id, subject_type, subject_id, field_path,
           current_value, requested_value, reason, status,
           requested_by, reviewed_by, status_reason, applied_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.subjectType,
          data.subjectId,
          data.fieldPath,
          data.currentValue,
          data.requestedValue,
          data.reason,
          data.status,
          data.requestedBy,
          data.reviewedBy,
          data.statusReason,
          data.appliedAt,
        ],
      );
      return mapCorrection(result.rows[0] as Record<string, unknown>);
    });
  }

  async updateCorrectionRequest(
    id: string,
    tenantId: string,
    data: Partial<
      Pick<
        CorrectionRequestEntity,
        'status' | 'reviewedBy' | 'statusReason' | 'appliedAt' | 'currentValue' | 'requestedValue'
      >
    >,
  ): Promise<CorrectionRequestEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const existing = await client.query(
        `SELECT * FROM privacy_correction_requests WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [id, tenantId],
      );
      if (!existing.rows[0]) return null;
      const cur = mapCorrection(existing.rows[0] as Record<string, unknown>);
      const result = await client.query(
        `UPDATE privacy_correction_requests SET
           status = $3,
           reviewed_by = $4,
           status_reason = $5,
           applied_at = $6,
           current_value = $7,
           requested_value = $8,
           updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2
         RETURNING *`,
        [
          id,
          tenantId,
          data.status ?? cur.status,
          data.reviewedBy !== undefined ? data.reviewedBy : cur.reviewedBy,
          data.statusReason !== undefined ? data.statusReason : cur.statusReason,
          data.appliedAt !== undefined ? data.appliedAt : cur.appliedAt,
          data.currentValue !== undefined ? data.currentValue : cur.currentValue,
          data.requestedValue !== undefined ? data.requestedValue : cur.requestedValue,
        ],
      );
      return mapCorrection(result.rows[0] as Record<string, unknown>);
    });
  }

  async redactCorrectionValuesForSubject(
    tenantId: string,
    subjectType: string,
    subjectId: string,
  ): Promise<number> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `UPDATE privacy_correction_requests SET
           current_value = NULL,
           requested_value = $4,
           updated_at = NOW()
         WHERE tenant_id = $1 AND subject_type = $2 AND subject_id = $3
           AND (current_value IS NOT NULL OR requested_value <> $4)`,
        [tenantId, subjectType, subjectId, CORRECTION_VALUE_REDACTED],
      );
      return Number(result.rowCount ?? 0);
    });
  }
  async findCorrectionRequestById(
    id: string,
    tenantId: string,
  ): Promise<CorrectionRequestEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM privacy_correction_requests WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [id, tenantId],
      );
      if (!result.rows[0]) return null;
      return mapCorrection(result.rows[0] as Record<string, unknown>);
    });
  }

  async listCorrectionRequests(
    tenantId: string,
    page?: ListPage,
  ): Promise<CorrectionRequestEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM privacy_correction_requests
         WHERE tenant_id = $1
         ORDER BY created_at DESC${page ? ' LIMIT $2 OFFSET $3' : ''}`,
        page ? [tenantId, page.limit, page.offset] : [tenantId],
      );
      return result.rows.map((row) => mapCorrection(row as Record<string, unknown>));
    });
  }

  async createAnonymizationJob(
    data: Omit<AnonymizationJobEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<AnonymizationJobEntity> {
    await this.ensureSchema();
    return this.withTenant(data.tenantId, (client) => insertAnonymizationJob(client, data));
  }
  async startErasureExecution(
    requestId: string,
    tenantId: string,
    patch: { reviewedBy: string; statusReason: string },
    job: Omit<AnonymizationJobEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<{ erasure: ErasureRequestEntity; job: AnonymizationJobEntity } | null> {
    await this.ensureSchema();
    // PRC-M320: CAS status flip + job insert share one withPgTenant transaction; an insert
    // failure rolls the flip back so the request stays `approved` and retryable.
    return this.withTenant(tenantId, async (client) => {
      const flipped = await client.query(
        `UPDATE privacy_erasure_requests SET
           status = 'in_progress',
           reviewed_by = $3,
           status_reason = $4,
           updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2 AND status = 'approved'
         RETURNING *`,
        [requestId, tenantId, patch.reviewedBy, patch.statusReason],
      );
      if (!flipped.rows[0]) return null;
      const created = await insertAnonymizationJob(client, job);
      return {
        erasure: mapErasure(flipped.rows[0] as Record<string, unknown>),
        job: created,
      };
    });
  }
  async releaseStalledErasureExecution(
    requestId: string,
    tenantId: string,
    patch: { reviewedBy: string; statusReason: string },
    staleBefore: Date,
  ): Promise<ReleaseStalledErasureResult> {
    await this.ensureSchema();
    // Review #554: one withPgTenant transaction. Row locks on the request and on its open
    // jobs make a concurrent worker claim (queued -> in_progress CAS) wait for this decision.
    return this.withTenant(tenantId, async (client): Promise<ReleaseStalledErasureResult> => {
      const request = await client.query(
        `SELECT status FROM privacy_erasure_requests
         WHERE id = $1 AND tenant_id = $2
         FOR UPDATE`,
        [requestId, tenantId],
      );
      const row = request.rows[0] as { status?: string } | undefined;
      if (row?.status !== 'in_progress') return { outcome: 'not_in_progress' };
      const open = await client.query(
        `SELECT id, (COALESCE(started_at, created_at) > $3::timestamptz) AS live
         FROM privacy_anonymization_jobs
         WHERE tenant_id = $1 AND erasure_request_id = $2
           AND status = ANY($4::text[])
         ORDER BY created_at
         FOR UPDATE`,
        [tenantId, requestId, staleBefore, [...NON_TERMINAL_ANONYMIZATION_JOB_STATUSES]],
      );
      const jobs = open.rows as Array<{ id: unknown; live: unknown }>;
      const live = jobs.find((j) => j.live === true);
      if (live) return { outcome: 'live_job', jobId: String(live.id) };
      const failedJobIds = jobs.map((j) => String(j.id));
      if (failedJobIds.length > 0) {
        await client.query(
          `UPDATE privacy_anonymization_jobs SET
             status = 'failed',
             status_reason = 'Stalled run released for retry; job fenced',
             completed_at = NOW(),
             updated_at = NOW()
           WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
          [tenantId, failedJobIds],
        );
      }
      const released = await client.query(
        `UPDATE privacy_erasure_requests SET
           status = 'approved',
           reviewed_by = $3,
           status_reason = $4,
           updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2 AND status = 'in_progress'
         RETURNING *`,
        [requestId, tenantId, patch.reviewedBy, patch.statusReason],
      );
      return {
        outcome: 'released',
        erasure: mapErasure(released.rows[0] as Record<string, unknown>),
        failedJobIds,
      };
    });
  }
  async updateAnonymizationJob(
    id: string,
    tenantId: string,
    data: Partial<
      Pick<
        AnonymizationJobEntity,
        'status' | 'statusReason' | 'fieldsTouched' | 'residualNote' | 'startedAt' | 'completedAt'
      >
    >,
    options?: { expectedStatus?: AnonymizationJobEntity['status'] },
  ): Promise<AnonymizationJobEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const existing = await client.query(
        `SELECT * FROM privacy_anonymization_jobs WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [id, tenantId],
      );
      if (!existing.rows[0]) return null;
      const cur = mapAnonymization(existing.rows[0] as Record<string, unknown>);
      const fieldsTouched = data.fieldsTouched ?? cur.fieldsTouched;
      const result = await client.query(
        `UPDATE privacy_anonymization_jobs SET
           status = $3,
           status_reason = $4,
           fields_touched = $5::jsonb,
           residual_note = $6,
           started_at = $7,
           completed_at = $8,
           updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2
           AND ($9::text IS NULL OR status = $9::text)
         RETURNING *`,
        [
          id,
          tenantId,
          data.status ?? cur.status,
          data.statusReason !== undefined ? data.statusReason : cur.statusReason,
          JSON.stringify(fieldsTouched),
          data.residualNote !== undefined ? data.residualNote : cur.residualNote,
          data.startedAt !== undefined ? data.startedAt : cur.startedAt,
          data.completedAt !== undefined ? data.completedAt : cur.completedAt,
          options?.expectedStatus ?? null,
        ],
      );
      // Review #554: a CAS miss (job fenced/claimed by another writer) writes nothing.
      if (!result.rows[0]) return null;
      return mapAnonymization(result.rows[0] as Record<string, unknown>);
    });
  }

  async findAnonymizationJobById(
    id: string,
    tenantId: string,
  ): Promise<AnonymizationJobEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM privacy_anonymization_jobs WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [id, tenantId],
      );
      if (!result.rows[0]) return null;
      return mapAnonymization(result.rows[0] as Record<string, unknown>);
    });
  }

  async listAnonymizationJobs(tenantId: string): Promise<AnonymizationJobEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM privacy_anonymization_jobs
         WHERE tenant_id = $1
         ORDER BY created_at DESC`,
        [tenantId],
      );
      return result.rows.map((row) => mapAnonymization(row as Record<string, unknown>));
    });
  }

  async createTenantOffboardJob(
    data: Omit<TenantOffboardJobEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<TenantOffboardJobEntity> {
    await this.ensureSchema();
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO privacy_tenant_offboard_jobs (
           id, tenant_id, status, reason, requested_by, status_reason,
           checklist, residual_note, started_at, completed_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)
         RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.status,
          data.reason,
          data.requestedBy,
          data.statusReason,
          JSON.stringify(data.checklist ?? []),
          data.residualNote,
          data.startedAt,
          data.completedAt,
        ],
      );
      return mapOffboard(result.rows[0] as Record<string, unknown>);
    });
  }

  async updateTenantOffboardJob(
    id: string,
    tenantId: string,
    data: Partial<
      Pick<
        TenantOffboardJobEntity,
        'status' | 'statusReason' | 'checklist' | 'residualNote' | 'startedAt' | 'completedAt'
      >
    >,
  ): Promise<TenantOffboardJobEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const existing = await client.query(
        `SELECT * FROM privacy_tenant_offboard_jobs WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [id, tenantId],
      );
      if (!existing.rows[0]) return null;
      const cur = mapOffboard(existing.rows[0] as Record<string, unknown>);
      const checklist = data.checklist ?? cur.checklist;
      const result = await client.query(
        `UPDATE privacy_tenant_offboard_jobs SET
           status = $3,
           status_reason = $4,
           checklist = $5::jsonb,
           residual_note = $6,
           started_at = $7,
           completed_at = $8,
           updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2
         RETURNING *`,
        [
          id,
          tenantId,
          data.status ?? cur.status,
          data.statusReason !== undefined ? data.statusReason : cur.statusReason,
          JSON.stringify(checklist),
          data.residualNote !== undefined ? data.residualNote : cur.residualNote,
          data.startedAt !== undefined ? data.startedAt : cur.startedAt,
          data.completedAt !== undefined ? data.completedAt : cur.completedAt,
        ],
      );
      return mapOffboard(result.rows[0] as Record<string, unknown>);
    });
  }

  async findTenantOffboardJobById(
    id: string,
    tenantId: string,
  ): Promise<TenantOffboardJobEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM privacy_tenant_offboard_jobs WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [id, tenantId],
      );
      if (!result.rows[0]) return null;
      return mapOffboard(result.rows[0] as Record<string, unknown>);
    });
  }

  async listTenantOffboardJobs(
    tenantId: string,
    page?: ListPage,
  ): Promise<TenantOffboardJobEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM privacy_tenant_offboard_jobs
         WHERE tenant_id = $1
         ORDER BY created_at DESC${page ? ' LIMIT $2 OFFSET $3' : ''}`,
        page ? [tenantId, page.limit, page.offset] : [tenantId],
      );
      return result.rows.map((row) => mapOffboard(row as Record<string, unknown>));
    });
  }
}
