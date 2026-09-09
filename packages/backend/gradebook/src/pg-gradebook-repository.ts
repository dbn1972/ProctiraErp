/**
 * Postgres-backed gradebook store (raw `pg` — no Prisma).
 * Aligns with db/sql/003_sis_timetable_schedule_schema.sql (+ 004 indexes).
 */
import { withPgTenant } from '@proctira/database';
import pg from 'pg';

import type { GradeBand } from './gpa-engine.js';
import { GradebookSchemaMissingError } from './gradebook-errors.js';
import type {
  BoardCodeEntity,
  BoardExportCandidate,
  BoardSummary,
  CreditRuleEntity,
  ExportJobEntity,
  GpaSnapshotEntity,
  GradeEntryEntity,
  GradebookRepository,
  GradingScaleEntity,
  InstitutionSummary,
  ListBoardExportCandidatesFilter,
  ListGradeEntriesFilter,
  ListSectionsFilter,
  ListTranscriptsFilter,
  SectionSummary,
  TranscriptIssuanceEntity,
} from './gradebook-repository.js';

const { Pool } = pg;

export type PgPoolLike = Pick<pg.Pool, 'query' | 'end'> & Partial<Pick<pg.Pool, 'connect'>>;

let sharedPool: pg.Pool | null = null;

function resolveDatabaseUrl(): string | null {
  const url = process.env.DATABASE_URL?.trim();
  return url && url.length > 0 ? url : null;
}

export function isPgGradebookEnabled(): boolean {
  return resolveDatabaseUrl() !== null;
}

export function getSharedGradebookPool(): pg.Pool | null {
  const url = resolveDatabaseUrl();
  if (!url) return null;
  if (!sharedPool) {
    sharedPool = new Pool({ connectionString: url });
  }
  return sharedPool;
}

/** Schema is applied via psql (003/004). Do not re-run from node-pg. */
export async function ensureGradebookSchema(_pool?: PgPoolLike): Promise<void> {
  // no-op
}

function isUndefinedTable(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === '42P01'
  );
}

async function withSchemaCheck<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (isUndefinedTable(error)) {
      throw new GradebookSchemaMissingError();
    }
    throw error;
  }
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function num(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function jsonObj(value: unknown): Record<string, unknown> {
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
      /* ignore */
    }
  }
  return {};
}

function mapEntry(row: Record<string, unknown>): GradeEntryEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    sectionId: row.section_id == null ? null : String(row.section_id),
    studentId: String(row.student_id),
    assessmentCode: row.assessment_code == null ? null : String(row.assessment_code),
    numericScore: num(row.numeric_score),
    letterGrade: row.letter_grade == null ? null : String(row.letter_grade),
    enteredBy: row.entered_by == null ? null : String(row.entered_by),
    enteredAt: iso(row.entered_at),
    lockedAt: row.locked_at == null ? null : iso(row.locked_at),
    publishedAt: row.published_at == null ? null : iso(row.published_at),
    metadata: jsonObj(row.metadata),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapCredit(row: Record<string, unknown>): CreditRuleEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    boardId: row.board_id == null ? null : String(row.board_id),
    code: String(row.code),
    name: String(row.name),
    credits: Number(row.credits),
    metadata: jsonObj(row.metadata),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapSnapshot(row: Record<string, unknown>): GpaSnapshotEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    studentId: String(row.student_id),
    academicPeriodId: row.academic_period_id == null ? null : String(row.academic_period_id),
    weightedGpa: num(row.weighted_gpa),
    unweightedGpa: num(row.unweighted_gpa),
    creditsEarned: num(row.credits_earned),
    computedAt: iso(row.computed_at),
    metadata: jsonObj(row.metadata),
    createdAt: iso(row.created_at),
  };
}

function mapTranscript(row: Record<string, unknown>): TranscriptIssuanceEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    studentId: String(row.student_id),
    version: Number(row.version),
    status: String(row.status) as TranscriptIssuanceEntity['status'],
    issuedAt: row.issued_at == null ? null : iso(row.issued_at),
    issuedBy: row.issued_by == null ? null : String(row.issued_by),
    artifactUri: row.artifact_uri == null ? null : String(row.artifact_uri),
    checksumSha256: row.checksum_sha256 == null ? null : String(row.checksum_sha256),
    metadata: jsonObj(row.metadata),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapJob(row: Record<string, unknown>): ExportJobEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    boardId: String(row.board_id),
    institutionId: row.institution_id == null ? null : String(row.institution_id),
    jobType: String(row.job_type),
    status: String(row.status) as ExportJobEntity['status'],
    requestedBy: row.requested_by == null ? null : String(row.requested_by),
    startedAt: row.started_at == null ? null : iso(row.started_at),
    finishedAt: row.finished_at == null ? null : iso(row.finished_at),
    artifactUri: row.artifact_uri == null ? null : String(row.artifact_uri),
    errorMessage: row.error_message == null ? null : String(row.error_message),
    metadata: jsonObj(row.metadata),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapSection(row: Record<string, unknown>): SectionSummary {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    institutionId: String(row.institution_id),
    academicPeriodId: String(row.academic_period_id),
    code: String(row.code),
    name: String(row.name),
    status: String(row.status),
  };
}

function mapBoard(row: Record<string, unknown>): BoardSummary {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    code: String(row.code),
    name: String(row.name),
  };
}

function mapInstitution(row: Record<string, unknown>): InstitutionSummary {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    boardId: String(row.board_id),
    code: String(row.code),
    name: String(row.name),
  };
}

function mapBoardCode(row: Record<string, unknown>): BoardCodeEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    boardId: String(row.board_id),
    institutionId: String(row.institution_id),
    codeType: String(row.code_type),
    codeValue: String(row.code_value),
    label: row.label == null ? null : String(row.label),
  };
}

export class PgGradebookRepository implements GradebookRepository {
  constructor(private readonly pool: PgPoolLike) {}

  /** G-710: every query runs with the tenant GUC bound so RLS applies. */
  private query(tenantId: string, text: string, values?: unknown[]): Promise<pg.QueryResult> {
    return withPgTenant(
      this.pool,
      tenantId,
      (client) => client.query(text, values) as unknown as Promise<pg.QueryResult>,
    );
  }

  listGradeEntries(tenantId: string, filter?: ListGradeEntriesFilter) {
    return withSchemaCheck(async () => {
      const clauses = ['tenant_id = $1'];
      const params: unknown[] = [tenantId];
      if (filter?.sectionId) {
        params.push(filter.sectionId);
        clauses.push(`section_id = $${params.length}`);
      }
      if (filter?.studentId) {
        params.push(filter.studentId);
        clauses.push(`student_id = $${params.length}`);
      }
      const res = await this.query(
        tenantId,
        `SELECT * FROM grade_entries WHERE ${clauses.join(' AND ')} ORDER BY entered_at DESC`,
        params,
      );
      return (res.rows as Record<string, unknown>[]).map(mapEntry);
    });
  }

  findGradeEntry(
    tenantId: string,
    keys: { studentId: string; sectionId?: string | null; assessmentCode?: string | null },
  ) {
    return withSchemaCheck(async () => {
      const res = await this.query(
        tenantId,
        `SELECT * FROM grade_entries
         WHERE tenant_id = $1
           AND student_id = $2
           AND section_id IS NOT DISTINCT FROM $3
           AND assessment_code IS NOT DISTINCT FROM $4
         LIMIT 1`,
        [tenantId, keys.studentId, keys.sectionId ?? null, keys.assessmentCode ?? null],
      );
      const row = res.rows[0] as Record<string, unknown> | undefined;
      return row ? mapEntry(row) : null;
    });
  }

  getGradeEntry(tenantId: string, id: string) {
    return withSchemaCheck(async () => {
      const res = await this.query(
        tenantId,
        `SELECT * FROM grade_entries WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      const row = res.rows[0] as Record<string, unknown> | undefined;
      return row ? mapEntry(row) : null;
    });
  }

  createGradeEntry(row: GradeEntryEntity) {
    return withSchemaCheck(async () => {
      const res = await this.query(
        row.tenantId,
        `INSERT INTO grade_entries (
           id, tenant_id, section_id, student_id, assessment_code,
           numeric_score, letter_grade, entered_by, entered_at, locked_at, published_at,
           metadata, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14
         ) RETURNING *`,
        [
          row.id,
          row.tenantId,
          row.sectionId,
          row.studentId,
          row.assessmentCode,
          row.numericScore,
          row.letterGrade,
          row.enteredBy,
          row.enteredAt,
          row.lockedAt,
          row.publishedAt,
          JSON.stringify(row.metadata ?? {}),
          row.createdAt,
          row.updatedAt,
        ],
      );
      return mapEntry(res.rows[0] as Record<string, unknown>);
    });
  }

  updateGradeEntry(tenantId: string, id: string, patch: Partial<GradeEntryEntity>) {
    return withSchemaCheck(async () => {
      const cur = await this.getGradeEntry(tenantId, id);
      if (!cur) return null;
      const next = { ...cur, ...patch, id: cur.id, tenantId: cur.tenantId };
      const res = await this.query(
        tenantId,
        `UPDATE grade_entries SET
           section_id = $3,
           assessment_code = $4,
           numeric_score = $5,
           letter_grade = $6,
           entered_by = $7,
           entered_at = $8,
           locked_at = $9,
           published_at = $10,
           metadata = $11::jsonb,
           updated_at = $12
         WHERE tenant_id = $1 AND id = $2
         RETURNING *`,
        [
          tenantId,
          id,
          next.sectionId,
          next.assessmentCode,
          next.numericScore,
          next.letterGrade,
          next.enteredBy,
          next.enteredAt,
          next.lockedAt,
          next.publishedAt,
          JSON.stringify(next.metadata ?? {}),
          next.updatedAt ?? new Date().toISOString(),
        ],
      );
      return mapEntry(res.rows[0] as Record<string, unknown>);
    });
  }

  listCreditRules(tenantId: string, boardId?: string) {
    return withSchemaCheck(async () => {
      const params: unknown[] = [tenantId];
      let sql = `SELECT * FROM credit_rules WHERE tenant_id = $1 AND deleted_at IS NULL`;
      if (boardId) {
        params.push(boardId);
        sql += ` AND (board_id = $2 OR board_id IS NULL)`;
      }
      sql += ` ORDER BY code`;
      const res = await this.query(tenantId, sql, params);
      return (res.rows as Record<string, unknown>[]).map(mapCredit);
    });
  }

  getCreditRuleByCode(tenantId: string, code: string) {
    return withSchemaCheck(async () => {
      const res = await this.query(
        tenantId,
        `SELECT * FROM credit_rules WHERE tenant_id = $1 AND code = $2 AND deleted_at IS NULL`,
        [tenantId, code],
      );
      const row = res.rows[0] as Record<string, unknown> | undefined;
      return row ? mapCredit(row) : null;
    });
  }

  createCreditRule(row: CreditRuleEntity) {
    return withSchemaCheck(async () => {
      const res = await this.query(
        row.tenantId,
        `INSERT INTO credit_rules (
           id, tenant_id, board_id, code, name, credits, metadata, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
         RETURNING *`,
        [
          row.id,
          row.tenantId,
          row.boardId,
          row.code,
          row.name,
          row.credits,
          JSON.stringify(row.metadata ?? {}),
          row.createdAt,
          row.updatedAt,
        ],
      );
      return mapCredit(res.rows[0] as Record<string, unknown>);
    });
  }

  listGradingScales(tenantId: string, boardId?: string) {
    return withSchemaCheck(async () => {
      const params: unknown[] = [tenantId];
      let sql = `SELECT * FROM grading_scales WHERE tenant_id = $1 AND deleted_at IS NULL`;
      if (boardId) {
        params.push(boardId);
        sql += ` AND board_id = $2`;
      }
      sql += ` ORDER BY is_default DESC, code`;
      const scalesRes = await this.query(tenantId, sql, params);
      const scales: GradingScaleEntity[] = [];
      for (const raw of scalesRes.rows as Record<string, unknown>[]) {
        scales.push(await this.hydrateScale(raw));
      }
      return scales;
    });
  }

  getGradingScale(tenantId: string, id: string) {
    return withSchemaCheck(async () => {
      const res = await this.query(
        tenantId,
        `SELECT * FROM grading_scales WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [tenantId, id],
      );
      const row = res.rows[0] as Record<string, unknown> | undefined;
      return row ? this.hydrateScale(row) : null;
    });
  }

  getDefaultGradingScale(tenantId: string, boardId: string) {
    return withSchemaCheck(async () => {
      const res = await this.query(
        tenantId,
        `SELECT * FROM grading_scales
         WHERE tenant_id = $1 AND board_id = $2 AND deleted_at IS NULL
         ORDER BY is_default DESC, code
         LIMIT 1`,
        [tenantId, boardId],
      );
      const row = res.rows[0] as Record<string, unknown> | undefined;
      return row ? this.hydrateScale(row) : null;
    });
  }

  private async hydrateScale(row: Record<string, unknown>): Promise<GradingScaleEntity> {
    const bandsRes = await this.query(
      String(row.tenant_id),
      `SELECT label, min_percent, max_percent, grade_points, sort_order
       FROM grading_scale_bands
       WHERE grading_scale_id = $1
       ORDER BY sort_order`,
      [row.id],
    );
    const bands: GradeBand[] = (bandsRes.rows as Record<string, unknown>[]).map((b) => ({
      label: String(b.label),
      minPercent: Number(b.min_percent),
      maxPercent: Number(b.max_percent),
      gradePoints: num(b.grade_points),
    }));
    return {
      id: String(row.id),
      tenantId: String(row.tenant_id),
      boardId: String(row.board_id),
      code: String(row.code),
      name: String(row.name),
      scaleType: String(row.scale_type),
      isDefault: Boolean(row.is_default),
      bands,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    };
  }

  createGpaSnapshot(row: GpaSnapshotEntity) {
    return withSchemaCheck(async () => {
      const res = await this.query(
        row.tenantId,
        `INSERT INTO gpa_snapshots (
           id, tenant_id, student_id, academic_period_id,
           weighted_gpa, unweighted_gpa, credits_earned, computed_at, metadata, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
         RETURNING *`,
        [
          row.id,
          row.tenantId,
          row.studentId,
          row.academicPeriodId,
          row.weightedGpa,
          row.unweightedGpa,
          row.creditsEarned,
          row.computedAt,
          JSON.stringify(row.metadata ?? {}),
          row.createdAt,
        ],
      );
      return mapSnapshot(res.rows[0] as Record<string, unknown>);
    });
  }

  listGpaSnapshots(tenantId: string, studentId: string) {
    return withSchemaCheck(async () => {
      const res = await this.query(
        tenantId,
        `SELECT * FROM gpa_snapshots
         WHERE tenant_id = $1 AND student_id = $2
         ORDER BY computed_at DESC`,
        [tenantId, studentId],
      );
      return (res.rows as Record<string, unknown>[]).map(mapSnapshot);
    });
  }

  getGpaSnapshot(tenantId: string, id: string) {
    return withSchemaCheck(async () => {
      const res = await this.query(
        tenantId,
        `SELECT * FROM gpa_snapshots WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      const row = res.rows[0] as Record<string, unknown> | undefined;
      return row ? mapSnapshot(row) : null;
    });
  }

  listTranscripts(tenantId: string, filter?: ListTranscriptsFilter) {
    return withSchemaCheck(async () => {
      const params: unknown[] = [tenantId];
      let sql = `SELECT * FROM transcript_issuances WHERE tenant_id = $1`;
      if (filter?.studentId) {
        params.push(filter.studentId);
        sql += ` AND student_id = $2`;
      }
      sql += ` ORDER BY version DESC`;
      const res = await this.query(tenantId, sql, params);
      return (res.rows as Record<string, unknown>[]).map(mapTranscript);
    });
  }

  getTranscript(tenantId: string, id: string) {
    return withSchemaCheck(async () => {
      const res = await this.query(
        tenantId,
        `SELECT * FROM transcript_issuances WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      const row = res.rows[0] as Record<string, unknown> | undefined;
      return row ? mapTranscript(row) : null;
    });
  }

  getLatestTranscriptVersion(tenantId: string, studentId: string) {
    return withSchemaCheck(async () => {
      const res = await this.query(
        tenantId,
        `SELECT COALESCE(MAX(version), 0)::int AS max_version
         FROM transcript_issuances
         WHERE tenant_id = $1 AND student_id = $2`,
        [tenantId, studentId],
      );
      return Number((res.rows[0] as { max_version: number }).max_version ?? 0);
    });
  }

  createTranscript(row: TranscriptIssuanceEntity) {
    return withSchemaCheck(async () => {
      const res = await this.query(
        row.tenantId,
        `INSERT INTO transcript_issuances (
           id, tenant_id, student_id, version, status, issued_at, issued_by,
           artifact_uri, checksum_sha256, metadata, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5::transcript_status,$6,$7,$8,$9,$10::jsonb,$11,$12)
         RETURNING *`,
        [
          row.id,
          row.tenantId,
          row.studentId,
          row.version,
          row.status,
          row.issuedAt,
          row.issuedBy,
          row.artifactUri,
          row.checksumSha256,
          JSON.stringify(row.metadata ?? {}),
          row.createdAt,
          row.updatedAt,
        ],
      );
      return mapTranscript(res.rows[0] as Record<string, unknown>);
    });
  }

  createExportJob(row: ExportJobEntity) {
    return withSchemaCheck(async () => {
      const res = await this.query(
        row.tenantId,
        `INSERT INTO board_export_jobs (
           id, tenant_id, board_id, institution_id, job_type, status,
           requested_by, started_at, finished_at, artifact_uri, error_message,
           metadata, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6::export_job_status,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)
         RETURNING *`,
        [
          row.id,
          row.tenantId,
          row.boardId,
          row.institutionId,
          row.jobType,
          row.status,
          row.requestedBy,
          row.startedAt,
          row.finishedAt,
          row.artifactUri,
          row.errorMessage,
          JSON.stringify(row.metadata ?? {}),
          row.createdAt,
          row.updatedAt,
        ],
      );
      return mapJob(res.rows[0] as Record<string, unknown>);
    });
  }

  getExportJob(tenantId: string, id: string) {
    return withSchemaCheck(async () => {
      const res = await this.query(
        tenantId,
        `SELECT * FROM board_export_jobs WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      const row = res.rows[0] as Record<string, unknown> | undefined;
      return row ? mapJob(row) : null;
    });
  }

  updateExportJob(tenantId: string, id: string, patch: Partial<ExportJobEntity>) {
    return withSchemaCheck(async () => {
      const cur = await this.getExportJob(tenantId, id);
      if (!cur) return null;
      const next = { ...cur, ...patch, id: cur.id, tenantId: cur.tenantId };
      const res = await this.query(
        tenantId,
        `UPDATE board_export_jobs SET
           status = $3::export_job_status,
           started_at = $4,
           finished_at = $5,
           artifact_uri = $6,
           error_message = $7,
           metadata = $8::jsonb,
           updated_at = $9
         WHERE tenant_id = $1 AND id = $2
         RETURNING *`,
        [
          tenantId,
          id,
          next.status,
          next.startedAt,
          next.finishedAt,
          next.artifactUri,
          next.errorMessage,
          JSON.stringify(next.metadata ?? {}),
          next.updatedAt ?? new Date().toISOString(),
        ],
      );
      return mapJob(res.rows[0] as Record<string, unknown>);
    });
  }

  listExportJobs(tenantId: string, jobType?: string) {
    return withSchemaCheck(async () => {
      const params: unknown[] = [tenantId];
      let sql = `SELECT * FROM board_export_jobs WHERE tenant_id = $1`;
      if (jobType) {
        params.push(jobType);
        sql += ` AND job_type = $2`;
      }
      sql += ` ORDER BY created_at DESC`;
      const res = await this.query(tenantId, sql, params);
      return (res.rows as Record<string, unknown>[]).map(mapJob);
    });
  }

  listSections(tenantId: string, filter?: ListSectionsFilter) {
    return withSchemaCheck(async () => {
      const params: unknown[] = [tenantId];
      let sql = `SELECT id, tenant_id, institution_id, academic_period_id, code, name, status
                 FROM sections WHERE tenant_id = $1 AND deleted_at IS NULL`;
      if (filter?.institutionId) {
        params.push(filter.institutionId);
        sql += ` AND institution_id = $${params.length}`;
      }
      if (filter?.academicPeriodId) {
        params.push(filter.academicPeriodId);
        sql += ` AND academic_period_id = $${params.length}`;
      }
      sql += ` ORDER BY code`;
      const res = await this.query(tenantId, sql, params);
      return (res.rows as Record<string, unknown>[]).map(mapSection);
    });
  }

  getSection(tenantId: string, id: string) {
    return withSchemaCheck(async () => {
      const res = await this.query(
        tenantId,
        `SELECT id, tenant_id, institution_id, academic_period_id, code, name, status
         FROM sections WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [tenantId, id],
      );
      const row = res.rows[0] as Record<string, unknown> | undefined;
      return row ? mapSection(row) : null;
    });
  }

  getBoard(tenantId: string, id: string) {
    return withSchemaCheck(async () => {
      const res = await this.query(
        tenantId,
        `SELECT id, tenant_id, code, name FROM boards
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [tenantId, id],
      );
      const row = res.rows[0] as Record<string, unknown> | undefined;
      return row ? mapBoard(row) : null;
    });
  }

  getBoardByCode(tenantId: string, code: string) {
    return withSchemaCheck(async () => {
      const res = await this.query(
        tenantId,
        `SELECT id, tenant_id, code, name FROM boards
         WHERE tenant_id = $1 AND UPPER(code) = UPPER($2) AND deleted_at IS NULL`,
        [tenantId, code],
      );
      const row = res.rows[0] as Record<string, unknown> | undefined;
      return row ? mapBoard(row) : null;
    });
  }

  listBoards(tenantId: string) {
    return withSchemaCheck(async () => {
      const res = await this.query(
        tenantId,
        `SELECT id, tenant_id, code, name FROM boards
         WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY code`,
        [tenantId],
      );
      return (res.rows as Record<string, unknown>[]).map(mapBoard);
    });
  }

  getInstitution(tenantId: string, id: string) {
    return withSchemaCheck(async () => {
      const res = await this.query(
        tenantId,
        `SELECT id, tenant_id, board_id, code, name FROM institutions
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [tenantId, id],
      );
      const row = res.rows[0] as Record<string, unknown> | undefined;
      return row ? mapInstitution(row) : null;
    });
  }

  listInstitutionsByBoard(tenantId: string, boardId: string) {
    return withSchemaCheck(async () => {
      const res = await this.query(
        tenantId,
        `SELECT id, tenant_id, board_id, code, name FROM institutions
         WHERE tenant_id = $1 AND board_id = $2 AND deleted_at IS NULL
         ORDER BY code`,
        [tenantId, boardId],
      );
      return (res.rows as Record<string, unknown>[]).map(mapInstitution);
    });
  }

  listBoardCodes(tenantId: string, filter: { institutionId: string; boardId?: string }) {
    return withSchemaCheck(async () => {
      const params: unknown[] = [tenantId, filter.institutionId];
      let sql = `SELECT id, tenant_id, board_id, institution_id, code_type, code_value, label
                 FROM board_codes
                 WHERE tenant_id = $1 AND institution_id = $2`;
      if (filter.boardId) {
        params.push(filter.boardId);
        sql += ` AND board_id = $${params.length}`;
      }
      sql += ` ORDER BY code_type`;
      const res = await this.query(tenantId, sql, params);
      return (res.rows as Record<string, unknown>[]).map(mapBoardCode);
    });
  }

  listBoardExportCandidates(tenantId: string, filter: ListBoardExportCandidatesFilter) {
    return withSchemaCheck(async () => {
      const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
      const params: unknown[] = [tenantId, filter.institutionId];
      let sql = `
        SELECT s.id AS student_id, s.first_name, s.last_name, s.national_id,
               e.institution_id
        FROM enrollments e
        JOIN students s ON s.id = e.student_id AND s.tenant_id = e.tenant_id
        WHERE e.tenant_id = $1
          AND e.institution_id = $2
          AND e.status = 'ENROLLED'
          AND s.deleted_at IS NULL`;
      if (filter.studentIds && filter.studentIds.length > 0) {
        params.push(filter.studentIds);
        sql += ` AND s.id = ANY($${params.length}::uuid[])`;
      }
      sql += ` ORDER BY s.national_id NULLS LAST, s.last_name, s.first_name LIMIT $${params.length + 1}`;
      params.push(limit);

      const studentsRes = await this.query(tenantId, sql, params);
      const students = studentsRes.rows as Record<string, unknown>[];
      if (students.length === 0) return [];

      const studentIds = students.map((r) => String(r.student_id));
      const gradesRes = await this.query(
        tenantId,
        `SELECT student_id, assessment_code, numeric_score, letter_grade
         FROM grade_entries
         WHERE tenant_id = $1 AND student_id = ANY($2::uuid[])`,
        [tenantId, studentIds],
      );
      const transcriptsRes = await this.query(
        tenantId,
        `SELECT DISTINCT ON (student_id)
           student_id, version, checksum_sha256, issued_at
         FROM transcript_issuances
         WHERE tenant_id = $1 AND student_id = ANY($2::uuid[]) AND status = 'ISSUED'
         ORDER BY student_id, version DESC`,
        [tenantId, studentIds],
      );

      const gradesByStudent = new Map<string, BoardExportCandidate['grades']>();
      for (const row of gradesRes.rows as Record<string, unknown>[]) {
        const sid = String(row.student_id);
        const list = gradesByStudent.get(sid) ?? [];
        list.push({
          assessmentCode: row.assessment_code == null ? null : String(row.assessment_code),
          numericScore: num(row.numeric_score),
          letterGrade: row.letter_grade == null ? null : String(row.letter_grade),
        });
        gradesByStudent.set(sid, list);
      }

      const transcriptByStudent = new Map<
        string,
        NonNullable<BoardExportCandidate['latestTranscript']>
      >();
      for (const row of transcriptsRes.rows as Record<string, unknown>[]) {
        transcriptByStudent.set(String(row.student_id), {
          version: Number(row.version),
          checksumSha256: row.checksum_sha256 == null ? null : String(row.checksum_sha256),
          issuedAt: row.issued_at == null ? null : iso(row.issued_at),
        });
      }

      return students.map((row) => {
        const sid = String(row.student_id);
        return {
          studentId: sid,
          firstName: String(row.first_name),
          lastName: String(row.last_name),
          nationalId: row.national_id == null ? null : String(row.national_id),
          institutionId: String(row.institution_id),
          grades: gradesByStudent.get(sid) ?? [],
          latestTranscript: transcriptByStudent.get(sid) ?? null,
        };
      });
    });
  }
}

export function createPgGradebookRepository(pool?: PgPoolLike): PgGradebookRepository | null {
  const resolved = pool ?? getSharedGradebookPool();
  if (!resolved) return null;
  return new PgGradebookRepository(resolved);
}
