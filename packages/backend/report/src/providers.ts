/**
 * Catalogue data providers — query live domain tables when present (same
 * relations insights board-summary uses), else tenant-scoped demo rows so
 * generate still produces real bytes without claiming live aggregates.
 */
import { getSharedPgPool, withPgTenant, type PgQueryable } from '@proctira/database';

import type { CatalogueReportKey } from './catalogue.js';
import type { ReportTable } from './generators.js';

async function relationExists(client: PgQueryable, name: string): Promise<boolean> {
  try {
    const result = await client.query(`SELECT to_regclass($1) AS reg`, [`public.${name}`]);
    const row = result.rows[0] as { reg?: string | null } | undefined;
    return Boolean(row?.reg);
  } catch {
    return false;
  }
}

function demoTable(key: CatalogueReportKey, tenantId: string): ReportTable {
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

async function loadAttendance(client: PgQueryable, tenantId: string): Promise<ReportTable | null> {
  if (!(await relationExists(client, 'student_attendance'))) return null;
  try {
    const { rows } = await client.query(
      `SELECT COALESCE(grade_id::text, 'unspecified') AS grade,
              COUNT(*) FILTER (WHERE status IN ('PRESENT', 'LATE', 'present', 'late'))::int AS present,
              COUNT(*) FILTER (WHERE status IN ('ABSENT', 'absent'))::int AS absent,
              COUNT(*) FILTER (WHERE status IN ('LATE', 'late'))::int AS late
         FROM student_attendance
        GROUP BY 1
        ORDER BY 1`,
    );
    if (rows.length === 0) return null;
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
  } catch {
    return null;
  }
}

async function loadFeeDues(client: PgQueryable, tenantId: string): Promise<ReportTable | null> {
  if (!(await relationExists(client, 'parent_fee_invoices'))) return null;
  try {
    const { rows } = await client.query(
      `SELECT student_id::text AS student_id, title, status, amount_cents
         FROM parent_fee_invoices
        WHERE status IN ('open', 'overdue')
        ORDER BY due_at NULLS LAST, created_at DESC
        LIMIT 500`,
    );
    if (rows.length === 0) return null;
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
  } catch {
    return null;
  }
}

async function loadEnrolment(
  client: PgQueryable,
  tenantId: string,
  filters: Record<string, unknown>,
): Promise<ReportTable | null> {
  if (!(await relationExists(client, 'enrollments'))) return null;
  try {
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
    if (rows.length === 0) return null;
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
  } catch {
    return null;
  }
}

async function loadExamResults(client: PgQueryable, tenantId: string): Promise<ReportTable | null> {
  for (const table of ['examination_results', 'exam_results', 'candidate_results']) {
    if (!(await relationExists(client, table))) continue;
    try {
      const { rows } = await client.query(
        `SELECT * FROM ${table} LIMIT 200`,
      );
      if (rows.length === 0) continue;
      const sample = rows[0] as Record<string, unknown>;
      const keys = Object.keys(sample).filter((k) => k !== 'tenant_id').slice(0, 6);
      return {
        columns: [
          ...keys.map((k) => ({ name: k, label: k })),
          { name: 'tenantId', label: 'Tenant' },
        ],
        rows: (rows as Record<string, unknown>[]).map((r) => ({
          ...Object.fromEntries(keys.map((k) => [k, r[k]])),
          tenantId,
        })),
      };
    } catch {
      continue;
    }
  }
  return null;
}

export async function fetchCatalogueTable(
  tenantId: string,
  key: CatalogueReportKey,
  filters: Record<string, unknown> = {},
): Promise<ReportTable> {
  const pool = getSharedPgPool();
  if (!pool) return demoTable(key, tenantId);
  try {
    return await withPgTenant(pool, tenantId, async (client) => {
      if (key === 'attendance_summary') {
        return (await loadAttendance(client, tenantId)) ?? demoTable(key, tenantId);
      }
      if (key === 'fee_dues') {
        return (await loadFeeDues(client, tenantId)) ?? demoTable(key, tenantId);
      }
      if (key === 'enrolment_by_grade') {
        return (await loadEnrolment(client, tenantId, filters)) ?? demoTable(key, tenantId);
      }
      return (await loadExamResults(client, tenantId)) ?? demoTable(key, tenantId);
    });
  } catch {
    return demoTable(key, tenantId);
  }
}
