/**
 * PRC-M173: holiday-calendar lookup for attendance leave approval.
 *
 * Non-school days are `academic_calendar_events` rows of kind `holiday` or `break`
 * (db/sql/030_academic_calendar_schema.sql; G-905 treats both as non-instructional periods)
 * for the tenant, scoped to the leave's institution or tenant-wide (`institution_id IS NULL`).
 * Each overlapping event is expanded to its calendar dates, clipped to [fromDate, toDate].
 */
import type { AttendanceHolidayLookup } from '@proctira/backend-attendance';
import { type getSharedPgPool, withPgTenant } from '@proctira/database';

type SharedPool = NonNullable<ReturnType<typeof getSharedPgPool>>;

const NON_SCHOOL_DAY_KINDS = ['holiday', 'break'] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDay(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

function formatDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Returns undefined when no shared pool exists (in-memory deployments keep today's behaviour). */
export function createAttendanceHolidayLookup(
  pool: SharedPool | null,
): AttendanceHolidayLookup | undefined {
  if (!pool) return undefined;
  return async (tenantId, institutionId, fromDate, toDate) => {
    const rows = await withPgTenant(pool, tenantId, async (client) => {
      const result = await client.query(
        `SELECT start_date::text AS start_date, end_date::text AS end_date
           FROM academic_calendar_events
          WHERE tenant_id = $1::uuid
            AND kind = ANY($2::text[])
            AND (institution_id IS NULL OR institution_id::text = $3)
            AND start_date <= $5::date
            AND end_date >= $4::date`,
        [tenantId, [...NON_SCHOOL_DAY_KINDS], institutionId, fromDate, toDate],
      );
      return result.rows as Array<{ start_date: string; end_date: string }>;
    });
    const from = parseDay(fromDate);
    const to = parseDay(toDate);
    const days = new Set<string>();
    for (const row of rows) {
      const start = Math.max(parseDay(row.start_date), from);
      const end = Math.min(parseDay(row.end_date), to);
      for (let day = start; day <= end; day += DAY_MS) days.add(formatDay(day));
    }
    return days;
  };
}
