/**
 * Postgres-backed timetable store (raw `pg` — no Prisma).
 * Aligns with db/sql/003_sis_timetable_schedule_schema.sql:
 *   bell_schedules, bell_periods, section_meetings, substitutions, rooms, sections
 */
import pg from 'pg';

import { TimetableSchemaMissingError } from './timetable-errors.js';
import type {
  BellScheduleEntity,
  PeriodEntity,
  SectionMeetingEntity,
  SubstitutionEntity,
  TimetableRepository,
  ListBellSchedulesFilter,
  ListMeetingsFilter,
  ListSubstitutionsFilter,
} from './timetable-repository.js';

const { Pool } = pg;

export type PgPoolLike = Pick<pg.Pool, 'query' | 'end'>;

let sharedPool: pg.Pool | null = null;

function resolveDatabaseUrl(): string | null {
  const url = process.env.DATABASE_URL?.trim();
  return url && url.length > 0 ? url : null;
}

export function isPgTimetableEnabled(): boolean {
  return resolveDatabaseUrl() !== null;
}

export function getSharedTimetablePool(): pg.Pool | null {
  const url = resolveDatabaseUrl();
  if (!url) return null;
  if (!sharedPool) {
    sharedPool = new Pool({ connectionString: url });
  }
  return sharedPool;
}

/** Schema is applied via psql (003). Do not re-run psql meta from node-pg. */
export async function ensureTimetableSchema(_pool?: PgPoolLike): Promise<void> {
  // no-op — tables come from db/sql/003_sis_timetable_schedule_schema.sql
}

function isUndefinedTable(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === '42P01'
  );
}

async function withSchemaCheck<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (isUndefinedTable(error)) {
      throw new TimetableSchemaMissingError();
    }
    throw error;
  }
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function dateOnly(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function timeText(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().slice(11, 16);
  }
  const s = String(value);
  // TIME may come as "08:00:00"
  return s.length >= 5 ? s.slice(0, 5) : s;
}

function dayPatternToJson(pattern: string): number[] {
  const trimmed = pattern.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((n) => Number(n)).filter((n) => n >= 1 && n <= 7);
      }
    } catch {
      // fall through
    }
  }
  return trimmed
    .split(',')
    .map((p) => Number(p.trim()))
    .filter((n) => n >= 1 && n <= 7);
}

function dayPatternFromDb(value: unknown): string {
  if (Array.isArray(value)) return value.join(',');
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) return parsed.join(',');
    } catch {
      return value;
    }
  }
  return '1,2,3,4,5';
}

function mapBellSchedule(row: Record<string, unknown>): BellScheduleEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    institutionId: String(row.institution_id),
    academicPeriodId: String(row.academic_period_id),
    code: String(row.code),
    name: String(row.name),
    dayPattern: dayPatternFromDb(row.day_pattern),
    status: String(row.status),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapPeriod(row: Record<string, unknown>): PeriodEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    bellScheduleId: String(row.bell_schedule_id),
    name: String(row.name),
    periodOrder: Number(row.period_order),
    startTime: timeText(row.start_time),
    endTime: timeText(row.end_time),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapMeeting(row: Record<string, unknown>): SectionMeetingEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    institutionId: String(row.institution_id ?? ''),
    academicPeriodId: String(row.academic_period_id ?? ''),
    sectionId: String(row.section_id),
    subjectId: null,
    staffId: row.teacher_staff_id == null ? '' : String(row.teacher_staff_id),
    periodId: String(row.bell_period_id),
    roomId: row.room_id == null ? null : String(row.room_id),
    dayOfWeek: Number(row.day_of_week),
    status: String(row.status),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapSubstitution(row: Record<string, unknown>): SubstitutionEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    institutionId: String(row.institution_id ?? ''),
    sectionMeetingId: String(row.section_meeting_id),
    originalStaffId: String(row.original_staff_id),
    substituteStaffId: String(row.substitute_staff_id),
    substitutionDate: dateOnly(row.substitution_date),
    reason: row.reason == null ? null : String(row.reason),
    status: String(row.status),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

const MEETING_SELECT = `
  SELECT sm.*,
         s.institution_id,
         s.academic_period_id
  FROM section_meetings sm
  JOIN sections s ON s.id = sm.section_id
`;

export class PgTimetableRepository implements TimetableRepository {
  constructor(private readonly pool: PgPoolLike) {}

  async listBellSchedules(tenantId: string, filter?: ListBellSchedulesFilter) {
    return withSchemaCheck(async () => {
      const clauses = ['tenant_id = $1', 'deleted_at IS NULL'];
      const params: unknown[] = [tenantId];
      if (filter?.institutionId) {
        params.push(filter.institutionId);
        clauses.push(`institution_id = $${params.length}`);
      }
      if (filter?.academicPeriodId) {
        params.push(filter.academicPeriodId);
        clauses.push(`academic_period_id = $${params.length}`);
      }
      const result = await this.pool.query(
        `SELECT * FROM bell_schedules WHERE ${clauses.join(' AND ')} ORDER BY name ASC`,
        params,
      );
      return result.rows.map((row) => mapBellSchedule(row as Record<string, unknown>));
    });
  }

  async getBellSchedule(tenantId: string, id: string) {
    return withSchemaCheck(async () => {
      const result = await this.pool.query(
        `SELECT * FROM bell_schedules WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [tenantId, id],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapBellSchedule(row) : null;
    });
  }

  async createBellSchedule(row: BellScheduleEntity) {
    return withSchemaCheck(async () => {
      const result = await this.pool.query(
        `INSERT INTO bell_schedules (
          id, tenant_id, institution_id, academic_period_id, code, name,
          day_pattern, status, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::timestamptz,$10::timestamptz
        ) RETURNING *`,
        [
          row.id,
          row.tenantId,
          row.institutionId,
          row.academicPeriodId,
          row.code,
          row.name,
          JSON.stringify(dayPatternToJson(row.dayPattern)),
          row.status,
          row.createdAt,
          row.updatedAt,
        ],
      );
      return mapBellSchedule(result.rows[0] as Record<string, unknown>);
    });
  }

  async updateBellSchedule(tenantId: string, id: string, patch: Partial<BellScheduleEntity>) {
    return withSchemaCheck(async () => {
      const cur = await this.getBellSchedule(tenantId, id);
      if (!cur) return null;
      const next = {
        ...cur,
        ...patch,
        id: cur.id,
        tenantId: cur.tenantId,
        updatedAt: new Date().toISOString(),
      };
      const result = await this.pool.query(
        `UPDATE bell_schedules SET
          code = $3,
          name = $4,
          day_pattern = $5::jsonb,
          status = $6,
          updated_at = $7::timestamptz
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
         RETURNING *`,
        [
          tenantId,
          id,
          next.code,
          next.name,
          JSON.stringify(dayPatternToJson(next.dayPattern)),
          next.status,
          next.updatedAt,
        ],
      );
      return mapBellSchedule(result.rows[0] as Record<string, unknown>);
    });
  }

  async deleteBellSchedule(tenantId: string, id: string) {
    return withSchemaCheck(async () => {
      const result = await this.pool.query(
        `UPDATE bell_schedules SET deleted_at = NOW(), updated_at = NOW()
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [tenantId, id],
      );
      return (result.rowCount ?? 0) > 0;
    });
  }

  async listPeriods(tenantId: string, bellScheduleId: string) {
    return withSchemaCheck(async () => {
      const result = await this.pool.query(
        `SELECT * FROM bell_periods
         WHERE tenant_id = $1 AND bell_schedule_id = $2 AND deleted_at IS NULL
         ORDER BY period_order ASC`,
        [tenantId, bellScheduleId],
      );
      return result.rows.map((row) => mapPeriod(row as Record<string, unknown>));
    });
  }

  async getPeriod(tenantId: string, id: string) {
    return withSchemaCheck(async () => {
      const result = await this.pool.query(
        `SELECT * FROM bell_periods WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [tenantId, id],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapPeriod(row) : null;
    });
  }

  async createPeriod(row: PeriodEntity) {
    return withSchemaCheck(async () => {
      const code = `P${row.periodOrder}`;
      const result = await this.pool.query(
        `INSERT INTO bell_periods (
          id, tenant_id, bell_schedule_id, code, name, period_order,
          start_time, end_time, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7::time,$8::time,$9::timestamptz,$10::timestamptz
        ) RETURNING *`,
        [
          row.id,
          row.tenantId,
          row.bellScheduleId,
          code,
          row.name,
          row.periodOrder,
          row.startTime,
          row.endTime,
          row.createdAt,
          row.updatedAt,
        ],
      );
      return mapPeriod(result.rows[0] as Record<string, unknown>);
    });
  }

  async updatePeriod(tenantId: string, id: string, patch: Partial<PeriodEntity>) {
    return withSchemaCheck(async () => {
      const cur = await this.getPeriod(tenantId, id);
      if (!cur) return null;
      const next = {
        ...cur,
        ...patch,
        id: cur.id,
        tenantId: cur.tenantId,
        updatedAt: new Date().toISOString(),
      };
      const result = await this.pool.query(
        `UPDATE bell_periods SET
          name = $3,
          period_order = $4,
          start_time = $5::time,
          end_time = $6::time,
          updated_at = $7::timestamptz
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
         RETURNING *`,
        [tenantId, id, next.name, next.periodOrder, next.startTime, next.endTime, next.updatedAt],
      );
      return mapPeriod(result.rows[0] as Record<string, unknown>);
    });
  }

  async deletePeriod(tenantId: string, id: string) {
    return withSchemaCheck(async () => {
      const result = await this.pool.query(
        `UPDATE bell_periods SET deleted_at = NOW(), updated_at = NOW()
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [tenantId, id],
      );
      return (result.rowCount ?? 0) > 0;
    });
  }

  async listMeetings(tenantId: string, filter?: ListMeetingsFilter) {
    return withSchemaCheck(async () => {
      const clauses = ['sm.tenant_id = $1', 'sm.deleted_at IS NULL'];
      const params: unknown[] = [tenantId];
      if (filter?.institutionId) {
        params.push(filter.institutionId);
        clauses.push(`s.institution_id = $${params.length}`);
      }
      if (filter?.academicPeriodId) {
        params.push(filter.academicPeriodId);
        clauses.push(`s.academic_period_id = $${params.length}`);
      }
      if (filter?.staffId) {
        params.push(filter.staffId);
        clauses.push(`sm.teacher_staff_id = $${params.length}`);
      }
      const result = await this.pool.query(
        `${MEETING_SELECT}
         WHERE ${clauses.join(' AND ')}
         ORDER BY sm.day_of_week ASC, sm.bell_period_id ASC`,
        params,
      );
      return result.rows.map((row) => mapMeeting(row as Record<string, unknown>));
    });
  }

  async getMeeting(tenantId: string, id: string) {
    return withSchemaCheck(async () => {
      const result = await this.pool.query(
        `${MEETING_SELECT}
         WHERE sm.tenant_id = $1 AND sm.id = $2 AND sm.deleted_at IS NULL`,
        [tenantId, id],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapMeeting(row) : null;
    });
  }

  async createMeeting(row: SectionMeetingEntity) {
    return withSchemaCheck(async () => {
      const result = await this.pool.query(
        `INSERT INTO section_meetings (
          id, tenant_id, section_id, bell_period_id, day_of_week,
          room_id, teacher_staff_id, status, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$10::timestamptz
        ) RETURNING *`,
        [
          row.id,
          row.tenantId,
          row.sectionId,
          row.periodId,
          row.dayOfWeek,
          row.roomId,
          row.staffId || null,
          row.status,
          row.createdAt,
          row.updatedAt,
        ],
      );
      const inserted = result.rows[0] as Record<string, unknown>;
      // Re-read with join for institution/period denorm fields.
      const full = await this.getMeeting(row.tenantId, String(inserted.id));
      return full ?? mapMeeting({ ...inserted, institution_id: row.institutionId, academic_period_id: row.academicPeriodId });
    });
  }

  async updateMeeting(tenantId: string, id: string, patch: Partial<SectionMeetingEntity>) {
    return withSchemaCheck(async () => {
      const cur = await this.getMeeting(tenantId, id);
      if (!cur) return null;
      const next = {
        ...cur,
        ...patch,
        id: cur.id,
        tenantId: cur.tenantId,
        updatedAt: new Date().toISOString(),
      };
      await this.pool.query(
        `UPDATE section_meetings SET
          section_id = $3,
          bell_period_id = $4,
          day_of_week = $5,
          room_id = $6,
          teacher_staff_id = $7,
          status = $8,
          updated_at = $9::timestamptz
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [
          tenantId,
          id,
          next.sectionId,
          next.periodId,
          next.dayOfWeek,
          next.roomId,
          next.staffId || null,
          next.status,
          next.updatedAt,
        ],
      );
      return this.getMeeting(tenantId, id);
    });
  }

  async deleteMeeting(tenantId: string, id: string) {
    return withSchemaCheck(async () => {
      const result = await this.pool.query(
        `UPDATE section_meetings SET deleted_at = NOW(), updated_at = NOW()
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [tenantId, id],
      );
      return (result.rowCount ?? 0) > 0;
    });
  }

  async listSubstitutions(tenantId: string, filter?: ListSubstitutionsFilter) {
    return withSchemaCheck(async () => {
      const clauses = ['sub.tenant_id = $1'];
      const params: unknown[] = [tenantId];
      if (filter?.institutionId) {
        params.push(filter.institutionId);
        clauses.push(`s.institution_id = $${params.length}`);
      }
      if (filter?.fromDate) {
        params.push(filter.fromDate);
        clauses.push(`sub.substitution_date >= $${params.length}::date`);
      }
      if (filter?.toDate) {
        params.push(filter.toDate);
        clauses.push(`sub.substitution_date <= $${params.length}::date`);
      }
      const result = await this.pool.query(
        `SELECT sub.*, s.institution_id
         FROM substitutions sub
         JOIN section_meetings sm ON sm.id = sub.section_meeting_id
         JOIN sections s ON s.id = sm.section_id
         WHERE ${clauses.join(' AND ')}
         ORDER BY sub.substitution_date DESC, sub.created_at DESC`,
        params,
      );
      return result.rows.map((row) => mapSubstitution(row as Record<string, unknown>));
    });
  }

  async getSubstitution(tenantId: string, id: string) {
    return withSchemaCheck(async () => {
      const result = await this.pool.query(
        `SELECT sub.*, s.institution_id
         FROM substitutions sub
         JOIN section_meetings sm ON sm.id = sub.section_meeting_id
         JOIN sections s ON s.id = sm.section_id
         WHERE sub.tenant_id = $1 AND sub.id = $2`,
        [tenantId, id],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapSubstitution(row) : null;
    });
  }

  async createSubstitution(row: SubstitutionEntity) {
    return withSchemaCheck(async () => {
      const status = row.status.toUpperCase() === 'SCHEDULED' || row.status === 'scheduled'
        ? 'SCHEDULED'
        : row.status.toUpperCase();
      const result = await this.pool.query(
        `INSERT INTO substitutions (
          id, tenant_id, section_meeting_id, original_staff_id,
          substitute_staff_id, substitution_date, reason, status, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6::date,$7,$8::substitution_status,$9::timestamptz,$10::timestamptz
        ) RETURNING *`,
        [
          row.id,
          row.tenantId,
          row.sectionMeetingId,
          row.originalStaffId,
          row.substituteStaffId,
          row.substitutionDate,
          row.reason,
          status,
          row.createdAt,
          row.updatedAt,
        ],
      );
      const inserted = result.rows[0] as Record<string, unknown>;
      return mapSubstitution({ ...inserted, institution_id: row.institutionId });
    });
  }
}

export function createPgTimetableRepository(): PgTimetableRepository | null {
  const pool = getSharedTimetablePool();
  if (!pool) return null;
  return new PgTimetableRepository(pool);
}
