/**
 * G-917 — timetable generation jobs + teacher absences.
 * Raw pg (db/sql/041, RLS via withPgTenant) or in-memory for tests.
 */
import { withPgTenant, type PgQueryable } from '@proctira/database';

export type GenerationJobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface GenerationJobRecord {
  id: string;
  tenantId: string;
  institutionId: string;
  academicPeriodId: string;
  bellScheduleId: string | null;
  status: GenerationJobStatus;
  requestedBy: string | null;
  persistMeetings: boolean;
  teacherMaxPeriodsPerDay: number;
  demandCount: number;
  assignedCount: number;
  unassignedCount: number;
  clashCount: number;
  repairPasses: number;
  stats: Record<string, unknown>;
  input: Record<string, unknown>;
  result: Record<string, unknown>;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

export interface TeacherAbsenceRecord {
  id: string;
  tenantId: string;
  institutionId: string;
  staffId: string;
  absenceDate: string;
  reason: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface TimetableOpsStore {
  createJob(row: GenerationJobRecord): Promise<GenerationJobRecord>;
  updateJob(
    tenantId: string,
    id: string,
    patch: Partial<GenerationJobRecord>,
  ): Promise<GenerationJobRecord | null>;
  getJob(tenantId: string, id: string): Promise<GenerationJobRecord | null>;
  listJobs(
    tenantId: string,
    filter: { institutionId?: string },
  ): Promise<GenerationJobRecord[]>;
  createAbsence(row: TeacherAbsenceRecord): Promise<TeacherAbsenceRecord>;
  listAbsences(
    tenantId: string,
    filter: { institutionId?: string; staffId?: string; date?: string },
  ): Promise<TeacherAbsenceRecord[]>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryTimetableOpsStore implements TimetableOpsStore {
  private readonly jobs = new Map<string, GenerationJobRecord>();
  private readonly absences = new Map<string, TeacherAbsenceRecord>();

  async createJob(row: GenerationJobRecord): Promise<GenerationJobRecord> {
    this.jobs.set(row.id, clone(row));
    return clone(row);
  }

  async updateJob(
    tenantId: string,
    id: string,
    patch: Partial<GenerationJobRecord>,
  ): Promise<GenerationJobRecord | null> {
    const cur = this.jobs.get(id);
    if (!cur || cur.tenantId !== tenantId) return null;
    const next = { ...cur, ...patch, id: cur.id, tenantId: cur.tenantId };
    this.jobs.set(id, next);
    return clone(next);
  }

  async getJob(tenantId: string, id: string): Promise<GenerationJobRecord | null> {
    const row = this.jobs.get(id);
    return row && row.tenantId === tenantId ? clone(row) : null;
  }

  async listJobs(
    tenantId: string,
    filter: { institutionId?: string },
  ): Promise<GenerationJobRecord[]> {
    return [...this.jobs.values()]
      .filter((row) => {
        if (row.tenantId !== tenantId) return false;
        if (filter.institutionId && row.institutionId !== filter.institutionId) return false;
        return true;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(clone);
  }

  async createAbsence(row: TeacherAbsenceRecord): Promise<TeacherAbsenceRecord> {
    this.absences.set(row.id, clone(row));
    return clone(row);
  }

  async listAbsences(
    tenantId: string,
    filter: { institutionId?: string; staffId?: string; date?: string },
  ): Promise<TeacherAbsenceRecord[]> {
    return [...this.absences.values()]
      .filter((row) => {
        if (row.tenantId !== tenantId) return false;
        if (filter.institutionId && row.institutionId !== filter.institutionId) return false;
        if (filter.staffId && row.staffId !== filter.staffId) return false;
        if (filter.date && row.absenceDate !== filter.date) return false;
        return true;
      })
      .map(clone);
  }
}

type JobRow = Record<string, unknown>;
type AbsenceRow = Record<string, unknown>;

function str(v: unknown): string {
  return String(v ?? '');
}

function strOrNull(v: unknown): string | null {
  return v == null ? null : String(v);
}

function iso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function isoOrNull(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function dateOnly(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function jsonObj(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function toJob(row: JobRow): GenerationJobRecord {
  return {
    id: str(row.id),
    tenantId: str(row.tenant_id),
    institutionId: str(row.institution_id),
    academicPeriodId: str(row.academic_period_id),
    bellScheduleId: strOrNull(row.bell_schedule_id),
    status: str(row.status) as GenerationJobStatus,
    requestedBy: strOrNull(row.requested_by),
    persistMeetings: Boolean(row.persist_meetings),
    teacherMaxPeriodsPerDay: Number(row.teacher_max_periods_per_day ?? 6),
    demandCount: Number(row.demand_count ?? 0),
    assignedCount: Number(row.assigned_count ?? 0),
    unassignedCount: Number(row.unassigned_count ?? 0),
    clashCount: Number(row.clash_count ?? 0),
    repairPasses: Number(row.repair_passes ?? 0),
    stats: jsonObj(row.stats),
    input: jsonObj(row.input),
    result: jsonObj(row.result),
    errorMessage: strOrNull(row.error_message),
    createdAt: iso(row.created_at),
    startedAt: isoOrNull(row.started_at),
    finishedAt: isoOrNull(row.finished_at),
    updatedAt: iso(row.updated_at),
  };
}

function toAbsence(row: AbsenceRow): TeacherAbsenceRecord {
  return {
    id: str(row.id),
    tenantId: str(row.tenant_id),
    institutionId: str(row.institution_id),
    staffId: str(row.staff_id),
    absenceDate: dateOnly(row.absence_date),
    reason: strOrNull(row.reason),
    createdBy: strOrNull(row.created_by),
    createdAt: iso(row.created_at),
  };
}

export class PgTimetableOpsStore implements TimetableOpsStore {
  constructor(private readonly pool: PgQueryable) {}

  private run<T>(tenantId: string, fn: (client: PgQueryable) => Promise<T>): Promise<T> {
    return withPgTenant(this.pool as never, tenantId, fn);
  }

  async createJob(row: GenerationJobRecord): Promise<GenerationJobRecord> {
    return this.run(row.tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO timetable_generation_jobs
           (id, tenant_id, institution_id, academic_period_id, bell_schedule_id, status,
            requested_by, persist_meetings, teacher_max_periods_per_day, demand_count,
            assigned_count, unassigned_count, clash_count, repair_passes, stats, input, result,
            error_message, created_at, started_at, finished_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17::jsonb,
            $18,$19,$20,$21,$22)
         RETURNING *`,
        [
          row.id,
          row.tenantId,
          row.institutionId,
          row.academicPeriodId,
          row.bellScheduleId,
          row.status,
          row.requestedBy,
          row.persistMeetings,
          row.teacherMaxPeriodsPerDay,
          row.demandCount,
          row.assignedCount,
          row.unassignedCount,
          row.clashCount,
          row.repairPasses,
          JSON.stringify(row.stats),
          JSON.stringify(row.input),
          JSON.stringify(row.result),
          row.errorMessage,
          row.createdAt,
          row.startedAt,
          row.finishedAt,
          row.updatedAt,
        ],
      );
      return toJob(rows[0] as JobRow);
    });
  }

  async updateJob(
    tenantId: string,
    id: string,
    patch: Partial<GenerationJobRecord>,
  ): Promise<GenerationJobRecord | null> {
    return this.run(tenantId, async (client) => {
      const existing = await client.query(
        `SELECT * FROM timetable_generation_jobs WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [tenantId, id],
      );
      if (!existing.rows[0]) return null;
      const current = toJob(existing.rows[0] as JobRow);
      const next: GenerationJobRecord = {
        ...current,
        ...patch,
        id: current.id,
        tenantId: current.tenantId,
        updatedAt: new Date().toISOString(),
      };
      const { rows } = await client.query(
        `UPDATE timetable_generation_jobs SET
           status = $3, persist_meetings = $4, demand_count = $5, assigned_count = $6,
           unassigned_count = $7, clash_count = $8, repair_passes = $9, stats = $10::jsonb,
           input = $11::jsonb, result = $12::jsonb, error_message = $13, started_at = $14,
           finished_at = $15, updated_at = $16
         WHERE tenant_id = $1 AND id = $2
         RETURNING *`,
        [
          tenantId,
          id,
          next.status,
          next.persistMeetings,
          next.demandCount,
          next.assignedCount,
          next.unassignedCount,
          next.clashCount,
          next.repairPasses,
          JSON.stringify(next.stats),
          JSON.stringify(next.input),
          JSON.stringify(next.result),
          next.errorMessage,
          next.startedAt,
          next.finishedAt,
          next.updatedAt,
        ],
      );
      return rows[0] ? toJob(rows[0] as JobRow) : null;
    });
  }

  async getJob(tenantId: string, id: string): Promise<GenerationJobRecord | null> {
    return this.run(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM timetable_generation_jobs WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [tenantId, id],
      );
      return rows[0] ? toJob(rows[0] as JobRow) : null;
    });
  }

  async listJobs(
    tenantId: string,
    filter: { institutionId?: string },
  ): Promise<GenerationJobRecord[]> {
    return this.run(tenantId, async (client) => {
      const params: unknown[] = [tenantId];
      let sql = `SELECT * FROM timetable_generation_jobs WHERE tenant_id = $1`;
      if (filter.institutionId) {
        params.push(filter.institutionId);
        sql += ` AND institution_id = $2`;
      }
      sql += ` ORDER BY created_at DESC`;
      const { rows } = await client.query(sql, params);
      return (rows as JobRow[]).map(toJob);
    });
  }

  async createAbsence(row: TeacherAbsenceRecord): Promise<TeacherAbsenceRecord> {
    return this.run(row.tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO timetable_teacher_absences
           (id, tenant_id, institution_id, staff_id, absence_date, reason, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8)
         ON CONFLICT (tenant_id, staff_id, absence_date) DO UPDATE
           SET reason = EXCLUDED.reason
         RETURNING *`,
        [
          row.id,
          row.tenantId,
          row.institutionId,
          row.staffId,
          row.absenceDate,
          row.reason,
          row.createdBy,
          row.createdAt,
        ],
      );
      return toAbsence(rows[0] as AbsenceRow);
    });
  }

  async listAbsences(
    tenantId: string,
    filter: { institutionId?: string; staffId?: string; date?: string },
  ): Promise<TeacherAbsenceRecord[]> {
    return this.run(tenantId, async (client) => {
      const params: unknown[] = [tenantId];
      let sql = `SELECT * FROM timetable_teacher_absences WHERE tenant_id = $1`;
      let i = 2;
      if (filter.institutionId) {
        sql += ` AND institution_id = $${i++}`;
        params.push(filter.institutionId);
      }
      if (filter.staffId) {
        sql += ` AND staff_id = $${i++}`;
        params.push(filter.staffId);
      }
      if (filter.date) {
        sql += ` AND absence_date = $${i++}::date`;
        params.push(filter.date);
      }
      const { rows } = await client.query(sql, params);
      return (rows as AbsenceRow[]).map(toAbsence);
    });
  }
}
