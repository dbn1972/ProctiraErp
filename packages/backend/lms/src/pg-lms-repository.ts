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

import type { QuestionType } from './grading-engine.js';
import type {
  AssignmentEntity,
  AssignmentFileEntity,
  AssignmentFilter,
  AssignmentKind,
  AssignmentStatus,
  AttemptSource,
  BankQuestionEntity,
  BankQuestionFilter,
  ContentItemEntity,
  DiscussionEntity,
  DiscussionPostEntity,
  LessonEntity,
  LessonResourceEntity,
  LmsModuleEntity,
  LmsModuleItemEntity,
  LmsRepository,
  LmsScope,
  MasteryFilter,
  PracticeAttemptEntity,
  QuizQuestionEntity,
  RubricCriterionEntity,
  RubricEntity,
  RubricLevel,
  RubricScoreEntity,
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

function schemaSqlPath(file: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, `../../../../db/sql/${file}`),
    join(process.cwd(), `db/sql/${file}`),
    join(process.cwd(), `../../db/sql/${file}`),
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
      await pool.query(readFileSync(schemaSqlPath('026_lms_schema.sql'), 'utf8'));
      await pool.query(readFileSync(schemaSqlPath('038_lms_depth_schema.sql'), 'utf8'));
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
    academicPeriodId: str(row.academic_period_id),
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
    correctOptionIndex: row.correct_option_index == null ? -1 : Number(row.correct_option_index),
    points: Number(row.points),
    skillId: str(row.skill_id),
    explanation: str(row.explanation),
    createdAt: toDate(row.created_at),
    questionType: (str(row.question_type) as QuestionType | null) ?? 'mcq',
    bankId: str(row.bank_item_id) ?? str(row.bank_id),
    payload: parseJson<Record<string, unknown>>(row.payload, {}),
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

function mapBank(row: Record<string, unknown>): BankQuestionEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    scope: String(row.scope) as LmsScope,
    boardId: str(row.board_id),
    institutionId: str(row.institution_id),
    subject: String(row.subject),
    gradeLevel: str(row.grade_level),
    tags: parseJson<string[]>(row.tags, []),
    questionType: String(row.question_type) as QuestionType,
    prompt: String(row.prompt),
    payload: parseJson<Record<string, unknown>>(row.payload, {}),
    points: Number(row.points),
    skillId: str(row.skill_id),
    rubricId: str(row.rubric_id),
    difficulty: (str(row.difficulty) as BankQuestionEntity['difficulty'] | null) ?? 'medium',
    createdBy: str(row.created_by),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapRubric(row: Record<string, unknown>): RubricEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    scope: String(row.scope) as LmsScope,
    boardId: str(row.board_id),
    institutionId: str(row.institution_id),
    name: String(row.name),
    subject: str(row.subject),
    gradeLevel: str(row.grade_level),
    createdBy: str(row.created_by),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapCriterion(row: Record<string, unknown>): RubricCriterionEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    rubricId: String(row.rubric_id),
    position: Number(row.position),
    name: String(row.name),
    description: str(row.description),
    maxPoints: Number(row.max_points),
    levels: parseJson<RubricLevel[]>(row.levels, []),
  };
}

function mapRubricScore(row: Record<string, unknown>): RubricScoreEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    submissionId: String(row.submission_id),
    criterionId: String(row.criterion_id),
    questionId: str(row.question_id),
    levelIndex: Number(row.level_index),
    points: Number(row.points),
    comment: str(row.comment),
    scoredBy: str(row.scored_by),
    scoredAt: toDate(row.scored_at),
  };
}

function mapFile(row: Record<string, unknown>): AssignmentFileEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    assignmentId: String(row.assignment_id),
    submissionId: str(row.submission_id),
    filename: String(row.filename),
    mimeType: String(row.mime_type),
    byteSize: Number(row.byte_size),
    storageKey: String(row.object_key ?? row.storage_key),
    createdBy: str(row.created_by),
    createdAt: toDate(row.created_at),
  };
}

function mapDiscussion(row: Record<string, unknown>): DiscussionEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    institutionId: str(row.institution_id),
    classKey: String(row.class_key),
    title: String(row.title),
    locked: Boolean(row.locked),
    createdBy: str(row.created_by),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapPost(row: Record<string, unknown>): DiscussionPostEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    discussionId: String(row.thread_id ?? row.discussion_id),
    parentId: str(row.parent_id),
    body: String(row.body),
    pinned: Boolean(row.pinned),
    hidden: Boolean(row.hidden),
    createdBy: str(row.created_by),
    createdAt: toDate(row.created_at),
  };
}

function mapLesson(row: Record<string, unknown>): LessonEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    scope: String(row.scope) as LmsScope,
    boardId: str(row.board_id),
    institutionId: str(row.institution_id),
    title: String(row.title),
    subject: str(row.subject),
    gradeLevel: str(row.grade_level),
    description: str(row.description),
    published: Boolean(row.published),
    createdBy: str(row.created_by),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapLessonResource(row: Record<string, unknown>): LessonResourceEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    lessonId: String(row.lesson_id),
    kind: String(row.kind) as LessonResourceEntity['kind'],
    title: String(row.title),
    url: str(row.url),
    storageKey: str(row.storage_key),
    mimeType: str(row.mime_type),
    position: Number(row.position),
    createdAt: toDate(row.created_at),
  };
}

function mapContent(row: Record<string, unknown>): ContentItemEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    scope: String(row.scope) as LmsScope,
    boardId: str(row.board_id),
    institutionId: str(row.institution_id),
    title: String(row.title),
    kind: String(row.kind) as ContentItemEntity['kind'],
    body: str(row.body),
    tags: parseJson<string[]>(row.tags, []),
    classKey: str(row.class_key),
    subject: str(row.subject),
    objectKey: str(row.object_key),
    mimeType: str(row.mime_type),
    published: Boolean(row.published),
    createdBy: str(row.created_by),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
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
           subject, grade_level, section_id, academic_period_id, skill_ids, max_score, due_at,
           time_limit_minutes, allow_late, status, created_by, published_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,$18,$19,$20
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
          data.academicPeriodId,
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
        ['academicPeriodId', 'academic_period_id'],
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
             correct_option_index, points, skill_id, explanation,
             question_type, bank_item_id, payload
           ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13::jsonb) RETURNING *`,
          [
            q.id,
            tenantId,
            assignmentId,
            q.position,
            q.prompt,
            JSON.stringify(q.options),
            q.correctOptionIndex < 0 ? null : q.correctOptionIndex,
            q.points,
            q.skillId,
            q.explanation,
            q.questionType ?? 'mcq',
            q.bankId ?? null,
            JSON.stringify(q.payload ?? {}),
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

  async createBankQuestion(
    data: Omit<BankQuestionEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<BankQuestionEntity> {
    await this.ensureSchema();
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO lms_question_bank (
           id, tenant_id, scope, board_id, institution_id, subject, grade_level, tags,
           question_type, difficulty, prompt, payload, points, skill_id, rubric_id, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12::jsonb,$13,$14,$15,$16) RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.scope,
          data.boardId,
          data.institutionId,
          data.subject,
          data.gradeLevel,
          JSON.stringify(data.tags),
          data.questionType,
          data.difficulty,
          data.prompt,
          JSON.stringify(data.payload),
          data.points,
          data.skillId,
          data.rubricId,
          data.createdBy,
        ],
      );
      return mapBank(result.rows[0] as Record<string, unknown>);
    });
  }

  async updateBankQuestion(
    tenantId: string,
    id: string,
    patch: Parameters<LmsRepository['updateBankQuestion']>[2],
  ): Promise<BankQuestionEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const existing = await this.findBankQuestion(tenantId, id);
      if (!existing) return null;
      const next = { ...existing, ...patch };
      const result = await client.query(
        `UPDATE lms_question_bank SET
           subject=$3, grade_level=$4, tags=$5::jsonb, question_type=$6, prompt=$7,
           payload=$8::jsonb, points=$9, skill_id=$10, rubric_id=$11, updated_at=now()
         WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [
          tenantId,
          id,
          next.subject,
          next.gradeLevel,
          JSON.stringify(next.tags),
          next.questionType,
          next.prompt,
          JSON.stringify(next.payload),
          next.points,
          next.skillId,
          next.rubricId,
        ],
      );
      return result.rows[0] ? mapBank(result.rows[0] as Record<string, unknown>) : null;
    });
  }

  async findBankQuestion(tenantId: string, id: string): Promise<BankQuestionEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        'SELECT * FROM lms_question_bank WHERE tenant_id=$1 AND id=$2',
        [tenantId, id],
      );
      return result.rows[0] ? mapBank(result.rows[0] as Record<string, unknown>) : null;
    });
  }

  async findBankQuestionsByIds(tenantId: string, ids: string[]): Promise<BankQuestionEntity[]> {
    if (ids.length === 0) return [];
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        'SELECT * FROM lms_question_bank WHERE tenant_id=$1 AND id = ANY($2::uuid[])',
        [tenantId, ids],
      );
      return result.rows.map((row) => mapBank(row as Record<string, unknown>));
    });
  }

  async listBankQuestions(
    tenantId: string,
    filter: BankQuestionFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<BankQuestionEntity>> {
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
      if (filter.questionType) {
        params.push(filter.questionType);
        conditions.push(`question_type = $${params.length}`);
      }
      if (filter.tags && filter.tags.length > 0) {
        params.push(filter.tags);
        conditions.push(
          `EXISTS (SELECT 1 FROM jsonb_array_elements_text(tags) AS t(tag) WHERE t.tag = ANY($${params.length}::text[]))`,
        );
      }
      if (filter.search) {
        params.push(`%${filter.search.toLowerCase()}%`);
        conditions.push(`(lower(prompt) LIKE $${params.length})`);
      }
      const where = conditions.join(' AND ');
      const count = await client.query(
        `SELECT count(*)::int AS c FROM lms_question_bank WHERE ${where}`,
        params,
      );
      const totalItems = Number((count.rows[0] as { c: number }).c);
      params.push(pagination.pageSize, (pagination.page - 1) * pagination.pageSize);
      const result = await client.query(
        `SELECT * FROM lms_question_bank WHERE ${where}
         ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return {
        data: result.rows.map((row) => mapBank(row as Record<string, unknown>)),
        meta: paginateMeta(totalItems, pagination),
      };
    });
  }

  async deleteBankQuestion(tenantId: string, id: string): Promise<boolean> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        'DELETE FROM lms_question_bank WHERE tenant_id=$1 AND id=$2',
        [tenantId, id],
      );
      return Number((result as { rowCount?: number | null }).rowCount ?? 0) > 0;
    });
  }

  async createRubric(data: Omit<RubricEntity, 'createdAt' | 'updatedAt'>): Promise<RubricEntity> {
    await this.ensureSchema();
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO lms_rubrics (
           id, tenant_id, scope, board_id, institution_id, name, subject, grade_level, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.scope,
          data.boardId,
          data.institutionId,
          data.name,
          data.subject,
          data.gradeLevel,
          data.createdBy,
        ],
      );
      return mapRubric(result.rows[0] as Record<string, unknown>);
    });
  }

  async findRubric(tenantId: string, id: string): Promise<RubricEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query('SELECT * FROM lms_rubrics WHERE tenant_id=$1 AND id=$2', [
        tenantId,
        id,
      ]);
      return result.rows[0] ? mapRubric(result.rows[0] as Record<string, unknown>) : null;
    });
  }

  async listRubrics(
    tenantId: string,
    filter: ScopeFilter & { subject?: string },
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<RubricEntity>> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const params: unknown[] = [tenantId];
      const conditions = ['tenant_id = $1', ...scopeConditions(filter, params)];
      if (filter.subject) {
        params.push(filter.subject);
        conditions.push(`subject = $${params.length}`);
      }
      const where = conditions.join(' AND ');
      const count = await client.query(
        `SELECT count(*)::int AS c FROM lms_rubrics WHERE ${where}`,
        params,
      );
      const totalItems = Number((count.rows[0] as { c: number }).c);
      params.push(pagination.pageSize, (pagination.page - 1) * pagination.pageSize);
      const result = await client.query(
        `SELECT * FROM lms_rubrics WHERE ${where}
         ORDER BY name LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return {
        data: result.rows.map((row) => mapRubric(row as Record<string, unknown>)),
        meta: paginateMeta(totalItems, pagination),
      };
    });
  }

  async replaceRubricCriteria(
    tenantId: string,
    rubricId: string,
    criteria: Omit<RubricCriterionEntity, 'createdAt'>[],
  ): Promise<RubricCriterionEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      await client.query('DELETE FROM lms_rubric_criteria WHERE tenant_id=$1 AND rubric_id=$2', [
        tenantId,
        rubricId,
      ]);
      const rows: RubricCriterionEntity[] = [];
      for (const c of criteria) {
        const result = await client.query(
          `INSERT INTO lms_rubric_criteria (
             id, tenant_id, rubric_id, position, name, description, max_points, levels
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING *`,
          [
            c.id,
            tenantId,
            rubricId,
            c.position,
            c.name,
            c.description,
            c.maxPoints,
            JSON.stringify(c.levels),
          ],
        );
        rows.push(mapCriterion(result.rows[0] as Record<string, unknown>));
      }
      return rows;
    });
  }

  async listRubricCriteria(tenantId: string, rubricId: string): Promise<RubricCriterionEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM lms_rubric_criteria WHERE tenant_id=$1 AND rubric_id=$2 ORDER BY position`,
        [tenantId, rubricId],
      );
      return result.rows.map((row) => mapCriterion(row as Record<string, unknown>));
    });
  }

  async replaceRubricScores(
    tenantId: string,
    submissionId: string,
    scores: Omit<RubricScoreEntity, 'scoredAt'>[],
  ): Promise<RubricScoreEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      await client.query('DELETE FROM lms_rubric_scores WHERE tenant_id=$1 AND submission_id=$2', [
        tenantId,
        submissionId,
      ]);
      const rows: RubricScoreEntity[] = [];
      for (const s of scores) {
        const result = await client.query(
          `INSERT INTO lms_rubric_scores (
             id, tenant_id, submission_id, criterion_id, question_id, level_index, points, comment, scored_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [
            s.id,
            tenantId,
            submissionId,
            s.criterionId,
            s.questionId,
            s.levelIndex,
            s.points,
            s.comment,
            s.scoredBy,
          ],
        );
        rows.push(mapRubricScore(result.rows[0] as Record<string, unknown>));
      }
      return rows;
    });
  }

  async listRubricScores(tenantId: string, submissionId: string): Promise<RubricScoreEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        'SELECT * FROM lms_rubric_scores WHERE tenant_id=$1 AND submission_id=$2',
        [tenantId, submissionId],
      );
      return result.rows.map((row) => mapRubricScore(row as Record<string, unknown>));
    });
  }

  async createAssignmentFile(
    data: Omit<AssignmentFileEntity, 'createdAt'>,
  ): Promise<AssignmentFileEntity> {
    await this.ensureSchema();
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO lms_assignment_files (
           id, tenant_id, assignment_id, submission_id, filename, mime_type, byte_size, storage_key, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.assignmentId,
          data.submissionId,
          data.filename,
          data.mimeType,
          data.byteSize,
          data.storageKey,
          data.createdBy,
        ],
      );
      return mapFile(result.rows[0] as Record<string, unknown>);
    });
  }

  async findAssignmentFile(tenantId: string, id: string): Promise<AssignmentFileEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        'SELECT * FROM lms_assignment_files WHERE tenant_id=$1 AND id=$2',
        [tenantId, id],
      );
      return result.rows[0] ? mapFile(result.rows[0] as Record<string, unknown>) : null;
    });
  }

  async listAssignmentFiles(
    tenantId: string,
    assignmentId: string,
    submissionId?: string | null,
  ): Promise<AssignmentFileEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const params: unknown[] = [tenantId, assignmentId];
      let extra = '';
      if (submissionId === null) extra = ' AND submission_id IS NULL';
      else if (submissionId !== undefined) {
        params.push(submissionId);
        extra = ` AND submission_id = $${params.length}`;
      }
      const result = await client.query(
        `SELECT * FROM lms_assignment_files WHERE tenant_id=$1 AND assignment_id=$2${extra}
         ORDER BY created_at`,
        params,
      );
      return result.rows.map((row) => mapFile(row as Record<string, unknown>));
    });
  }

  async createDiscussion(
    data: Omit<DiscussionEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<DiscussionEntity> {
    await this.ensureSchema();
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO lms_discussions (
           id, tenant_id, institution_id, class_key, title, locked, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.institutionId,
          data.classKey,
          data.title,
          data.locked,
          data.createdBy,
        ],
      );
      return mapDiscussion(result.rows[0] as Record<string, unknown>);
    });
  }

  async findDiscussion(tenantId: string, id: string): Promise<DiscussionEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        'SELECT * FROM lms_discussions WHERE tenant_id=$1 AND id=$2',
        [tenantId, id],
      );
      return result.rows[0] ? mapDiscussion(result.rows[0] as Record<string, unknown>) : null;
    });
  }

  async listDiscussions(
    tenantId: string,
    filter: { institutionId?: string; classKey?: string },
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<DiscussionEntity>> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const params: unknown[] = [tenantId];
      const conditions = ['tenant_id = $1'];
      if (filter.institutionId) {
        params.push(filter.institutionId);
        conditions.push(`institution_id = $${params.length}`);
      }
      if (filter.classKey) {
        params.push(filter.classKey);
        conditions.push(`class_key = $${params.length}`);
      }
      const where = conditions.join(' AND ');
      const count = await client.query(
        `SELECT count(*)::int AS c FROM lms_discussions WHERE ${where}`,
        params,
      );
      const totalItems = Number((count.rows[0] as { c: number }).c);
      params.push(pagination.pageSize, (pagination.page - 1) * pagination.pageSize);
      const result = await client.query(
        `SELECT * FROM lms_discussions WHERE ${where}
         ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return {
        data: result.rows.map((row) => mapDiscussion(row as Record<string, unknown>)),
        meta: paginateMeta(totalItems, pagination),
      };
    });
  }

  async setDiscussionLocked(
    tenantId: string,
    id: string,
    locked: boolean,
  ): Promise<DiscussionEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `UPDATE lms_discussions SET locked=$3, updated_at=now()
         WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [tenantId, id, locked],
      );
      return result.rows[0] ? mapDiscussion(result.rows[0] as Record<string, unknown>) : null;
    });
  }

  async createDiscussionPost(
    data: Omit<DiscussionPostEntity, 'createdAt'>,
  ): Promise<DiscussionPostEntity> {
    await this.ensureSchema();
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO lms_discussion_posts (
           id, tenant_id, discussion_id, parent_id, body, hidden, pinned, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.discussionId,
          data.parentId,
          data.body,
          data.hidden,
          data.pinned,
          data.createdBy,
        ],
      );
      return mapPost(result.rows[0] as Record<string, unknown>);
    });
  }

  async findDiscussionPost(tenantId: string, id: string): Promise<DiscussionPostEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        'SELECT * FROM lms_discussion_posts WHERE tenant_id=$1 AND id=$2',
        [tenantId, id],
      );
      return result.rows[0] ? mapPost(result.rows[0] as Record<string, unknown>) : null;
    });
  }

  async listDiscussionPosts(
    tenantId: string,
    discussionId: string,
  ): Promise<DiscussionPostEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM lms_discussion_posts WHERE tenant_id=$1 AND discussion_id=$2
         ORDER BY pinned DESC, created_at ASC`,
        [tenantId, discussionId],
      );
      return result.rows.map((row) => mapPost(row as Record<string, unknown>));
    });
  }

  async setPostPinned(
    tenantId: string,
    postId: string,
    pinned: boolean,
  ): Promise<DiscussionPostEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `UPDATE lms_discussion_posts SET pinned=$3 WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [tenantId, postId, pinned],
      );
      return result.rows[0] ? mapPost(result.rows[0] as Record<string, unknown>) : null;
    });
  }

  async setPostHidden(
    tenantId: string,
    postId: string,
    hidden: boolean,
  ): Promise<DiscussionPostEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `UPDATE lms_discussion_posts SET hidden=$3 WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [tenantId, postId, hidden],
      );
      return result.rows[0] ? mapPost(result.rows[0] as Record<string, unknown>) : null;
    });
  }

  async createLesson(data: Omit<LessonEntity, 'createdAt' | 'updatedAt'>): Promise<LessonEntity> {
    await this.ensureSchema();
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO lms_lessons (
           id, tenant_id, scope, board_id, institution_id, title, subject, grade_level,
           description, published, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.scope,
          data.boardId,
          data.institutionId,
          data.title,
          data.subject,
          data.gradeLevel,
          data.description,
          data.published,
          data.createdBy,
        ],
      );
      return mapLesson(result.rows[0] as Record<string, unknown>);
    });
  }

  async findLesson(tenantId: string, id: string): Promise<LessonEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query('SELECT * FROM lms_lessons WHERE tenant_id=$1 AND id=$2', [
        tenantId,
        id,
      ]);
      return result.rows[0] ? mapLesson(result.rows[0] as Record<string, unknown>) : null;
    });
  }

  async listLessons(
    tenantId: string,
    filter: ScopeFilter & { subject?: string; published?: boolean },
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<LessonEntity>> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const params: unknown[] = [tenantId];
      const conditions = ['tenant_id = $1', ...scopeConditions(filter, params)];
      if (filter.subject) {
        params.push(filter.subject);
        conditions.push(`subject = $${params.length}`);
      }
      if (filter.published !== undefined) {
        params.push(filter.published);
        conditions.push(`published = $${params.length}`);
      }
      const where = conditions.join(' AND ');
      const count = await client.query(
        `SELECT count(*)::int AS c FROM lms_lessons WHERE ${where}`,
        params,
      );
      const totalItems = Number((count.rows[0] as { c: number }).c);
      params.push(pagination.pageSize, (pagination.page - 1) * pagination.pageSize);
      const result = await client.query(
        `SELECT * FROM lms_lessons WHERE ${where}
         ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return {
        data: result.rows.map((row) => mapLesson(row as Record<string, unknown>)),
        meta: paginateMeta(totalItems, pagination),
      };
    });
  }

  async createLessonResource(
    data: Omit<LessonResourceEntity, 'createdAt'>,
  ): Promise<LessonResourceEntity> {
    await this.ensureSchema();
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO lms_lesson_resources (
           id, tenant_id, lesson_id, kind, title, url, storage_key, mime_type, position
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.lessonId,
          data.kind,
          data.title,
          data.url,
          data.storageKey,
          data.mimeType,
          data.position,
        ],
      );
      return mapLessonResource(result.rows[0] as Record<string, unknown>);
    });
  }

  async listLessonResources(tenantId: string, lessonId: string): Promise<LessonResourceEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM lms_lesson_resources WHERE tenant_id=$1 AND lesson_id=$2
         ORDER BY position`,
        [tenantId, lessonId],
      );
      return result.rows.map((row) => mapLessonResource(row as Record<string, unknown>));
    });
  }

  async createContentItem(
    data: Omit<ContentItemEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<ContentItemEntity> {
    await this.ensureSchema();
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO lms_content_items (
           id, tenant_id, scope, board_id, institution_id, title, kind, body, tags,
           class_key, subject, object_key, mime_type, published, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15) RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.scope,
          data.boardId,
          data.institutionId,
          data.title,
          data.kind,
          data.body,
          JSON.stringify(data.tags),
          data.classKey,
          data.subject,
          data.objectKey,
          data.mimeType,
          data.published,
          data.createdBy,
        ],
      );
      return mapContent(result.rows[0] as Record<string, unknown>);
    });
  }

  async findContentItem(tenantId: string, id: string): Promise<ContentItemEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        'SELECT * FROM lms_content_items WHERE tenant_id=$1 AND id=$2',
        [tenantId, id],
      );
      return result.rows[0] ? mapContent(result.rows[0] as Record<string, unknown>) : null;
    });
  }

  async listContentItems(
    tenantId: string,
    filter: ScopeFilter & { subject?: string; published?: boolean; classKey?: string },
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<ContentItemEntity>> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const params: unknown[] = [tenantId];
      const conditions = ['tenant_id = $1', ...scopeConditions(filter, params)];
      if (filter.subject) {
        params.push(filter.subject);
        conditions.push(`subject = $${params.length}`);
      }
      if (filter.classKey) {
        params.push(filter.classKey);
        conditions.push(`class_key = $${params.length}`);
      }
      if (filter.published !== undefined) {
        params.push(filter.published);
        conditions.push(`published = $${params.length}`);
      }
      const where = conditions.join(' AND ');
      const count = await client.query(
        `SELECT count(*)::int AS c FROM lms_content_items WHERE ${where}`,
        params,
      );
      const totalItems = Number((count.rows[0] as { c: number }).c);
      params.push(pagination.pageSize, (pagination.page - 1) * pagination.pageSize);
      const result = await client.query(
        `SELECT * FROM lms_content_items WHERE ${where}
         ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return {
        data: result.rows.map((row) => mapContent(row as Record<string, unknown>)),
        meta: paginateMeta(totalItems, pagination),
      };
    });
  }
  async createModule(data: LmsModuleEntity) {
    await this.pool.query(
      `INSERT INTO lms_modules (id, tenant_id, institution_id, academic_period_id, class_key, title, position, published, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [data.id, data.tenantId, data.institutionId, data.academicPeriodId, data.classKey, data.title, data.position, data.published, data.createdBy, data.createdAt, data.updatedAt],
    );
    return data;
  }
  async findModule(tenantId: string, id: string): Promise<LmsModuleEntity | null> {
    const res = await this.pool.query(`SELECT * FROM lms_modules WHERE tenant_id=$1 AND id=$2`, [tenantId, id]);
    const row = res.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      tenantId: String(row.tenant_id),
      institutionId: row.institution_id ? String(row.institution_id) : null,
      academicPeriodId: row.academic_period_id ? String(row.academic_period_id) : null,
      classKey: row.class_key ? String(row.class_key) : null,
      title: String(row.title),
      position: Number(row.position),
      published: Boolean(row.published),
      createdBy: row.created_by ? String(row.created_by) : null,
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
    };
  }
  async listModules(tenantId: string, filter: { classKey?: string; academicPeriodId?: string; institutionId?: string }) {
    const res = await this.pool.query(`SELECT * FROM lms_modules WHERE tenant_id=$1 ORDER BY position ASC`, [tenantId]);
    return res.rows
      .map((row: Record<string, unknown>) => ({
        id: String(row.id), tenantId: String(row.tenant_id), institutionId: row.institution_id ? String(row.institution_id) : null,
        academicPeriodId: row.academic_period_id ? String(row.academic_period_id) : null, classKey: row.class_key ? String(row.class_key) : null,
        title: String(row.title), position: Number(row.position), published: Boolean(row.published),
        createdBy: row.created_by ? String(row.created_by) : null, createdAt: row.created_at as Date, updatedAt: row.updated_at as Date,
      }))
      .filter((m: { classKey: string | null; academicPeriodId: string | null; institutionId: string | null }) =>
        (filter.classKey ? m.classKey === filter.classKey : true) &&
        (filter.academicPeriodId ? m.academicPeriodId === filter.academicPeriodId : true) &&
        (filter.institutionId ? m.institutionId === filter.institutionId : true),
      );
  }
  async createModuleItem(data: LmsModuleItemEntity) {
    await this.pool.query(
      `INSERT INTO lms_module_items (id, tenant_id, module_id, item_type, item_id, title, position, required, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [data.id, data.tenantId, data.moduleId, data.itemType, data.itemId, data.title, data.position, data.required, data.createdAt],
    );
    return data;
  }
  async listModuleItems(tenantId: string, moduleId: string) {
    const res = await this.pool.query(
      `SELECT * FROM lms_module_items WHERE tenant_id=$1 AND module_id=$2 ORDER BY position ASC`,
      [tenantId, moduleId],
    );
    return res.rows.map((row: Record<string, unknown>) => ({
      id: String(row.id), tenantId: String(row.tenant_id), moduleId: String(row.module_id),
      itemType: row.item_type as 'assignment' | 'content' | 'discussion' | 'url',
      itemId: row.item_id ? String(row.item_id) : null, title: String(row.title),
      position: Number(row.position), required: Boolean(row.required), createdAt: row.created_at as Date,
    }));
  }

}
