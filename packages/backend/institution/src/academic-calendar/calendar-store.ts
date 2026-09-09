/**
 * G-905 — calendar event persistence: raw pg (db/sql/030, RLS via
 * withPgTenant) or an in-memory map for dev / unit tests.
 */
import { withPgTenant, type PgQueryable } from '@proctira/database';

import type { CalendarEventKind } from './schemas.js';

export interface CalendarEventRecord {
  id: string;
  tenantId: string;
  academicPeriodId: string;
  institutionId: string | null;
  kind: CalendarEventKind;
  name: string;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD */
  endDate: string;
  notes: string | null;
  createdAt: Date;
}

export interface CalendarStore {
  create(record: CalendarEventRecord): Promise<CalendarEventRecord>;
  listByPeriod(tenantId: string, academicPeriodId: string): Promise<CalendarEventRecord[]>;
  findById(tenantId: string, id: string): Promise<CalendarEventRecord | null>;
  delete(tenantId: string, id: string): Promise<boolean>;
}

export class InMemoryCalendarStore implements CalendarStore {
  private readonly rows = new Map<string, CalendarEventRecord>();

  async create(record: CalendarEventRecord): Promise<CalendarEventRecord> {
    this.rows.set(record.id, { ...record });
    return { ...record };
  }

  async listByPeriod(tenantId: string, academicPeriodId: string): Promise<CalendarEventRecord[]> {
    return Array.from(this.rows.values())
      .filter((r) => r.tenantId === tenantId && r.academicPeriodId === academicPeriodId)
      .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name));
  }

  async findById(tenantId: string, id: string): Promise<CalendarEventRecord | null> {
    const row = this.rows.get(id);
    return row && row.tenantId === tenantId ? { ...row } : null;
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.tenantId !== tenantId) return false;
    this.rows.delete(id);
    return true;
  }
}

type CalendarRow = {
  id: string;
  tenant_id: string;
  academic_period_id: string;
  institution_id: string | null;
  kind: string;
  name: string;
  start_date: string | Date;
  end_date: string | Date;
  notes: string | null;
  created_at: Date;
};

function isoDate(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function toRecord(row: CalendarRow): CalendarEventRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    academicPeriodId: row.academic_period_id,
    institutionId: row.institution_id,
    kind: row.kind as CalendarEventKind,
    name: row.name,
    startDate: isoDate(row.start_date),
    endDate: isoDate(row.end_date),
    notes: row.notes,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
  };
}

export type CalendarPool = PgQueryable & { connect?: unknown };

export class PgCalendarStore implements CalendarStore {
  constructor(private readonly pool: CalendarPool) {}

  private run<T>(tenantId: string, fn: (client: PgQueryable) => Promise<T>): Promise<T> {
    return withPgTenant(this.pool as never, tenantId, fn);
  }

  async create(record: CalendarEventRecord): Promise<CalendarEventRecord> {
    return this.run(record.tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO academic_calendar_events
           (id, tenant_id, academic_period_id, institution_id, kind, name, start_date, end_date, notes, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9,$10)
         RETURNING *`,
        [
          record.id,
          record.tenantId,
          record.academicPeriodId,
          record.institutionId,
          record.kind,
          record.name,
          record.startDate,
          record.endDate,
          record.notes,
          record.createdAt,
        ],
      );
      return toRecord(rows[0] as CalendarRow);
    });
  }

  async listByPeriod(tenantId: string, academicPeriodId: string): Promise<CalendarEventRecord[]> {
    return this.run(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM academic_calendar_events
          WHERE tenant_id = $1 AND academic_period_id = $2
          ORDER BY start_date ASC, name ASC`,
        [tenantId, academicPeriodId],
      );
      return (rows as CalendarRow[]).map(toRecord);
    });
  }

  async findById(tenantId: string, id: string): Promise<CalendarEventRecord | null> {
    return this.run(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM academic_calendar_events WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [tenantId, id],
      );
      return rows[0] ? toRecord(rows[0] as CalendarRow) : null;
    });
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    return this.run(tenantId, async (client) => {
      const result = await client.query(
        `DELETE FROM academic_calendar_events WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      return Number((result as { rowCount?: number }).rowCount ?? 0) > 0;
    });
  }
}
