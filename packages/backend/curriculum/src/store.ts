/**
 * G-923 — curriculum persistence: raw pg (db/sql/033, RLS via withPgTenant)
 * or an in-memory map for dev / unit tests.
 */
import { withPgTenant, type PgQueryable } from '@proctira/database';

export interface SyllabusUnitRecord {
  id: string;
  tenantId: string;
  institutionId: string | null;
  subjectId: string;
  gradeId: string;
  academicPeriodId: string;
  code: string;
  name: string;
  sequence: number;
  planned: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LessonPlanRecord {
  id: string;
  tenantId: string;
  unitId: string;
  title: string;
  objectives: string | null;
  plannedDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LearningOutcomeRecord {
  id: string;
  tenantId: string;
  unitId: string | null;
  subjectId: string;
  gradeId: string | null;
  code: string;
  statement: string;
  createdAt: string;
  updatedAt: string;
}

export interface UnitCoverageRecord {
  id: string;
  tenantId: string;
  unitId: string;
  taughtAt: string;
  taughtBy: string | null;
  timetableMeetingId: string | null;
  lmsSkillId: string | null;
  createdAt: string;
}

export interface ListUnitsFilter {
  institutionId?: string;
  subjectId?: string;
  gradeId?: string;
  academicPeriodId?: string;
}

export interface CurriculumStore {
  createUnit(row: SyllabusUnitRecord): Promise<SyllabusUnitRecord>;
  listUnits(tenantId: string, filter?: ListUnitsFilter): Promise<SyllabusUnitRecord[]>;
  getUnit(tenantId: string, id: string): Promise<SyllabusUnitRecord | null>;

  createLessonPlan(row: LessonPlanRecord): Promise<LessonPlanRecord>;
  listLessonPlans(tenantId: string, unitId: string): Promise<LessonPlanRecord[]>;

  createOutcome(row: LearningOutcomeRecord): Promise<LearningOutcomeRecord>;
  listOutcomes(
    tenantId: string,
    filter?: { subjectId?: string; unitId?: string; gradeId?: string },
  ): Promise<LearningOutcomeRecord[]>;

  upsertCoverage(row: UnitCoverageRecord): Promise<UnitCoverageRecord>;
  getCoverage(tenantId: string, unitId: string): Promise<UnitCoverageRecord | null>;
  listCoverage(tenantId: string, unitIds: string[]): Promise<UnitCoverageRecord[]>;
}

export class InMemoryCurriculumStore implements CurriculumStore {
  private readonly units = new Map<string, SyllabusUnitRecord>();
  private readonly plans = new Map<string, LessonPlanRecord>();
  private readonly outcomes = new Map<string, LearningOutcomeRecord>();
  private readonly coverage = new Map<string, UnitCoverageRecord>();

  async createUnit(row: SyllabusUnitRecord): Promise<SyllabusUnitRecord> {
    this.units.set(row.id, { ...row });
    return { ...row };
  }

  async listUnits(tenantId: string, filter?: ListUnitsFilter): Promise<SyllabusUnitRecord[]> {
    return [...this.units.values()]
      .filter((r) => {
        if (r.tenantId !== tenantId) return false;
        if (filter?.institutionId && r.institutionId !== filter.institutionId) return false;
        if (filter?.subjectId && r.subjectId !== filter.subjectId) return false;
        if (filter?.gradeId && r.gradeId !== filter.gradeId) return false;
        if (filter?.academicPeriodId && r.academicPeriodId !== filter.academicPeriodId) return false;
        return true;
      })
      .sort((a, b) => a.sequence - b.sequence || a.code.localeCompare(b.code));
  }

  async getUnit(tenantId: string, id: string): Promise<SyllabusUnitRecord | null> {
    const row = this.units.get(id);
    return row && row.tenantId === tenantId ? { ...row } : null;
  }

  async createLessonPlan(row: LessonPlanRecord): Promise<LessonPlanRecord> {
    this.plans.set(row.id, { ...row });
    return { ...row };
  }

  async listLessonPlans(tenantId: string, unitId: string): Promise<LessonPlanRecord[]> {
    return [...this.plans.values()]
      .filter((r) => r.tenantId === tenantId && r.unitId === unitId)
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  async createOutcome(row: LearningOutcomeRecord): Promise<LearningOutcomeRecord> {
    this.outcomes.set(row.id, { ...row });
    return { ...row };
  }

  async listOutcomes(
    tenantId: string,
    filter?: { subjectId?: string; unitId?: string; gradeId?: string },
  ): Promise<LearningOutcomeRecord[]> {
    return [...this.outcomes.values()]
      .filter((r) => {
        if (r.tenantId !== tenantId) return false;
        if (filter?.subjectId && r.subjectId !== filter.subjectId) return false;
        if (filter?.unitId && r.unitId !== filter.unitId) return false;
        if (filter?.gradeId && r.gradeId !== filter.gradeId) return false;
        return true;
      })
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  async upsertCoverage(row: UnitCoverageRecord): Promise<UnitCoverageRecord> {
    const existing = [...this.coverage.values()].find(
      (r) => r.tenantId === row.tenantId && r.unitId === row.unitId,
    );
    if (existing) {
      const next = { ...existing, ...row, id: existing.id };
      this.coverage.set(existing.id, next);
      return { ...next };
    }
    this.coverage.set(row.id, { ...row });
    return { ...row };
  }

  async getCoverage(tenantId: string, unitId: string): Promise<UnitCoverageRecord | null> {
    const row = [...this.coverage.values()].find((r) => r.tenantId === tenantId && r.unitId === unitId);
    return row ? { ...row } : null;
  }

  async listCoverage(tenantId: string, unitIds: string[]): Promise<UnitCoverageRecord[]> {
    const set = new Set(unitIds);
    return [...this.coverage.values()].filter((r) => r.tenantId === tenantId && set.has(r.unitId));
  }
}

export type CurriculumPool = PgQueryable & { connect?: unknown };

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function isoDate(value: unknown): string | null {
  if (value == null) return null;
  const s = value instanceof Date ? value.toISOString() : String(value);
  return s.slice(0, 10);
}

function mapUnit(row: Record<string, unknown>): SyllabusUnitRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    institutionId: row.institution_id == null ? null : String(row.institution_id),
    subjectId: String(row.subject_id),
    gradeId: String(row.grade_id),
    academicPeriodId: String(row.academic_period_id),
    code: String(row.code),
    name: String(row.name),
    sequence: Number(row.sequence ?? 1),
    planned: Boolean(row.planned),
    notes: row.notes == null ? null : String(row.notes),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapPlan(row: Record<string, unknown>): LessonPlanRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    unitId: String(row.unit_id),
    title: String(row.title),
    objectives: row.objectives == null ? null : String(row.objectives),
    plannedDate: isoDate(row.planned_date),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapOutcome(row: Record<string, unknown>): LearningOutcomeRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    unitId: row.unit_id == null ? null : String(row.unit_id),
    subjectId: String(row.subject_id),
    gradeId: row.grade_id == null ? null : String(row.grade_id),
    code: String(row.code),
    statement: String(row.statement),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapCoverage(row: Record<string, unknown>): UnitCoverageRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    unitId: String(row.unit_id),
    taughtAt: iso(row.taught_at),
    taughtBy: row.taught_by == null ? null : String(row.taught_by),
    timetableMeetingId: row.timetable_meeting_id == null ? null : String(row.timetable_meeting_id),
    lmsSkillId: row.lms_skill_id == null ? null : String(row.lms_skill_id),
    createdAt: iso(row.created_at),
  };
}

export class PgCurriculumStore implements CurriculumStore {
  constructor(private readonly pool: CurriculumPool) {}

  private run<T>(tenantId: string, fn: (client: PgQueryable) => Promise<T>): Promise<T> {
    return withPgTenant(this.pool as never, tenantId, fn);
  }

  async createUnit(row: SyllabusUnitRecord): Promise<SyllabusUnitRecord> {
    return this.run(row.tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO syllabus_units (
           id, tenant_id, institution_id, subject_id, grade_id, academic_period_id,
           code, name, sequence, planned, notes, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [
          row.id,
          row.tenantId,
          row.institutionId,
          row.subjectId,
          row.gradeId,
          row.academicPeriodId,
          row.code,
          row.name,
          row.sequence,
          row.planned,
          row.notes,
          row.createdAt,
          row.updatedAt,
        ],
      );
      return mapUnit(rows[0] as Record<string, unknown>);
    });
  }

  async listUnits(tenantId: string, filter?: ListUnitsFilter): Promise<SyllabusUnitRecord[]> {
    return this.run(tenantId, async (client) => {
      const clauses = ['tenant_id = $1'];
      const params: unknown[] = [tenantId];
      if (filter?.institutionId) {
        params.push(filter.institutionId);
        clauses.push(`institution_id = $${params.length}`);
      }
      if (filter?.subjectId) {
        params.push(filter.subjectId);
        clauses.push(`subject_id = $${params.length}`);
      }
      if (filter?.gradeId) {
        params.push(filter.gradeId);
        clauses.push(`grade_id = $${params.length}`);
      }
      if (filter?.academicPeriodId) {
        params.push(filter.academicPeriodId);
        clauses.push(`academic_period_id = $${params.length}`);
      }
      const { rows } = await client.query(
        `SELECT * FROM syllabus_units WHERE ${clauses.join(' AND ')} ORDER BY sequence ASC, code ASC`,
        params,
      );
      return (rows as Record<string, unknown>[]).map(mapUnit);
    });
  }

  async getUnit(tenantId: string, id: string): Promise<SyllabusUnitRecord | null> {
    return this.run(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM syllabus_units WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [tenantId, id],
      );
      return rows[0] ? mapUnit(rows[0] as Record<string, unknown>) : null;
    });
  }

  async createLessonPlan(row: LessonPlanRecord): Promise<LessonPlanRecord> {
    return this.run(row.tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO lesson_plans (
           id, tenant_id, unit_id, title, objectives, planned_date, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [
          row.id,
          row.tenantId,
          row.unitId,
          row.title,
          row.objectives,
          row.plannedDate,
          row.createdAt,
          row.updatedAt,
        ],
      );
      return mapPlan(rows[0] as Record<string, unknown>);
    });
  }

  async listLessonPlans(tenantId: string, unitId: string): Promise<LessonPlanRecord[]> {
    return this.run(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM lesson_plans WHERE tenant_id = $1 AND unit_id = $2 ORDER BY title ASC`,
        [tenantId, unitId],
      );
      return (rows as Record<string, unknown>[]).map(mapPlan);
    });
  }

  async createOutcome(row: LearningOutcomeRecord): Promise<LearningOutcomeRecord> {
    return this.run(row.tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO learning_outcomes (
           id, tenant_id, unit_id, subject_id, grade_id, code, statement, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [
          row.id,
          row.tenantId,
          row.unitId,
          row.subjectId,
          row.gradeId,
          row.code,
          row.statement,
          row.createdAt,
          row.updatedAt,
        ],
      );
      return mapOutcome(rows[0] as Record<string, unknown>);
    });
  }

  async listOutcomes(
    tenantId: string,
    filter?: { subjectId?: string; unitId?: string; gradeId?: string },
  ): Promise<LearningOutcomeRecord[]> {
    return this.run(tenantId, async (client) => {
      const clauses = ['tenant_id = $1'];
      const params: unknown[] = [tenantId];
      if (filter?.subjectId) {
        params.push(filter.subjectId);
        clauses.push(`subject_id = $${params.length}`);
      }
      if (filter?.unitId) {
        params.push(filter.unitId);
        clauses.push(`unit_id = $${params.length}`);
      }
      if (filter?.gradeId) {
        params.push(filter.gradeId);
        clauses.push(`grade_id = $${params.length}`);
      }
      const { rows } = await client.query(
        `SELECT * FROM learning_outcomes WHERE ${clauses.join(' AND ')} ORDER BY code ASC`,
        params,
      );
      return (rows as Record<string, unknown>[]).map(mapOutcome);
    });
  }

  async upsertCoverage(row: UnitCoverageRecord): Promise<UnitCoverageRecord> {
    return this.run(row.tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO unit_coverage (
           id, tenant_id, unit_id, taught_at, taught_by, timetable_meeting_id, lms_skill_id, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (tenant_id, unit_id) DO UPDATE SET
           taught_at = EXCLUDED.taught_at,
           taught_by = EXCLUDED.taught_by,
           timetable_meeting_id = EXCLUDED.timetable_meeting_id,
           lms_skill_id = EXCLUDED.lms_skill_id
         RETURNING *`,
        [
          row.id,
          row.tenantId,
          row.unitId,
          row.taughtAt,
          row.taughtBy,
          row.timetableMeetingId,
          row.lmsSkillId,
          row.createdAt,
        ],
      );
      return mapCoverage(rows[0] as Record<string, unknown>);
    });
  }

  async getCoverage(tenantId: string, unitId: string): Promise<UnitCoverageRecord | null> {
    return this.run(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM unit_coverage WHERE tenant_id = $1 AND unit_id = $2 LIMIT 1`,
        [tenantId, unitId],
      );
      return rows[0] ? mapCoverage(rows[0] as Record<string, unknown>) : null;
    });
  }

  async listCoverage(tenantId: string, unitIds: string[]): Promise<UnitCoverageRecord[]> {
    if (unitIds.length === 0) return [];
    return this.run(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM unit_coverage WHERE tenant_id = $1 AND unit_id = ANY($2::uuid[])`,
        [tenantId, unitIds],
      );
      return (rows as Record<string, unknown>[]).map(mapCoverage);
    });
  }
}
