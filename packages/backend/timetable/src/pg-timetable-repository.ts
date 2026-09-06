/**
 * Postgres-backed timetable store (raw `pg` — no Prisma).
 * Tables: bell_schedules, periods, section_meetings, substitutions, rooms
 * (db/sql/003_sis_timetable_schedule_schema.sql).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
let schemaReady: Promise<void> | null = null;

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

function schemaSqlPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../../../../db/sql/003_sis_timetable_schedule_schema.sql'),
    join(process.cwd(), 'db/sql/003_sis_timetable_schedule_schema.sql'),
    join(process.cwd(), '../../db/sql/003_sis_timetable_schedule_schema.sql'),
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

export async function ensureTimetableSchema(
  pool: PgPoolLike = getSharedTimetablePool()!,
): Promise<void> {
  if (!pool) throw new Error('DATABASE_URL is required for timetable schema ensure');
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = readFileSync(schemaSqlPath(), 'utf8');
      await pool.query(sql);
    })();
  }
  await schemaReady;
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

function mapBellSchedule(row: Record<string, unknown>): BellScheduleEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    institutionId: String(row.institution_id),
    academicPeriodId: String(row.academic_period_id),
    name: String(row.name),
    dayPattern: String(row.day_pattern),
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
    startTime: String(row.start_time),
    endTime: String(row.end_time),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapMeeting(row: Record<string, unknown>): SectionMeetingEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    institutionId: String(row.institution_id),
    academicPeriodId: String(row.academic_period_id),
    sectionId: String(row.section_id),
    subjectId: row.subject_id == null ? null : String(row.subject_id),
    staffId: String(row.staff_id),
    periodId: String(row.period_id),
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
    institutionId: String(row.institution_id),
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

export class PgTimetableRepository implements TimetableRepository {
  constructor(
    private readonly pool: PgPoolLike,
    private readonly autoEnsureSchema = true,
  ) {}

  private async ready(): Promise<void> {
    if (this.autoEnsureSchema) {
      await ensureTimetableSchema(this.pool);
    }
  }

  async listBellSchedules(tenantId: string, filter?: ListBellSchedulesFilter) {
    return withSchemaCheck(async () => {
      await this.ready();
      const clauses = ['tenant_id = $1'];
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
      await this.ready();
      const result = await this.pool.query(
        `SELECT * FROM bell_schedules WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapBellSchedule(row) : null;
    });
  }

  async createBellSchedule(row: BellScheduleEntity) {
    return withSchemaCheck(async () => {
      await this.ready();
      const result = await this.pool.query(
        `INSERT INTO bell_schedules (
          id, tenant_id, institution_id, academic_period_id, name, day_pattern, status, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9::timestamptz)
        RETURNING *`,
        [
          row.id,
          row.tenantId,
          row.institutionId,
          row.academicPeriodId,
          row.name,
          row.dayPattern,
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
      await this.ready();
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
          institution_id = $3,
          academic_period_id = $4,
          name = $5,
          day_pattern = $6,
          status = $7,
          updated_at = $8::timestamptz
         WHERE tenant_id = $1 AND id = $2
         RETURNING *`,
        [
          tenantId,
          id,
          next.institutionId,
          next.academicPeriodId,
          next.name,
          next.dayPattern,
          next.status,
          next.updatedAt,
        ],
      );
      return mapBellSchedule(result.rows[0] as Record<string, unknown>);
    });
  }

  async deleteBellSchedule(tenantId: string, id: string) {
    return withSchemaCheck(async () => {
      await this.ready();
      const result = await this.pool.query(
        `DELETE FROM bell_schedules WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      return (result.rowCount ?? 0) > 0;
    });
  }

  async listPeriods(tenantId: string, bellScheduleId: string) {
    return withSchemaCheck(async () => {
      await this.ready();
      const result = await this.pool.query(
        `SELECT * FROM periods
         WHERE tenant_id = $1 AND bell_schedule_id = $2
         ORDER BY period_order ASC`,
        [tenantId, bellScheduleId],
      );
      return result.rows.map((row) => mapPeriod(row as Record<string, unknown>));
    });
  }

  async getPeriod(tenantId: string, id: string) {
    return withSchemaCheck(async () => {
      await this.ready();
      const result = await this.pool.query(
        `SELECT * FROM periods WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapPeriod(row) : null;
    });
  }

  async createPeriod(row: PeriodEntity) {
    return withSchemaCheck(async () => {
      await this.ready();
      const result = await this.pool.query(
        `INSERT INTO periods (
          id, tenant_id, bell_schedule_id, name, period_order, start_time, end_time, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9::timestamptz)
        RETURNING *`,
        [
          row.id,
          row.tenantId,
          row.bellScheduleId,
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
      await this.ready();
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
        `UPDATE periods SET
          name = $3,
          period_order = $4,
          start_time = $5,
          end_time = $6,
          updated_at = $7::timestamptz
         WHERE tenant_id = $1 AND id = $2
         RETURNING *`,
        [tenantId, id, next.name, next.periodOrder, next.startTime, next.endTime, next.updatedAt],
      );
      return mapPeriod(result.rows[0] as Record<string, unknown>);
    });
  }

  async deletePeriod(tenantId: string, id: string) {
    return withSchemaCheck(async () => {
      await this.ready();
      const result = await this.pool.query(
        `DELETE FROM periods WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      return (result.rowCount ?? 0) > 0;
    });
  }

  async listMeetings(tenantId: string, filter?: ListMeetingsFilter) {
    return withSchemaCheck(async () => {
      await this.ready();
      const clauses = ['tenant_id = $1'];
      const params: unknown[] = [tenantId];
      if (filter?.institutionId) {
        params.push(filter.institutionId);
        clauses.push(`institution_id = $${params.length}`);
      }
      if (filter?.academicPeriodId) {
        params.push(filter.academicPeriodId);
        clauses.push(`academic_period_id = $${params.length}`);
      }
      if (filter?.staffId) {
        params.push(filter.staffId);
        clauses.push(`staff_id = $${params.length}`);
      }
      const result = await this.pool.query(
        `SELECT * FROM section_meetings WHERE ${clauses.join(' AND ')}
         ORDER BY day_of_week ASC, period_id ASC`,
        params,
      );
      return result.rows.map((row) => mapMeeting(row as Record<string, unknown>));
    });
  }

  async getMeeting(tenantId: string, id: string) {
    return withSchemaCheck(async () => {
      await this.ready();
      const result = await this.pool.query(
        `SELECT * FROM section_meetings WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapMeeting(row) : null;
    });
  }

  async createMeeting(row: SectionMeetingEntity) {
    return withSchemaCheck(async () => {
      await this.ready();
      const result = await this.pool.query(
        `INSERT INTO section_meetings (
          id, tenant_id, institution_id, academic_period_id, section_id, subject_id,
          staff_id, period_id, room_id, day_of_week, status, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::timestamptz,$13::timestamptz
        ) RETURNING *`,
        [
          row.id,
          row.tenantId,
          row.institutionId,
          row.academicPeriodId,
          row.sectionId,
          row.subjectId,
          row.staffId,
          row.periodId,
          row.roomId,
          row.dayOfWeek,
          row.status,
          row.createdAt,
          row.updatedAt,
        ],
      );
      return mapMeeting(result.rows[0] as Record<string, unknown>);
    });
  }

  async updateMeeting(tenantId: string, id: string, patch: Partial<SectionMeetingEntity>) {
    return withSchemaCheck(async () => {
      await this.ready();
      const cur = await this.getMeeting(tenantId, id);
      if (!cur) return null;
      const next = {
        ...cur,
        ...patch,
        id: cur.id,
        tenantId: cur.tenantId,
        updatedAt: new Date().toISOString(),
      };
      const result = await this.pool.query(
        `UPDATE section_meetings SET
          section_id = $3,
          subject_id = $4,
          staff_id = $5,
          period_id = $6,
          room_id = $7,
          day_of_week = $8,
          status = $9,
          updated_at = $10::timestamptz
         WHERE tenant_id = $1 AND id = $2
         RETURNING *`,
        [
          tenantId,
          id,
          next.sectionId,
          next.subjectId,
          next.staffId,
          next.periodId,
          next.roomId,
          next.dayOfWeek,
          next.status,
          next.updatedAt,
        ],
      );
      return mapMeeting(result.rows[0] as Record<string, unknown>);
    });
  }

  async deleteMeeting(tenantId: string, id: string) {
    return withSchemaCheck(async () => {
      await this.ready();
      const result = await this.pool.query(
        `DELETE FROM section_meetings WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      return (result.rowCount ?? 0) > 0;
    });
  }

  async listSubstitutions(tenantId: string, filter?: ListSubstitutionsFilter) {
    return withSchemaCheck(async () => {
      await this.ready();
      const clauses = ['tenant_id = $1'];
      const params: unknown[] = [tenantId];
      if (filter?.institutionId) {
        params.push(filter.institutionId);
        clauses.push(`institution_id = $${params.length}`);
      }
      if (filter?.fromDate) {
        params.push(filter.fromDate);
        clauses.push(`substitution_date >= $${params.length}::date`);
      }
      if (filter?.toDate) {
        params.push(filter.toDate);
        clauses.push(`substitution_date <= $${params.length}::date`);
      }
      const result = await this.pool.query(
        `SELECT * FROM substitutions WHERE ${clauses.join(' AND ')}
         ORDER BY substitution_date DESC, created_at DESC`,
        params,
      );
      return result.rows.map((row) => mapSubstitution(row as Record<string, unknown>));
    });
  }

  async getSubstitution(tenantId: string, id: string) {
    return withSchemaCheck(async () => {
      await this.ready();
      const result = await this.pool.query(
        `SELECT * FROM substitutions WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapSubstitution(row) : null;
    });
  }

  async createSubstitution(row: SubstitutionEntity) {
    return withSchemaCheck(async () => {
      await this.ready();
      const result = await this.pool.query(
        `INSERT INTO substitutions (
          id, tenant_id, institution_id, section_meeting_id, original_staff_id,
          substitute_staff_id, substitution_date, reason, status, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10::timestamptz,$11::timestamptz
        ) RETURNING *`,
        [
          row.id,
          row.tenantId,
          row.institutionId,
          row.sectionMeetingId,
          row.originalStaffId,
          row.substituteStaffId,
          row.substitutionDate,
          row.reason,
          row.status,
          row.createdAt,
          row.updatedAt,
        ],
      );
      return mapSubstitution(result.rows[0] as Record<string, unknown>);
    });
  }
}

export function createPgTimetableRepository(): PgTimetableRepository | null {
  const pool = getSharedTimetablePool();
  if (!pool) return null;
  return new PgTimetableRepository(pool);
}
