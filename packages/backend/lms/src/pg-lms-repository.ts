/**
 * Postgres-backed LMS repository (raw `pg` — no Prisma).
 *
 * When DATABASE_URL is set, rows persist via db/sql/026_lms_schema.sql and
 * every query runs inside withPgTenant so RLS (`app.tenant_id`) is bound.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PaginatedResult, PaginationOptions } from '@proctira/common';
import { withPgTenant, type PgQueryable } from '@proctira/database';
import pg from 'pg';

import type {
  AssignmentEntity,
  AssignmentFilter,
  AssignmentKind,
  AssignmentStatus,
  AttemptSource,
  LmsRepository,
  LmsScope,
  MasteryFilter,
  PracticeAttemptEntity,
  QuizQuestionEntity,
  ScopeFilter,
  SkillEntity,
  SkillFilter,
  SkillMasteryEntity,
  SubmissionAnswer,
  SubmissionEntity,
  SubmissionFilter,
  SubmissionStatus,
} from './lms-repository.js';

const { Pool } = pg;

export type PgPoolLike = Pick<pg.Pool, 'query' | 'end'> & Partial<Pick<pg.Pool, 'connect'>>;

let sharedPool: pg.Pool | null = null;
let schemaReady: Promise<void> | null = null;

function resolveDatabaseUrl(): string | null {
  const url = process.env.DATABASE_URL?.trim();
  return url && url.length > 0 ? url : null;
}

export function getSharedLmsPool(): pg.Pool | null {
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
    join(here, '../../../../db/sql/026_lms_schema.sql'),
    join(process.cwd(), 'db/sql/026_lms_schema.sql'),
    join(process.cwd(), '../../db/sql/026_lms_schema.sql'),
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

export async function ensureLmsSchema(pool: PgPoolLike = getSharedLmsPool()!): Promise<void> {
  if (!pool) throw new Error('DATABASE_URL is required for LMS schema ensure');
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

function toDateOrNull(value: unknown): Date | null {
  if (value == null) return null;
  return toDate(value);
}

function str(value: unknown): string | null {
  return value == null ? null : String(value);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function mapSkill(row: Record<string, unknown>): SkillEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    scope: String(row.scope) as LmsScope,
    boardId: str(row.board_id),
    institutionId: str(row.institution_id),
    code: String(row.code),
    name: String(row.name),
    subject: String(row.subject),
    gradeLevel: str(row.grade_level),
    description: str(row.description),
    prerequisiteSkillIds: parseJson<string[]>(row.prerequisite_skill_ids, []),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapAssignment(row: Record<string, unknown>): AssignmentEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    scope: String(row.scope) as LmsScope,
    boardId: str(row.board_id),
    institutionId: str(row.institution_id),
    kind: String(row.kind) as AssignmentKind,
    title: String(row.title),
    description: str(row.description),
    subject: String(row.subject),
    gradeLevel: str(row.grade_level),
    sectionId: str(row.section_id),
    skillIds: parseJson<string[]>(row.skill_ids, []),
    maxScore: Number(row.max_score),
    dueAt: toDateOrNull(row.due_at),
    timeLimitMinutes: row.time_limit_minutes == null ? null : Number(row.time_limit_minutes),
    allowLate: Boolean(row.allow_late),
    status: String(row.status) as AssignmentStatus,
    createdBy: str(row.created_by),
    publishedAt: toDateOrNull(row.published_at),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapQuestion(row: Record<string, unknown>): QuizQuestionEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    assignmentId: String(row.assignment_id),
    position: Number(row.position),
    prompt: String(row.prompt),
    options: parseJson<string[]>(row.options, []),
    correctOptionIndex: Number(row.correct_option_index),
    points: Number(row.points),
    skillId: str(row.skill_id),
    explanation: str(row.explanation),
    createdAt: toDate(row.created_at),
  };
}

function mapSubmission(row: Record<string, unknown>): SubmissionEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    assignmentId: String(row.assignment_id),
    studentId: String(row.student_id),
    institutionId: str(row.institution_id),
    status: String(row.status) as SubmissionStatus,
    content: str(row.content),
    attachments: parseJson<string[]>(row.attachments, []),
    answers: parseJson<SubmissionAnswer[]>(row.answers, []),
    score: row.score == null ? null : Number(row.score),
    autoGraded: Boolean(row.auto_graded),
    feedback: str(row.feedback),
    submittedAt: toDate(row.submitted_at),
    gradedAt: toDateOrNull(row.graded_at),
    gradedBy: str(row.graded_by),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapMastery(row: Record<string, unknown>): SkillMasteryEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    studentId: String(row.student_id),
    skillId: String(row.skill_id),
    institutionId: str(row.institution_id),
    mastery: Number(row.mastery),
    attempts: Number(row.attempts),
    correct: Number(row.correct),
    streak: Number(row.streak),
    intervalDays: Number(row.interval_days),
    dueAt: toDateOrNull(row.due_at),
    lastReviewedAt: toDateOrNull(row.last_reviewed_at),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapAttempt(row: Record<string, unknown>): PracticeAttemptEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    studentId: String(row.student_id),
    skillId: String(row.skill_id),
    source: String(row.source) as AttemptSource,
    sourceId: str(row.source_id),
    correct: Boolean(row.correct),
    responseTimeMs: row.response_time_ms == null ? null : Number(row.response_time_ms),
    masteryAfter: Number(row.mastery_after),
    createdAt: toDate(row.created_at),
  };
}

function paginateMeta(totalItems: number, pagination: PaginationOptions) {
  return {
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalItems,
    totalPages: Math.ceil(totalItems / pagination.pageSize) || 1,
  };
}

/**
 * Build the board/school visibility predicate. Rows are visible when they
 * belong to the caller's school or are board-shared for the caller's board.
 */
function scopeConditions(filter: ScopeFilter, params: unknown[]): string[] {
  const conditions: string[] = [];
  if (filter.scope) {
    params.push(filter.scope);
    conditions.push(`scope = $${params.length}`);
  }
  if (filter.institutionId || filter.boardId) {
    const ors: string[] = [];
    if (filter.institutionId) {
      params.push(filter.institutionId);
      ors.push(`(scope = 'school' AND institution_id = $${params.length})`);
    }
    if (filter.boardId) {
      params.push(filter.boardId);
      ors.push(`(scope = 'board' AND board_id = $${params.length})`);
    }
    conditions.push(`(${ors.join(' OR ')})`);
  }
  return conditions;
}

const ASSIGNMENT_COLUMNS: Record<string, string> = {
  title: 'title',
  description: 'description',
  subject: 'subject',
  gradeLevel: 'grade_level',
  sectionId: 'section_id',
  skillIds: 'skill_ids',
  maxScore: 'max_score',
  dueAt: 'due_at',
  timeLimitMinutes: 'time_limit_minutes',
  allowLate: 'allow_late',
  status: 'status',
  publishedAt: 'published_at',
};

const SUBMISSION_COLUMNS: Record<string, string> = {
  status: 'status',
  score: 'score',
  feedback: 'feedback',
  gradedAt: 'graded_at',
  gradedBy: 'graded_by',
  autoGraded: 'auto_graded',
};

export class PgLmsRepository implements LmsRepository {
  constructor(private readonly pool: PgPoolLike) {}

  async ensureSchema(): Promise<void> {
    await ensureLmsSchema(this.pool);
  }

  private withTenant<T>(tenantId: string, fn: (client: PgQueryable) => Promise<T>): Promise<T> {
    return withPgTenant(this.pool, tenantId, fn);
  }

  // ─── Skills ────────────────────────────────────────────────────────────

  async createSkill(data: Omit<SkillEntity, 'createdAt' | 'updatedAt'>): Promise<SkillEntity> {
    await this.ensureSchema();
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO lms_skills (
           id, tenant_id, scope, board_id, institution_id, code, name, subject,
           grade_level, description, prerequisite_skill_ids
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.scope,
          data.boardId,
          data.institutionId,
          data.code,
          data.name,
          data.subject,
          data.gradeLevel,
          data.description,
          JSON.stringify(data.prerequisiteSkillIds),
        ],
      );
      return mapSkill(result.rows[0] as Record<string, unknown>);
    });
  }

  async findSkillById(tenantId: string, id: string): Promise<SkillEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        'SELECT * FROM lms_skills WHERE tenant_id = $1 AND id = $2',
        [tenantId, id],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapSkill(row) : null;
    });
  }

  async findSkillsByIds(tenantId: string, ids: string[]): Promise<SkillEntity[]> {
    if (ids.length === 0) return [];
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        'SELECT * FROM lms_skills WHERE tenant_id = $1 AND id = ANY($2::uuid[]) ORDER BY code',
        [tenantId, ids],
      );
      return result.rows.map((row) => mapSkill(row as Record<string, unknown>));
    });
  }

  async listSkills(
    tenantId: string,
    filter: SkillFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<SkillEntity>> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const params: unknown[] = [tenantId];
      const conditions = ['tenant_id = $1', ...scopeConditions(filter, params)];
      if (filter.subject) {
        params.push(filter.subject);
        conditions.push(`subject = $${params.length}`);
      }
      if (filter.gradeLevel) {
        params.push(filter.gradeLevel);
        conditions.push(`grade_level = $${params.length}`);
      }
      if (filter.search) {
        params.push(`%${filter.search}%`);
        conditions.push(`(name ILIKE $${params.length} OR code ILIKE $${params.length})`);
      }
      const where = conditions.join(' AND ');
      const count = await client.query(
        `SELECT count(*)::int AS c FROM lms_skills WHERE ${where}`,
        params,
      );
      const totalItems = Number((count.rows[0] as { c: number }).c);
      params.push(pagination.pageSize, (pagination.page - 1) * pagination.pageSize);
      const result = await client.query(
        `SELECT * FROM lms_skills WHERE ${where} ORDER BY code
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return {
        data: result.rows.map((row) => mapSkill(row as Record<string, unknown>)),
        meta: paginateMeta(totalItems, pagination),
      };
    });
  }

  // ─── Assignments ───────────────────────────────────────────────────────

  async createAssignment(
    data: Omit<AssignmentEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<AssignmentEntity> {
    await this.ensureSchema();
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO lms_assignments (
           id, tenant_id, scope, board_id, institution_id, kind, title, description,
           subject, grade_level, section_id, skill_ids, max_score, due_at,
           time_limit_minutes, allow_late, status, created_by, published_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18,$19
         ) RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.scope,
          data.boardId,
          data.institutionId,
          data.kind,
          data.title,
          data.description,
          data.subject,
          data.gradeLevel,
          data.sectionId,
          JSON.stringify(data.skillIds),
          data.maxScore,
          data.dueAt,
          data.timeLimitMinutes,
          data.allowLate,
          data.status,
          data.createdBy,
          data.publishedAt,
        ],
      );
      return mapAssignment(result.rows[0] as Record<string, unknown>);
    });
  }

  async updateAssignment(
    tenantId: string,
    id: string,
    patch: Parameters<LmsRepository['updateAssignment']>[2],
  ): Promise<AssignmentEntity | null> {
    await this.ensureSchema();
    const sets: string[] = [];
    const params: unknown[] = [tenantId, id];
    for (const [key, column] of Object.entries(ASSIGNMENT_COLUMNS)) {
      if (!(key in patch)) continue;
      const value = (patch as Record<string, unknown>)[key];
      params.push(key === 'skillIds' ? JSON.stringify(value ?? []) : value);
      sets.push(`${column} = $${params.length}${key === 'skillIds' ? '::jsonb' : ''}`);
    }
    if (sets.length === 0) return this.findAssignmentById(tenantId, id);
    sets.push('updated_at = now()');
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `UPDATE lms_assignments SET ${sets.join(', ')}
         WHERE tenant_id = $1 AND id = $2 RETURNING *`,
        params,
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapAssignment(row) : null;
    });
  }

  async findAssignmentById(tenantId: string, id: string): Promise<AssignmentEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        'SELECT * FROM lms_assignments WHERE tenant_id = $1 AND id = $2',
        [tenantId, id],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapAssignment(row) : null;
    });
  }

  async listAssignments(
    tenantId: string,
    filter: AssignmentFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<AssignmentEntity>> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const params: unknown[] = [tenantId];
      const conditions = ['tenant_id = $1', ...scopeConditions(filter, params)];
      const eq: Array<[keyof AssignmentFilter, string]> = [
        ['kind', 'kind'],
        ['status', 'status'],
        ['subject', 'subject'],
        ['gradeLevel', 'grade_level'],
        ['sectionId', 'section_id'],
      ];
      for (const [key, column] of eq) {
        const value = filter[key];
        if (value !== undefined && value !== null && value !== '') {
          params.push(value);
          conditions.push(`${column} = $${params.length}`);
        }
      }
      if (filter.search) {
        params.push(`%${filter.search}%`);
        conditions.push(`title ILIKE $${params.length}`);
      }
      if (filter.dueBefore) {
        params.push(filter.dueBefore);
        conditions.push(`due_at <= $${params.length}`);
      }
      if (filter.dueAfter) {
        params.push(filter.dueAfter);
        conditions.push(`due_at >= $${params.length}`);
      }
      const where = conditions.join(' AND ');
      const count = await client.query(
        `SELECT count(*)::int AS c FROM lms_assignments WHERE ${where}`,
        params,
      );
      const totalItems = Number((count.rows[0] as { c: number }).c);
      params.push(pagination.pageSize, (pagination.page - 1) * pagination.pageSize);
      const result = await client.query(
        `SELECT * FROM lms_assignments WHERE ${where} ORDER BY created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return {
        data: result.rows.map((row) => mapAssignment(row as Record<string, unknown>)),
        meta: paginateMeta(totalItems, pagination),
      };
    });
  }

  async deleteAssignment(tenantId: string, id: string): Promise<boolean> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        'DELETE FROM lms_assignments WHERE tenant_id = $1 AND id = $2',
        [tenantId, id],
      );
      return Number((result as { rowCount?: number | null }).rowCount ?? 0) > 0;
    });
  }

  // ─── Quiz questions ────────────────────────────────────────────────────

  async replaceQuestions(
    tenantId: string,
    assignmentId: string,
    questions: Omit<QuizQuestionEntity, 'createdAt'>[],
  ): Promise<QuizQuestionEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      await client.query(
        'DELETE FROM lms_quiz_questions WHERE tenant_id = $1 AND assignment_id = $2',
        [tenantId, assignmentId],
      );
      const rows: QuizQuestionEntity[] = [];
      for (const q of questions) {
        const result = await client.query(
          `INSERT INTO lms_quiz_questions (
             id, tenant_id, assignment_id, position, prompt, options,
             correct_option_index, points, skill_id, explanation
           ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10) RETURNING *`,
          [
            q.id,
            tenantId,
            assignmentId,
            q.position,
            q.prompt,
            JSON.stringify(q.options),
            q.correctOptionIndex,
            q.points,
            q.skillId,
            q.explanation,
          ],
        );
        rows.push(mapQuestion(result.rows[0] as Record<string, unknown>));
      }
      return rows;
    });
  }

  async listQuestions(tenantId: string, assignmentId: string): Promise<QuizQuestionEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM lms_quiz_questions
         WHERE tenant_id = $1 AND assignment_id = $2 ORDER BY position`,
        [tenantId, assignmentId],
      );
      return result.rows.map((row) => mapQuestion(row as Record<string, unknown>));
    });
  }

  // ─── Submissions ───────────────────────────────────────────────────────

  async createSubmission(
    data: Omit<SubmissionEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<SubmissionEntity> {
    await this.ensureSchema();
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO lms_submissions (
           id, tenant_id, assignment_id, student_id, institution_id, status, content,
           attachments, answers, score, auto_graded, feedback, submitted_at, graded_at, graded_by
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15
         ) RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.assignmentId,
          data.studentId,
          data.institutionId,
          data.status,
          data.content,
          JSON.stringify(data.attachments),
          JSON.stringify(data.answers),
          data.score,
          data.autoGraded,
          data.feedback,
          data.submittedAt,
          data.gradedAt,
          data.gradedBy,
        ],
      );
      return mapSubmission(result.rows[0] as Record<string, unknown>);
    });
  }

  async updateSubmission(
    tenantId: string,
    id: string,
    patch: Parameters<LmsRepository['updateSubmission']>[2],
  ): Promise<SubmissionEntity | null> {
    await this.ensureSchema();
    const sets: string[] = [];
    const params: unknown[] = [tenantId, id];
    for (const [key, column] of Object.entries(SUBMISSION_COLUMNS)) {
      if (!(key in patch)) continue;
      params.push((patch as Record<string, unknown>)[key]);
      sets.push(`${column} = $${params.length}`);
    }
    if (sets.length === 0) return this.findSubmissionById(tenantId, id);
    sets.push('updated_at = now()');
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `UPDATE lms_submissions SET ${sets.join(', ')}
         WHERE tenant_id = $1 AND id = $2 RETURNING *`,
        params,
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapSubmission(row) : null;
    });
  }

  async findSubmissionById(tenantId: string, id: string): Promise<SubmissionEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        'SELECT * FROM lms_submissions WHERE tenant_id = $1 AND id = $2',
        [tenantId, id],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapSubmission(row) : null;
    });
  }

  async findSubmission(
    tenantId: string,
    assignmentId: string,
    studentId: string,
  ): Promise<SubmissionEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM lms_submissions
         WHERE tenant_id = $1 AND assignment_id = $2 AND student_id = $3`,
        [tenantId, assignmentId, studentId],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapSubmission(row) : null;
    });
  }

  async listSubmissions(
    tenantId: string,
    filter: SubmissionFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<SubmissionEntity>> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const params: unknown[] = [tenantId];
      const conditions = ['tenant_id = $1'];
      if (filter.assignmentId) {
        params.push(filter.assignmentId);
        conditions.push(`assignment_id = $${params.length}`);
      }
      if (filter.studentId) {
        params.push(filter.studentId);
        conditions.push(`student_id = $${params.length}`);
      }
      if (filter.status) {
        params.push(filter.status);
        conditions.push(`status = $${params.length}`);
      }
      const where = conditions.join(' AND ');
      const count = await client.query(
        `SELECT count(*)::int AS c FROM lms_submissions WHERE ${where}`,
        params,
      );
      const totalItems = Number((count.rows[0] as { c: number }).c);
      params.push(pagination.pageSize, (pagination.page - 1) * pagination.pageSize);
      const result = await client.query(
        `SELECT * FROM lms_submissions WHERE ${where} ORDER BY submitted_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return {
        data: result.rows.map((row) => mapSubmission(row as Record<string, unknown>)),
        meta: paginateMeta(totalItems, pagination),
      };
    });
  }

  // ─── Spiral PAL ledger ─────────────────────────────────────────────────

  async upsertMastery(
    data: Omit<SkillMasteryEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<SkillMasteryEntity> {
    await this.ensureSchema();
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO lms_skill_mastery (
           id, tenant_id, student_id, skill_id, institution_id, mastery, attempts, correct,
           streak, interval_days, due_at, last_reviewed_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (tenant_id, student_id, skill_id) DO UPDATE SET
           institution_id = COALESCE(EXCLUDED.institution_id, lms_skill_mastery.institution_id),
           mastery = EXCLUDED.mastery,
           attempts = EXCLUDED.attempts,
           correct = EXCLUDED.correct,
           streak = EXCLUDED.streak,
           interval_days = EXCLUDED.interval_days,
           due_at = EXCLUDED.due_at,
           last_reviewed_at = EXCLUDED.last_reviewed_at,
           updated_at = now()
         RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.studentId,
          data.skillId,
          data.institutionId,
          data.mastery,
          data.attempts,
          data.correct,
          data.streak,
          data.intervalDays,
          data.dueAt,
          data.lastReviewedAt,
        ],
      );
      return mapMastery(result.rows[0] as Record<string, unknown>);
    });
  }

  async findMastery(
    tenantId: string,
    studentId: string,
    skillId: string,
  ): Promise<SkillMasteryEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM lms_skill_mastery
         WHERE tenant_id = $1 AND student_id = $2 AND skill_id = $3`,
        [tenantId, studentId, skillId],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapMastery(row) : null;
    });
  }

  async listMastery(tenantId: string, filter: MasteryFilter): Promise<SkillMasteryEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const params: unknown[] = [tenantId, filter.studentId];
      const conditions = ['tenant_id = $1', 'student_id = $2'];
      if (filter.skillIds && filter.skillIds.length > 0) {
        params.push(filter.skillIds);
        conditions.push(`skill_id = ANY($${params.length}::uuid[])`);
      }
      if (filter.dueBefore) {
        params.push(filter.dueBefore);
        conditions.push(`due_at <= $${params.length}`);
      }
      const result = await client.query(
        `SELECT * FROM lms_skill_mastery WHERE ${conditions.join(' AND ')} ORDER BY due_at NULLS LAST`,
        params,
      );
      return result.rows.map((row) => mapMastery(row as Record<string, unknown>));
    });
  }

  async recordAttempt(
    data: Omit<PracticeAttemptEntity, 'createdAt'>,
  ): Promise<PracticeAttemptEntity> {
    await this.ensureSchema();
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO lms_practice_attempts (
           id, tenant_id, student_id, skill_id, source, source_id, correct,
           response_time_ms, mastery_after
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.studentId,
          data.skillId,
          data.source,
          data.sourceId,
          data.correct,
          data.responseTimeMs,
          data.masteryAfter,
        ],
      );
      return mapAttempt(result.rows[0] as Record<string, unknown>);
    });
  }

  async listAttempts(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<PracticeAttemptEntity>> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const count = await client.query(
        `SELECT count(*)::int AS c FROM lms_practice_attempts
         WHERE tenant_id = $1 AND student_id = $2`,
        [tenantId, studentId],
      );
      const totalItems = Number((count.rows[0] as { c: number }).c);
      const result = await client.query(
        `SELECT * FROM lms_practice_attempts
         WHERE tenant_id = $1 AND student_id = $2
         ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
        [tenantId, studentId, pagination.pageSize, (pagination.page - 1) * pagination.pageSize],
      );
      return {
        data: result.rows.map((row) => mapAttempt(row as Record<string, unknown>)),
        meta: paginateMeta(totalItems, pagination),
      };
    });
  }
}
