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
import { AppError, ValidationError } from '@proctira/common';
import { isProductionNodeEnv } from '@proctira/common/node-env';
import { getSharedPgPool, withPgTenant, type PgQueryable } from '@proctira/database';

import type { CatalogueReportKey } from './catalogue.js';
import type { ReportTable } from './generators.js';

/** Hard cap on rows in a single catalogue report (see catalogue-service). */
export const MAX_CATALOGUE_REPORT_ROWS = 25_000;
/**
 * PRC-M342: providers fetch cap+1 rows so an oversized result is detected and
 * rejected by the cap check instead of being silently truncated.
 */
export const CATALOGUE_FETCH_LIMIT = MAX_CATALOGUE_REPORT_ROWS + 1;
/** Thrown when live report data cannot be read; the run must fail (no artifact). */
export class ReportDataUnavailableError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, 'REPORT_DATA_UNAVAILABLE', 503);
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/** Demo rows are allowed only when explicitly opted in outside production. */
export function isReportDemoDataEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !isProductionNodeEnv(env.NODE_ENV) && env.REPORT_DEMO_DATA === '1';
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
        LIMIT $1`,
    [CATALOGUE_FETCH_LIMIT],
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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * PRC-H081: student_attendance has no grade_id — derive the grade via
 * classes.grade_id -> grades, and honour the catalogue `date` filter.
 */
async function loadAttendance(
  client: PgQueryable,
  tenantId: string,
  filters: Record<string, unknown>,
): Promise<ReportTable> {
  await requireRelation(client, 'student_attendance');
  const date = filters.date;
  if (date !== undefined && date !== null && date !== '') {
    if (typeof date !== 'string' || !ISO_DATE.test(date)) {
      throw new ValidationError('Invalid attendance report date filter', [
        { field: 'filters.date', rule: 'format', message: 'Expected YYYY-MM-DD' },
      ]);
    }
  }
  const dateFilter = typeof date === 'string' && date !== '' ? date : null;
  const { rows } = await client.query(
    `SELECT COALESCE(g.name, 'unspecified') AS grade,
            COUNT(*) FILTER (WHERE sa.status IN ('PRESENT', 'LATE'))::int AS present,
            COUNT(*) FILTER (WHERE sa.status = 'ABSENT')::int AS absent,
            COUNT(*) FILTER (WHERE sa.status = 'LATE')::int AS late
       FROM student_attendance sa
       LEFT JOIN classes c ON c.id = sa.class_id
       LEFT JOIN grades g ON g.id = c.grade_id
      WHERE ($1::date IS NULL OR sa.date = $1::date)
      GROUP BY 1
      ORDER BY 1`,
    [dateFilter],
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
        LIMIT $1`,
    [CATALOGUE_FETCH_LIMIT],
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

/**
 * PRC-M343 (topic 9 Option A): results are read only from published marks.
 * `examination_academic_records` is written at result publication (one row per
 * student x subject x examination), so draft or double-entry marks
 * (`exam_marks_entries`) never reach this report. Explicit columns only.
 */
async function loadExamResults(client: PgQueryable, tenantId: string): Promise<ReportTable> {
  await requireRelation(client, 'examination_academic_records');
  await requireRelation(client, 'examinations');
  const { rows } = await client.query(
    `SELECT e.code AS examination_code, e.name AS examination_name,
            r.student_id::text AS student_id, r.subject_id::text AS subject_id,
            r.score, r.grade, r.passed, r.published_at
       FROM examination_academic_records r
       JOIN examinations e ON e.id = r.examination_id AND e.tenant_id = r.tenant_id
      WHERE r.tenant_id = $1
      ORDER BY e.code, r.student_id, r.subject_id
      LIMIT $2`,
    [tenantId, CATALOGUE_FETCH_LIMIT],
  );
  return {
    columns: [
      { name: 'examinationCode', label: 'Examination code' },
      { name: 'examination', label: 'Examination' },
      { name: 'studentId', label: 'Student' },
      { name: 'subjectId', label: 'Subject' },
      { name: 'score', label: 'Marks' },
      { name: 'grade', label: 'Grade' },
      { name: 'result', label: 'Result' },
      { name: 'publishedAt', label: 'Published' },
      { name: 'tenantId', label: 'Tenant' },
    ],
    rows: (
      rows as Array<{
        examination_code: string;
        examination_name: string;
        student_id: string;
        subject_id: string;
        score: number;
        grade: string;
        passed: boolean;
        published_at: Date | string;
      }>
    ).map((r) => ({
      examinationCode: r.examination_code,
      examination: r.examination_name,
      studentId: r.student_id,
      subjectId: r.subject_id,
      score: Number(r.score),
      grade: r.grade,
      result: r.passed ? 'PASS' : 'FAIL',
      publishedAt:
        r.published_at instanceof Date ? r.published_at.toISOString() : String(r.published_at),
      tenantId,
    })),
  };
}

async function loadLive(
  client: PgQueryable,
  tenantId: string,
  key: CatalogueReportKey,
  filters: Record<string, unknown>,
): Promise<ReportTable> {
  if (key === 'students_roster') return loadStudentsRoster(client, tenantId);
  if (key === 'attendance_summary') return loadAttendance(client, tenantId, filters);
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
    if (error instanceof ReportDataUnavailableError || error instanceof ValidationError)
      throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new ReportDataUnavailableError(`Report query failed for '${key}': ${message}`, error);
  }
}
