/**
 * Tenant-scoped institution overview aggregates.
 *
 * Counts, enrollment bars, and activity come from existing tables.
 * A missing table or query failure yields null / an empty list — never a
 * fabricated number. Cross-tenant ids return null so the route can 404.
 */
import { getSharedPgPool, withPgTenant, type PgQueryable } from '@proctira/database';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { createGatewayRbacRegistry } from './rbac-registry.js';

const overviewRbac = createGatewayRbacRegistry();

export interface EnrollmentByGrade {
  gradeId: string;
  code: string;
  name: string;
  count: number;
}

export interface OverviewActivity {
  title: string;
  meta: string;
  tone: 'green' | 'amber' | 'brand';
}

export interface OverviewFacts {
  medium: string;
  established: string;
  shift: string;
  headmaster: string;
}

export interface InstitutionOverview {
  students: number | null;
  staff: number | null;
  attendancePercent: number | null;
  classrooms: number | null;
  studentsAvailable: boolean;
  staffAvailable: boolean;
  attendanceAvailable: boolean;
  classroomsAvailable: boolean;
  enrollmentAvailable: boolean;
  activityAvailable: boolean;
  enrollmentByGrade: EnrollmentByGrade[];
  activity: OverviewActivity[];
  facts: OverviewFacts;
}

const EMPTY_FACTS: OverviewFacts = { medium: '', established: '', shift: '', headmaster: '' };

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
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

function readFact(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function toneFrom(value: unknown): OverviewActivity['tone'] {
  if (value === 'green' || value === 'amber' || value === 'brand') return value;
  return 'brand';
}

export async function loadInstitutionOverview(
  tenantId: string,
  institutionId: string,
  client: PgQueryable,
): Promise<InstitutionOverview | null> {
  if (!(await relationExists(client, 'institutions'))) return null;

  let customData: Record<string, unknown> = {};
  try {
    const found = await client.query(
      `SELECT custom_data
         FROM institutions
        WHERE tenant_id = $1::uuid
          AND id = $2::uuid
          AND deleted_at IS NULL`,
      [tenantId, institutionId],
    );
    const row = found.rows[0] as { custom_data?: unknown } | undefined;
    if (!row) return null;
    if (row.custom_data && typeof row.custom_data === 'object') {
      customData = row.custom_data as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  const overview: InstitutionOverview = {
    students: null,
    staff: null,
    attendancePercent: null,
    classrooms: null,
    studentsAvailable: false,
    staffAvailable: false,
    attendanceAvailable: false,
    classroomsAvailable: false,
    enrollmentAvailable: false,
    activityAvailable: false,
    enrollmentByGrade: [],
    activity: [],
    facts: {
      medium: readFact(customData, 'medium'),
      established: readFact(customData, 'established'),
      shift: readFact(customData, 'shift'),
      headmaster: readFact(customData, 'headmaster'),
    },
  };

  if (await relationExists(client, 'enrollments')) {
    try {
      const result = await client.query(
        `SELECT COUNT(DISTINCT student_id)::int AS value
           FROM enrollments
          WHERE tenant_id = $1::uuid
            AND institution_id = $2::uuid
            AND status = 'ENROLLED'`,
        [tenantId, institutionId],
      );
      overview.students = asNumber((result.rows[0] as { value?: unknown } | undefined)?.value);
      overview.studentsAvailable = true;
    } catch {
      overview.studentsAvailable = false;
    }

    if (await relationExists(client, 'grades')) {
      try {
        const result = await client.query(
          `SELECT g.id::text AS grade_id,
                  g.code,
                  g.name,
                  COUNT(DISTINCT e.student_id)::int AS count
             FROM enrollments e
             JOIN grades g ON g.id = e.grade_id AND g.tenant_id = e.tenant_id
            WHERE e.tenant_id = $1::uuid
              AND e.institution_id = $2::uuid
              AND e.status = 'ENROLLED'
            GROUP BY g.id, g.code, g.name, g."order"
            ORDER BY g."order"`,
          [tenantId, institutionId],
        );
        overview.enrollmentByGrade = (result.rows as Record<string, unknown>[])
          .map((row) => ({
            gradeId: String(row.grade_id ?? ''),
            code: String(row.code ?? ''),
            name: String(row.name ?? ''),
            count: asNumber(row.count) ?? 0,
          }))
          .filter((row) => row.gradeId.length > 0);
        overview.enrollmentAvailable = true;
      } catch {
        overview.enrollmentAvailable = false;
      }
    }
  }

  if (await relationExists(client, 'staff_assignments')) {
    try {
      const result = await client.query(
        `SELECT COUNT(DISTINCT staff_id)::int AS value
           FROM staff_assignments
          WHERE tenant_id = $1::uuid
            AND institution_id = $2::uuid
            AND status = 'ACTIVE'
            AND (end_date IS NULL OR end_date >= CURRENT_DATE)`,
        [tenantId, institutionId],
      );
      overview.staff = asNumber((result.rows[0] as { value?: unknown } | undefined)?.value);
      overview.staffAvailable = true;
    } catch {
      overview.staffAvailable = false;
    }
  }

  if (await relationExists(client, 'student_attendance')) {
    try {
      const result = await client.query(
        `SELECT CASE
                  WHEN COUNT(*) = 0 THEN NULL
                  ELSE ROUND(
                    100.0 * COUNT(*) FILTER (WHERE UPPER(status) IN ('PRESENT', 'LATE'))
                    / COUNT(*)
                  )::int
                END AS value
           FROM student_attendance
          WHERE tenant_id = $1::uuid
            AND institution_id = $2::uuid
            AND date >= (CURRENT_DATE - INTERVAL '30 days')`,
        [tenantId, institutionId],
      );
      overview.attendancePercent = asNumber(
        (result.rows[0] as { value?: unknown } | undefined)?.value,
      );
      overview.attendanceAvailable = true;
    } catch {
      overview.attendanceAvailable = false;
    }
  }

  if (await relationExists(client, 'rooms')) {
    try {
      const result = await client.query(
        `SELECT COUNT(*)::int AS value
           FROM rooms
          WHERE tenant_id = $1::uuid
            AND institution_id = $2::uuid
            AND deleted_at IS NULL`,
        [tenantId, institutionId],
      );
      overview.classrooms = asNumber((result.rows[0] as { value?: unknown } | undefined)?.value);
      overview.classroomsAvailable = true;
    } catch {
      overview.classroomsAvailable = false;
    }
  }

  if (await relationExists(client, 'audit_log_entries')) {
    try {
      const result = await client.query(
        `SELECT user_name, occurred_at, metadata
           FROM audit_log_entries
          WHERE tenant_id = $1
            AND (
              entity_id = $2
              OR metadata->>'institutionId' = $2
            )
          ORDER BY occurred_at DESC
          LIMIT 8`,
        [tenantId, institutionId],
      );
      overview.activity = (result.rows as Record<string, unknown>[])
        .map((row) => {
          const metadata =
            row.metadata && typeof row.metadata === 'object'
              ? (row.metadata as Record<string, unknown>)
              : {};
          const title = readFact(metadata, 'title');
          if (!title) return null;
          const when =
            row.occurred_at instanceof Date
              ? row.occurred_at.toLocaleString('en-IN', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  timeZone: 'Asia/Kolkata',
                })
              : String(row.occurred_at ?? '');
          const who = typeof row.user_name === 'string' ? row.user_name : '';
          return {
            title,
            meta: [when, who].filter(Boolean).join(' · '),
            tone: toneFrom(metadata.tone),
          };
        })
        .filter((item): item is OverviewActivity => item !== null);
      overview.activityAvailable = true;
    } catch {
      overview.activityAvailable = false;
    }
  }

  if (
    overview.facts.medium === '' &&
    overview.facts.established === '' &&
    overview.facts.shift === '' &&
    overview.facts.headmaster === ''
  ) {
    overview.facts = { ...EMPTY_FACTS };
  }

  return overview;
}

export interface InstitutionOverviewRouteDeps {
  /** When set, skips the shared pool (used by route tests). */
  run?: <T>(tenantId: string, fn: (client: PgQueryable) => Promise<T>) => Promise<T>;
}

export function registerInstitutionOverviewRoutes(
  fastify: FastifyInstance,
  deps: InstitutionOverviewRouteDeps = {},
): void {
  const run =
    deps.run ??
    (<T>(tenantId: string, fn: (client: PgQueryable) => Promise<T>) => {
      const pool = getSharedPgPool();
      if (!pool) {
        throw Object.assign(new Error('NO_POOL'), { code: 'NO_POOL' });
      }
      return withPgTenant(pool, tenantId, fn);
    });

  fastify.get(
    '/institutions/:id/overview',
    async function overviewHandler(
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) {
      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      const roles = (request as FastifyRequest & { user?: { roles?: { roleId: string }[] } }).user
        ?.roles;
      if (
        roles &&
        !roles.some((role) => overviewRbac.roleHasPermission(role.roleId, 'institution', 'read'))
      ) {
        return reply.status(403).send({
          code: 'FORBIDDEN',
          message: 'Insufficient permissions',
          statusCode: 403,
        });
      }
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const institutionId = request.params.id;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(institutionId)) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Institution id must be a UUID',
          statusCode: 400,
        });
      }

      try {
        const overview = await run(tenantId, (client) =>
          loadInstitutionOverview(tenantId, institutionId, client),
        );
        if (!overview) {
          return reply.status(404).send({
            code: 'NOT_FOUND',
            message: 'Institution not found',
            statusCode: 404,
          });
        }
        return reply.status(200).send(overview);
      } catch (error) {
        const code = (error as { code?: string }).code;
        return reply.status(code === 'NO_POOL' ? 503 : 503).send({
          code: 'SERVICE_UNAVAILABLE',
          message: 'Institution details are currently unavailable.',
          statusCode: 503,
        });
      }
    },
  );
}
