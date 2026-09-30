/**
 * Catalogue data providers — query live domain tables (same relations insights
 * board-summary uses).
 *
 * PRC-H080: providers never fabricate data. No rows -> header-only table; a
 * missing relation, query error or absent pool throws
 * {@link ReportDataUnavailableError} so the run is marked `failed` with no
 * artifact. Demo rows are served ONLY in explicit non-production demo mode
 * (`REPORT_DEMO_DATA=1` and `NODE_ENV !== 'production'`).
 */
import { AppError } from '@proctira/common';
import { getSharedPgPool, withPgTenant, type PgQueryable } from '@proctira/database';

import type { CatalogueReportKey } from './catalogue.js';
import type { ReportTable } from './generators.js';

/** Thrown when live report data cannot be read; the run must fail (no artifact). */
export class ReportDataUnavailableError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, 'REPORT_DATA_UNAVAILABLE', 503);
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/** Demo rows are allowed only when explicitly opted in outside production. */
export function isReportDemoDataEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== 'production' && env.REPORT_DEMO_DATA === '1';
}

async function relationExists(client: PgQueryable, name: string): Promise<boolean> {
  const result = await client.query(`SELECT to_regclass($1) AS reg`, [`public.${name}`]);
  const row = result.rows[0] as { reg?: string | null } | undefined;
  return Boolean(row?.reg);
}

async function requireRelation(client: PgQueryable, name: string): Promise<void> {
  if (!(await relationExists(client, name))) {
    throw new ReportDataUnavailableError(`Report source relation '${name}' is not available`);
  }
}

function demoTable(key: CatalogueReportKey, tenantId: string): ReportTable {
  if (key === 'students_roster') {
    return {
      columns: [
        { name: 'studentId', label: 'Student ID' },
        { name: 'firstName', label: 'First name' },
        { name: 'lastName', label: 'Last name' },
        { name: 'gender', label: 'Gender' },
        { name: 'dateOfBirth', label: 'Date of birth' },
        { name: 'tenantId', label: 'Tenant' },
      ],
      rows: [
        {
          studentId: 'demo-stu-1',
          firstName: 'Asha',
          lastName: 'Rao',
          gender: 'female',
          dateOfBirth: '2012-04-11',
          tenantId,
        },
        {
          studentId: 'demo-stu-2',
          firstName: 'Vikram',
          lastName: 'Singh',
          gender: 'male',
          dateOfBirth: '2011-09-02',
          tenantId,
        },
      ],
    };
  }
  if (key === 'attendance_summary') {
    return {
      columns: [
        { name: 'grade', label: 'Grade' },
        { name: 'present', label: 'Present' },
        { name: 'absent', label: 'Absent' },
        { name: 'late', label: 'Late' },
        { name: 'tenantId', label: 'Tenant' },
      ],
      rows: [
        { grade: 'Grade 6', present: 28, absent: 2, late: 1, tenantId },
        { grade: 'Grade 7', present: 30, absent: 0, late: 0, tenantId },
      ],
    };
  }
  if (key === 'fee_dues') {
    return {
      columns: [
        { name: 'studentId', label: 'Student' },
        { name: 'title', label: 'Invoice' },
        { name: 'status', label: 'Status' },
        { name: 'amountCents', label: 'Amount (cents)' },
        { name: 'tenantId', label: 'Tenant' },
      ],
      rows: [
        {
          studentId: 'demo-student',
          title: 'Term 1 tuition',
          status: 'open',
          amountCents: 150000,
          tenantId,
        },
      ],
    };
  }
  if (key === 'enrolment_by_grade') {
    return {
      columns: [
        { name: 'grade', label: 'Grade' },
        { name: 'status', label: 'Status' },
        { name: 'headcount', label: 'Headcount' },
        { name: 'tenantId', label: 'Tenant' },
      ],
      rows: [
        { grade: 'Grade 6', status: 'ENROLLED', headcount: 31, tenantId },
        { grade: 'Grade 7', status: 'ENROLLED', headcount: 30, tenantId },
      ],
    };
  }
  return {
    columns: [
      { name: 'examination', label: 'Examination' },
      { name: 'candidate', label: 'Candidate' },
      { name: 'marks', label: 'Marks' },
      { name: 'result', label: 'Result' },
      { name: 'tenantId', label: 'Tenant' },
    ],
    rows: [
      {
        examination: 'Annual 2026',
        candidate: 'Demo candidate',
        marks: 78,
        result: 'PASS',
        tenantId,
      },
    ],
  };
}

async function loadStudentsRoster(client: PgQueryable, tenantId: string): Promise<ReportTable> {
  await requireRelation(client, 'students');
  const { rows } = await client.query(
    `SELECT id::text AS student_id, first_name, last_name, gender, date_of_birth::text AS date_of_birth
         FROM students
        WHERE deleted_at IS NULL
        ORDER BY last_name, first_name
        LIMIT 500`,
  );
  return {
    columns: [
      { name: 'studentId', label: 'Student ID' },
      { name: 'firstName', label: 'First name' },
      { name: 'lastName', label: 'Last name' },
      { name: 'gender', label: 'Gender' },
      { name: 'dateOfBirth', label: 'Date of birth' },
      { name: 'tenantId', label: 'Tenant' },
    ],
    rows: (
      rows as Array<{
        student_id: string;
        first_name: string;
        last_name: string;
        gender: string;
        date_of_birth: string;
      }>
    ).map((r) => ({
      studentId: r.student_id,
      firstName: r.first_name,
      lastName: r.last_name,
      gender: r.gender,
      dateOfBirth: r.date_of_birth,
      tenantId,
    })),
  };
}

async function loadAttendance(client: PgQueryable, tenantId: string): Promise<ReportTable> {
  await requireRelation(client, 'student_attendance');
  const { rows } = await client.query(
    `SELECT COALESCE(grade_id::text, 'unspecified') AS grade,
              COUNT(*) FILTER (WHERE status IN ('PRESENT', 'LATE', 'present', 'late'))::int AS present,
              COUNT(*) FILTER (WHERE status IN ('ABSENT', 'absent'))::int AS absent,
              COUNT(*) FILTER (WHERE status IN ('LATE', 'late'))::int AS late
         FROM student_attendance
        GROUP BY 1
        ORDER BY 1`,
  );
  return {
    columns: [
      { name: 'grade', label: 'Grade' },
      { name: 'present', label: 'Present' },
      { name: 'absent', label: 'Absent' },
      { name: 'late', label: 'Late' },
      { name: 'tenantId', label: 'Tenant' },
    ],
    rows: (rows as Array<{ grade: string; present: number; absent: number; late: number }>).map(
      (r) => ({
        grade: r.grade,
        present: r.present,
        absent: r.absent,
        late: r.late,
        tenantId,
      }),
    ),
  };
}

async function loadFeeDues(client: PgQueryable, tenantId: string): Promise<ReportTable> {
  await requireRelation(client, 'parent_fee_invoices');
  const { rows } = await client.query(
    `SELECT student_id::text AS student_id, title, status, amount_cents
         FROM parent_fee_invoices
        WHERE status IN ('open', 'overdue')
        ORDER BY due_at NULLS LAST, created_at DESC
        LIMIT 500`,
  );
  return {
    columns: [
      { name: 'studentId', label: 'Student' },
      { name: 'title', label: 'Invoice' },
      { name: 'status', label: 'Status' },
      { name: 'amountCents', label: 'Amount (cents)' },
      { name: 'tenantId', label: 'Tenant' },
    ],
    rows: (
      rows as Array<{ student_id: string; title: string; status: string; amount_cents: number }>
    ).map((r) => ({
      studentId: r.student_id,
      title: r.title,
      status: r.status,
      amountCents: r.amount_cents,
      tenantId,
    })),
  };
}

async function loadEnrolment(
  client: PgQueryable,
  tenantId: string,
  filters: Record<string, unknown>,
): Promise<ReportTable> {
  await requireRelation(client, 'enrollments');
  const period = typeof filters.academicPeriodId === 'string' ? filters.academicPeriodId : null;
  const { rows } = period
    ? await client.query(
        `SELECT COALESCE(g.name, e.grade_id::text) AS grade, e.status::text AS status, COUNT(*)::int AS headcount
             FROM enrollments e
             LEFT JOIN grades g ON g.id = e.grade_id
            WHERE e.academic_period_id::text = $1
            GROUP BY 1, 2
            ORDER BY 1, 2`,
        [period],
      )
    : await client.query(
        `SELECT COALESCE(g.name, e.grade_id::text) AS grade, e.status::text AS status, COUNT(*)::int AS headcount
             FROM enrollments e
             LEFT JOIN grades g ON g.id = e.grade_id
            GROUP BY 1, 2
            ORDER BY 1, 2`,
      );
  return {
    columns: [
      { name: 'grade', label: 'Grade' },
      { name: 'status', label: 'Status' },
      { name: 'headcount', label: 'Headcount' },
      { name: 'tenantId', label: 'Tenant' },
    ],
    rows: (rows as Array<{ grade: string; status: string; headcount: number }>).map((r) => ({
      grade: r.grade,
      status: r.status,
      headcount: r.headcount,
      tenantId,
    })),
  };
}

async function loadExamResults(client: PgQueryable, tenantId: string): Promise<ReportTable> {
  for (const table of ['examination_results', 'exam_results', 'candidate_results']) {
    if (!(await relationExists(client, table))) continue;
    const result = await client.query(`SELECT * FROM ${table} LIMIT 200`);
    const rows = result.rows as Record<string, unknown>[];
    const fieldNames = Array.isArray(result.fields)
      ? (result.fields as Array<{ name: string }>).map((f) => f.name)
      : Object.keys(rows[0] ?? {});
    const keys = fieldNames.filter((k) => k !== 'tenant_id').slice(0, 6);
    return {
      columns: [...keys.map((k) => ({ name: k, label: k })), { name: 'tenantId', label: 'Tenant' }],
      rows: rows.map((r) => ({
        ...Object.fromEntries(keys.map((k) => [k, r[k]])),
        tenantId,
      })),
    };
  }
  throw new ReportDataUnavailableError('No examination results relation is available');
}

async function loadLive(
  client: PgQueryable,
  tenantId: string,
  key: CatalogueReportKey,
  filters: Record<string, unknown>,
): Promise<ReportTable> {
  if (key === 'students_roster') return loadStudentsRoster(client, tenantId);
  if (key === 'attendance_summary') return loadAttendance(client, tenantId);
  if (key === 'fee_dues') return loadFeeDues(client, tenantId);
  if (key === 'enrolment_by_grade') return loadEnrolment(client, tenantId, filters);
  return loadExamResults(client, tenantId);
}

export async function fetchCatalogueTable(
  tenantId: string,
  key: CatalogueReportKey,
  filters: Record<string, unknown> = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<ReportTable> {
  const pool = getSharedPgPool();
  if (!pool) {
    // PRC-H080: synthetic rows only in explicit non-production demo mode.
    if (isReportDemoDataEnabled(env)) return demoTable(key, tenantId);
    throw new ReportDataUnavailableError(
      'Report data source is not configured (no database pool); refusing to fabricate rows',
    );
  }
  try {
    return await withPgTenant(pool, tenantId, (client) => loadLive(client, tenantId, key, filters));
  } catch (error: unknown) {
    if (error instanceof ReportDataUnavailableError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new ReportDataUnavailableError(`Report query failed for '${key}': ${message}`, error);
  }
}
