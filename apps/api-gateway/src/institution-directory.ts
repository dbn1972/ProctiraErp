/**
 * Tenant-scoped institution directory aggregates.
 *
 * Students enrolled, staff assigned, and today's attendance are read from
 * existing tables (enrollments, staff_assignments, student_attendance).
 * Missing tables or no database return nulls — never fabricated counts.
 * Board labels come only from `boards`, never from geographic area names.
 */
import { getSharedPgPool, withPgTenant, type PgQueryable } from '@proctira/database';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export interface InstitutionDirectorySchool {
  studentCount: number | null;
  staffCount: number | null;
  attendancePercent: number | null;
}

export interface InstitutionDirectoryContext {
  organizationName: string | null;
  /** Education board code or name. Never a geographic area. */
  boardLabel: string | null;
  studentsEnrolled: number | null;
  /** Schools with at least one student-attendance row dated today. */
  reportingToday: number | null;
  /** True when the source table was readable. Missing schools then mean zero. */
  studentsAvailable: boolean;
  staffAvailable: boolean;
  attendanceAvailable: boolean;
  schools: Record<string, InstitutionDirectorySchool>;
}

export const EMPTY_DIRECTORY_CONTEXT: InstitutionDirectoryContext = {
  organizationName: null,
  boardLabel: null,
  studentsEnrolled: null,
  reportingToday: null,
  studentsAvailable: false,
  staffAvailable: false,
  attendanceAvailable: false,
  schools: {},
};

interface BoardRow {
  code: string;
  name: string;
}

/** Board chip text. Area names are not accepted as a board. */
export function boardLabelFromRows(rows: BoardRow[]): string | null {
  const labels = rows
    .map((row) => {
      const code = row.code?.trim();
      const name = row.name?.trim();
      if (code && code.length > 0 && code.length <= 16) return code;
      return name || code || '';
    })
    .filter((label) => label.length > 0);
  if (labels.length === 0) return null;
  if (labels.length <= 3) return labels.join(' · ');
  return `${labels.slice(0, 3).join(' · ')} …`;
}

async function relationExists(client: PgQueryable, name: string): Promise<boolean> {
  try {
    const result = await client.query(`SELECT to_regclass($1) AS reg`, [`public.${name}`]);
    const row = result.rows[0] as { reg?: string | null } | undefined;
    return Boolean(row?.reg);
  } catch {
    return false;
  }
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

async function scalar(client: PgQueryable, sql: string, params: unknown[]): Promise<number | null> {
  try {
    const result = await client.query(sql, params);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return asNumber(row?.['value']);
  } catch {
    return null;
  }
}

export async function loadInstitutionDirectoryContext(
  tenantId: string,
  client: PgQueryable,
): Promise<InstitutionDirectoryContext> {
  const context: InstitutionDirectoryContext = {
    organizationName: null,
    boardLabel: null,
    studentsEnrolled: null,
    reportingToday: null,
    studentsAvailable: false,
    staffAvailable: false,
    attendanceAvailable: false,
    schools: {},
  };

  if (await relationExists(client, 'tenants')) {
    try {
      const result = await client.query(
        `SELECT name FROM tenants WHERE id = $1::uuid AND deleted_at IS NULL LIMIT 1`,
        [tenantId],
      );
      const row = result.rows[0] as { name?: unknown } | undefined;
      context.organizationName = typeof row?.name === 'string' ? row.name : null;
    } catch {
      context.organizationName = null;
    }
  }

  if (await relationExists(client, 'boards')) {
    try {
      const result = await client.query(
        `SELECT code, name
           FROM boards
          WHERE tenant_id = $1::uuid
            AND deleted_at IS NULL
          ORDER BY name
          LIMIT 8`,
        [tenantId],
      );
      const rows = result.rows as BoardRow[];
      context.boardLabel = boardLabelFromRows(rows);
    } catch {
      context.boardLabel = null;
    }
  }

  const hasEnrollments = await relationExists(client, 'enrollments');
  const hasStaff = await relationExists(client, 'staff_assignments');
  const hasAttendance = await relationExists(client, 'student_attendance');

  if (hasEnrollments) {
    context.studentsEnrolled = await scalar(
      client,
      `SELECT COUNT(*)::int AS value
         FROM enrollments
        WHERE tenant_id = $1::uuid
          AND status = 'ENROLLED'`,
      [tenantId],
    );
    context.studentsAvailable = context.studentsEnrolled !== null;
    try {
      const result = await client.query(
        `SELECT institution_id::text AS id, COUNT(*)::int AS student_count
           FROM enrollments
          WHERE tenant_id = $1::uuid
            AND status = 'ENROLLED'
          GROUP BY institution_id`,
        [tenantId],
      );
      for (const row of result.rows as { id?: unknown; student_count?: unknown }[]) {
        if (typeof row.id !== 'string') continue;
        context.schools[row.id] = {
          studentCount: asNumber(row.student_count),
          staffCount: null,
          attendancePercent: null,
        };
      }
    } catch {
      // Leave per-school student counts unset; KPI already captured the failure as null.
    }
  }

  if (hasStaff) {
    try {
      const result = await client.query(
        `SELECT institution_id::text AS id, COUNT(DISTINCT staff_id)::int AS staff_count
           FROM staff_assignments
          WHERE tenant_id = $1::uuid
            AND status = 'ACTIVE'
            AND (end_date IS NULL OR end_date >= CURRENT_DATE)
          GROUP BY institution_id`,
        [tenantId],
      );
      for (const row of result.rows as { id?: unknown; staff_count?: unknown }[]) {
        if (typeof row.id !== 'string') continue;
        const existing = context.schools[row.id] ?? {
          studentCount: null,
          staffCount: null,
          attendancePercent: null,
        };
        existing.staffCount = asNumber(row.staff_count);
        context.schools[row.id] = existing;
      }
      context.staffAvailable = true;
    } catch {
      context.staffAvailable = false;
    }
  }

  if (hasAttendance) {
    context.attendanceAvailable = true;
    context.reportingToday = await scalar(
      client,
      `SELECT COUNT(DISTINCT institution_id)::int AS value
         FROM student_attendance
        WHERE tenant_id = $1::uuid
          AND date = CURRENT_DATE`,
      [tenantId],
    );
    try {
      const result = await client.query(
        `SELECT institution_id::text AS id,
                CASE
                  WHEN COUNT(*) = 0 THEN NULL
                  ELSE ROUND(
                    100.0 * COUNT(*) FILTER (WHERE UPPER(status) IN ('PRESENT', 'LATE'))
                    / COUNT(*)
                  )::int
                END AS attendance_percent
           FROM student_attendance
          WHERE tenant_id = $1::uuid
            AND date = CURRENT_DATE
          GROUP BY institution_id`,
        [tenantId],
      );
      for (const row of result.rows as { id?: unknown; attendance_percent?: unknown }[]) {
        if (typeof row.id !== 'string') continue;
        const existing = context.schools[row.id] ?? {
          studentCount: null,
          staffCount: null,
          attendancePercent: null,
        };
        existing.attendancePercent = asNumber(row.attendance_percent);
        context.schools[row.id] = existing;
      }
    } catch {
      context.reportingToday = null;
    }
  }

  return context;
}

export function registerInstitutionDirectoryRoutes(fastify: FastifyInstance): void {
  fastify.get(
    '/institutions/directory-context',
    async function directoryContextHandler(request: FastifyRequest, reply: FastifyReply) {
      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const pool = getSharedPgPool();
      if (!pool) {
        return reply.status(200).send(EMPTY_DIRECTORY_CONTEXT);
      }

      try {
        const context = await withPgTenant(pool, tenantId, (client) =>
          loadInstitutionDirectoryContext(tenantId, client),
        );
        return reply.status(200).send(context);
      } catch {
        return reply.status(200).send(EMPTY_DIRECTORY_CONTEXT);
      }
    },
  );
}
