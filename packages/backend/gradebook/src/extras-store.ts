/**
 * G-907 extras: grade-change audit, comments bank, class-rank snapshots.
 * Dual store: raw pg (db/sql/032) via withPgTenant, else in-memory.
 */
import { withPgTenant, type PgQueryable } from '@proctira/database';

export type GradeChangeAuditRecord = {
  id: string;
  tenantId: string;
  gradeEntryId: string;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  fromNumericScore: number | null;
  toNumericScore: number | null;
  fromLetterGrade: string | null;
  toLetterGrade: string | null;
  actorId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
};

export type CommentsBankRecord = {
  id: string;
  tenantId: string;
  institutionId: string | null;
  subjectId: string | null;
  gradeBand: string | null;
  label: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export type ClassRankSnapshotRecord = {
  id: string;
  tenantId: string;
  sectionId: string;
  academicPeriodId: string | null;
  batchId: string;
  studentId: string;
  classRank: number;
  tieCount: number;
  weightedGpa: number | null;
  unweightedGpa: number | null;
  cgpa: number | null;
  creditsEarned: number | null;
  computedAt: string;
  metadata: Record<string, unknown>;
};

export interface GradebookExtrasStore {
  appendAudit(row: GradeChangeAuditRecord): Promise<GradeChangeAuditRecord>;
  listAudits(tenantId: string, gradeEntryId?: string): Promise<GradeChangeAuditRecord[]>;

  createComment(row: CommentsBankRecord): Promise<CommentsBankRecord>;
  updateComment(
    tenantId: string,
    id: string,
    patch: Partial<
      Pick<
        CommentsBankRecord,
        'label' | 'body' | 'subjectId' | 'gradeBand' | 'institutionId' | 'updatedAt'
      >
    >,
  ): Promise<CommentsBankRecord | null>;
  deleteComment(tenantId: string, id: string): Promise<boolean>;
  listComments(
    tenantId: string,
    filter?: { subjectId?: string; gradeBand?: string; institutionId?: string },
  ): Promise<CommentsBankRecord[]>;
  getComment(tenantId: string, id: string): Promise<CommentsBankRecord | null>;

  saveRankBatch(rows: ClassRankSnapshotRecord[]): Promise<ClassRankSnapshotRecord[]>;
  listLatestRanks(tenantId: string, sectionId: string): Promise<ClassRankSnapshotRecord[]>;
}

export class InMemoryGradebookExtrasStore implements GradebookExtrasStore {
  private readonly audits = new Map<string, GradeChangeAuditRecord>();
  private readonly comments = new Map<string, CommentsBankRecord>();
  private readonly ranks = new Map<string, ClassRankSnapshotRecord>();

  async appendAudit(row: GradeChangeAuditRecord): Promise<GradeChangeAuditRecord> {
    this.audits.set(row.id, { ...row });
    return { ...row };
  }

  async listAudits(tenantId: string, gradeEntryId?: string): Promise<GradeChangeAuditRecord[]> {
    return [...this.audits.values()]
      .filter((r) => r.tenantId === tenantId && (!gradeEntryId || r.gradeEntryId === gradeEntryId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createComment(row: CommentsBankRecord): Promise<CommentsBankRecord> {
    this.comments.set(row.id, { ...row });
    return { ...row };
  }

  async updateComment(
    tenantId: string,
    id: string,
    patch: Partial<
      Pick<
        CommentsBankRecord,
        'label' | 'body' | 'subjectId' | 'gradeBand' | 'institutionId' | 'updatedAt'
      >
    >,
  ): Promise<CommentsBankRecord | null> {
    const cur = this.comments.get(id);
    if (!cur || cur.tenantId !== tenantId) return null;
    const next = { ...cur, ...patch, id: cur.id, tenantId: cur.tenantId };
    this.comments.set(id, next);
    return { ...next };
  }

  async deleteComment(tenantId: string, id: string): Promise<boolean> {
    const cur = this.comments.get(id);
    if (!cur || cur.tenantId !== tenantId) return false;
    this.comments.delete(id);
    return true;
  }

  async listComments(
    tenantId: string,
    filter?: { subjectId?: string; gradeBand?: string; institutionId?: string },
  ): Promise<CommentsBankRecord[]> {
    return [...this.comments.values()]
      .filter((r) => {
        if (r.tenantId !== tenantId) return false;
        if (filter?.subjectId && r.subjectId !== filter.subjectId) return false;
        if (filter?.gradeBand && r.gradeBand !== filter.gradeBand) return false;
        if (filter?.institutionId && r.institutionId !== filter.institutionId) return false;
        return true;
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  async getComment(tenantId: string, id: string): Promise<CommentsBankRecord | null> {
    const row = this.comments.get(id);
    return row && row.tenantId === tenantId ? { ...row } : null;
  }

  async saveRankBatch(rows: ClassRankSnapshotRecord[]): Promise<ClassRankSnapshotRecord[]> {
    for (const row of rows) this.ranks.set(row.id, { ...row });
    return rows.map((r) => ({ ...r }));
  }

  async listLatestRanks(tenantId: string, sectionId: string): Promise<ClassRankSnapshotRecord[]> {
    const scoped = [...this.ranks.values()].filter(
      (r) => r.tenantId === tenantId && r.sectionId === sectionId,
    );
    if (scoped.length === 0) return [];
    const latest = scoped.reduce((a, b) => (a.computedAt >= b.computedAt ? a : b)).batchId;
    return scoped
      .filter((r) => r.batchId === latest)
      .sort((a, b) => a.classRank - b.classRank || a.studentId.localeCompare(b.studentId));
  }
}

export type GradebookExtrasPool = PgQueryable & { connect?: unknown };

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

function mapAudit(row: Record<string, unknown>): GradeChangeAuditRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    gradeEntryId: String(row.grade_entry_id),
    action: String(row.action),
    fromStatus: row.from_status == null ? null : String(row.from_status),
    toStatus: row.to_status == null ? null : String(row.to_status),
    fromNumericScore: num(row.from_numeric_score),
    toNumericScore: num(row.to_numeric_score),
    fromLetterGrade: row.from_letter_grade == null ? null : String(row.from_letter_grade),
    toLetterGrade: row.to_letter_grade == null ? null : String(row.to_letter_grade),
    actorId: row.actor_id == null ? null : String(row.actor_id),
    details: jsonObj(row.details),
    createdAt: iso(row.created_at),
  };
}

function mapComment(row: Record<string, unknown>): CommentsBankRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    institutionId: row.institution_id == null ? null : String(row.institution_id),
    subjectId: row.subject_id == null ? null : String(row.subject_id),
    gradeBand: row.grade_band == null ? null : String(row.grade_band),
    label: String(row.label),
    body: String(row.body),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapRank(row: Record<string, unknown>): ClassRankSnapshotRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    sectionId: String(row.section_id),
    academicPeriodId: row.academic_period_id == null ? null : String(row.academic_period_id),
    batchId: String(row.batch_id),
    studentId: String(row.student_id),
    classRank: Number(row.class_rank),
    tieCount: Number(row.tie_count ?? 1),
    weightedGpa: num(row.weighted_gpa),
    unweightedGpa: num(row.unweighted_gpa),
    cgpa: num(row.cgpa),
    creditsEarned: num(row.credits_earned),
    computedAt: iso(row.computed_at),
    metadata: jsonObj(row.metadata),
  };
}

export class PgGradebookExtrasStore implements GradebookExtrasStore {
  constructor(private readonly pool: GradebookExtrasPool) {}

  private run<T>(tenantId: string, fn: (client: PgQueryable) => Promise<T>): Promise<T> {
    return withPgTenant(this.pool as never, tenantId, fn);
  }

  async appendAudit(row: GradeChangeAuditRecord): Promise<GradeChangeAuditRecord> {
    return this.run(row.tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO grade_change_audit (
           id, tenant_id, grade_entry_id, action, from_status, to_status,
           from_numeric_score, to_numeric_score, from_letter_grade, to_letter_grade,
           actor_id, details, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)
         RETURNING *`,
        [
          row.id,
          row.tenantId,
          row.gradeEntryId,
          row.action,
          row.fromStatus,
          row.toStatus,
          row.fromNumericScore,
          row.toNumericScore,
          row.fromLetterGrade,
          row.toLetterGrade,
          row.actorId,
          JSON.stringify(row.details ?? {}),
          row.createdAt,
        ],
      );
      return mapAudit(rows[0] as Record<string, unknown>);
    });
  }

  async listAudits(tenantId: string, gradeEntryId?: string): Promise<GradeChangeAuditRecord[]> {
    return this.run(tenantId, async (client) => {
      const params: unknown[] = [tenantId];
      let sql = `SELECT * FROM grade_change_audit WHERE tenant_id = $1`;
      if (gradeEntryId) {
        params.push(gradeEntryId);
        sql += ` AND grade_entry_id = $2`;
      }
      sql += ` ORDER BY created_at DESC`;
      const { rows } = await client.query(sql, params);
      return (rows as Record<string, unknown>[]).map(mapAudit);
    });
  }

  async createComment(row: CommentsBankRecord): Promise<CommentsBankRecord> {
    return this.run(row.tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO comments_bank (
           id, tenant_id, institution_id, subject_id, grade_band, label, body, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [
          row.id,
          row.tenantId,
          row.institutionId,
          row.subjectId,
          row.gradeBand,
          row.label,
          row.body,
          row.createdAt,
          row.updatedAt,
        ],
      );
      return mapComment(rows[0] as Record<string, unknown>);
    });
  }

  async updateComment(
    tenantId: string,
    id: string,
    patch: Partial<
      Pick<
        CommentsBankRecord,
        'label' | 'body' | 'subjectId' | 'gradeBand' | 'institutionId' | 'updatedAt'
      >
    >,
  ): Promise<CommentsBankRecord | null> {
    const cur = await this.getComment(tenantId, id);
    if (!cur) return null;
    const next = { ...cur, ...patch };
    return this.run(tenantId, async (client) => {
      const { rows } = await client.query(
        `UPDATE comments_bank SET
           institution_id = $3, subject_id = $4, grade_band = $5,
           label = $6, body = $7, updated_at = $8
         WHERE tenant_id = $1 AND id = $2
         RETURNING *`,
        [
          tenantId,
          id,
          next.institutionId,
          next.subjectId,
          next.gradeBand,
          next.label,
          next.body,
          next.updatedAt ?? new Date().toISOString(),
        ],
      );
      return rows[0] ? mapComment(rows[0] as Record<string, unknown>) : null;
    });
  }

  async deleteComment(tenantId: string, id: string): Promise<boolean> {
    return this.run(tenantId, async (client) => {
      const result = await client.query(
        `DELETE FROM comments_bank WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      return Number((result as { rowCount?: number }).rowCount ?? 0) > 0;
    });
  }

  async listComments(
    tenantId: string,
    filter?: { subjectId?: string; gradeBand?: string; institutionId?: string },
  ): Promise<CommentsBankRecord[]> {
    return this.run(tenantId, async (client) => {
      const clauses = ['tenant_id = $1'];
      const params: unknown[] = [tenantId];
      if (filter?.subjectId) {
        params.push(filter.subjectId);
        clauses.push(`subject_id = $${params.length}`);
      }
      if (filter?.gradeBand) {
        params.push(filter.gradeBand);
        clauses.push(`grade_band = $${params.length}`);
      }
      if (filter?.institutionId) {
        params.push(filter.institutionId);
        clauses.push(`institution_id = $${params.length}`);
      }
      const { rows } = await client.query(
        `SELECT * FROM comments_bank WHERE ${clauses.join(' AND ')} ORDER BY label`,
        params,
      );
      return (rows as Record<string, unknown>[]).map(mapComment);
    });
  }

  async getComment(tenantId: string, id: string): Promise<CommentsBankRecord | null> {
    return this.run(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM comments_bank WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [tenantId, id],
      );
      return rows[0] ? mapComment(rows[0] as Record<string, unknown>) : null;
    });
  }

  async saveRankBatch(rows: ClassRankSnapshotRecord[]): Promise<ClassRankSnapshotRecord[]> {
    if (rows.length === 0) return [];
    const tenantId = rows[0]!.tenantId;
    return this.run(tenantId, async (client) => {
      const saved: ClassRankSnapshotRecord[] = [];
      for (const row of rows) {
        const { rows: inserted } = await client.query(
          `INSERT INTO class_rank_snapshots (
             id, tenant_id, section_id, academic_period_id, batch_id, student_id,
             class_rank, tie_count, weighted_gpa, unweighted_gpa, cgpa, credits_earned,
             computed_at, metadata
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
           RETURNING *`,
          [
            row.id,
            row.tenantId,
            row.sectionId,
            row.academicPeriodId,
            row.batchId,
            row.studentId,
            row.classRank,
            row.tieCount,
            row.weightedGpa,
            row.unweightedGpa,
            row.cgpa,
            row.creditsEarned,
            row.computedAt,
            JSON.stringify(row.metadata ?? {}),
          ],
        );
        saved.push(mapRank(inserted[0] as Record<string, unknown>));
      }
      return saved;
    });
  }

  async listLatestRanks(tenantId: string, sectionId: string): Promise<ClassRankSnapshotRecord[]> {
    return this.run(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM class_rank_snapshots
          WHERE tenant_id = $1 AND section_id = $2
            AND batch_id = (
              SELECT batch_id FROM class_rank_snapshots
               WHERE tenant_id = $1 AND section_id = $2
               ORDER BY computed_at DESC LIMIT 1
            )
          ORDER BY class_rank ASC, student_id ASC`,
        [tenantId, sectionId],
      );
      return (rows as Record<string, unknown>[]).map(mapRank);
    });
  }
}
