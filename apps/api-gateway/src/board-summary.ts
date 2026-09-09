/**
 * G-809 — Board-level rollup summary for the mounted insights `/reports` surface.
 *
 * When DATABASE_URL is set (and forceMemory is not), queries Postgres for
 * institution / enrolment / attendance / fees / LMS aggregates scoped to a
 * board (or area) id. Missing tables/columns yield zeros — never 500.
 *
 * Without Postgres (or in forceMemory tests), uses a seedable in-memory map.
 */
import { getSharedPgPool, withPgTenant, type PgQueryable } from '@proctira/database';

export interface BoardSchoolBreakdown {
  institutionId: string;
  name: string;
  enrolment: number;
}

export interface BoardSummary {
  boardId: string;
  generatedAt: string;
  schools: number;
  enrolment: number;
  attendancePercent: number | null;
  feesCollectedCents: number;
  lmsCompletionPercent: number | null;
  schoolsBreakdown: BoardSchoolBreakdown[];
}

/** In-memory seed map (tests / no DATABASE_URL). Cleared between suites via helper. */
const memorySummaries = new Map<string, BoardSummary>();

export function emptyBoardSummary(
  boardId: string,
  generatedAt = new Date().toISOString(),
): BoardSummary {
  return {
    boardId,
    generatedAt,
    schools: 0,
    enrolment: 0,
    attendancePercent: null,
    feesCollectedCents: 0,
    lmsCompletionPercent: null,
    schoolsBreakdown: [],
  };
}

/** Test helper: seed an in-memory board summary (forceMemory / no DB path). */
export function seedBoardSummaryForTests(
  boardId: string,
  partial: Partial<Omit<BoardSummary, 'boardId'>> = {},
): BoardSummary {
  const summary: BoardSummary = {
    ...emptyBoardSummary(boardId),
    ...partial,
    boardId,
    generatedAt: partial.generatedAt ?? new Date().toISOString(),
  };
  memorySummaries.set(boardId, summary);
  return summary;
}

/** Test helper: clear seeded summaries. */
export function clearBoardSummariesForTests(): void {
  memorySummaries.clear();
}

function isPgEnabled(forceMemory?: boolean): boolean {
  if (forceMemory) return false;
  return Boolean(process.env.DATABASE_URL?.trim());
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

async function columnExists(
  client: PgQueryable,
  table: string,
  column: string,
): Promise<boolean> {
  try {
    const result = await client.query(
      `SELECT 1 AS ok
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = $1
         AND column_name = $2
       LIMIT 1`,
      [table, column],
    );
    return result.rows.length > 0;
  } catch {
    return false;
  }
}

async function safeNumber(
  client: PgQueryable,
  sql: string,
  params: unknown[],
  field = 'value',
): Promise<number> {
  try {
    const result = await client.query(sql, params);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    const raw = row?.[field];
    const n = typeof raw === 'number' ? raw : Number(raw ?? 0);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

async function loadFromPostgres(tenantId: string, boardId: string): Promise<BoardSummary> {
  const pool = getSharedPgPool();
  if (!pool) return emptyBoardSummary(boardId);

  try {
    return await withPgTenant(pool, tenantId, async (client) => {
      const summary = emptyBoardSummary(boardId);

      if (!(await relationExists(client, 'institutions'))) {
        return summary;
      }

      const hasBoardCol = await columnExists(client, 'institutions', 'board_id');
      const hasAreaCol = await columnExists(client, 'institutions', 'area_id');
      const hasDeleted = await columnExists(client, 'institutions', 'deleted_at');

      const deletedClause = hasDeleted ? 'AND deleted_at IS NULL' : '';
      let institutionsSql: string;
      let institutionsParams: unknown[];

      if (hasBoardCol && hasAreaCol) {
        institutionsSql = `
          SELECT id::text AS id, name
          FROM institutions
          WHERE (board_id::text = $1 OR area_id::text = $1)
            ${deletedClause}
          ORDER BY name ASC`;
        institutionsParams = [boardId];
      } else if (hasBoardCol) {
        institutionsSql = `
          SELECT id::text AS id, name
          FROM institutions
          WHERE board_id::text = $1
            ${deletedClause}
          ORDER BY name ASC`;
        institutionsParams = [boardId];
      } else if (hasAreaCol) {
        institutionsSql = `
          SELECT id::text AS id, name
          FROM institutions
          WHERE area_id::text = $1
            ${deletedClause}
          ORDER BY name ASC`;
        institutionsParams = [boardId];
      } else {
        // No board/area column — fall back to all institutions for the tenant (RLS).
        institutionsSql = `
          SELECT id::text AS id, name
          FROM institutions
          WHERE TRUE ${deletedClause}
          ORDER BY name ASC`;
        institutionsParams = [];
      }

      let institutionRows: Array<{ id: string; name: string }> = [];
      try {
        const result = await client.query(institutionsSql, institutionsParams);
        institutionRows = (result.rows as Array<{ id: string; name: string }>).map((r) => ({
          id: String(r.id),
          name: String(r.name ?? ''),
        }));
      } catch {
        return summary;
      }

      summary.schools = institutionRows.length;
      if (institutionRows.length === 0) {
        return summary;
      }

      const institutionIds = institutionRows.map((r) => r.id);
      const enrolmentByInstitution = new Map<string, number>();

      if (await relationExists(client, 'enrollments')) {
        try {
          const result = await client.query(
            `SELECT institution_id::text AS institution_id, COUNT(*)::int AS cnt
             FROM enrollments
             WHERE institution_id::text = ANY($1::text[])
             GROUP BY institution_id`,
            [institutionIds],
          );
          for (const row of result.rows as Array<{ institution_id: string; cnt: number }>) {
            enrolmentByInstitution.set(String(row.institution_id), Number(row.cnt) || 0);
          }
        } catch {
          // leave zeros
        }
      } else if (await relationExists(client, 'students')) {
        const total = await safeNumber(client, `SELECT COUNT(*)::int AS value FROM students`, []);
        summary.enrolment = total;
      }

      let enrolmentTotal = 0;
      summary.schoolsBreakdown = institutionRows.map((inst) => {
        const enrolment = enrolmentByInstitution.get(inst.id) ?? 0;
        enrolmentTotal += enrolment;
        return {
          institutionId: inst.id,
          name: inst.name,
          enrolment,
        };
      });
      if (enrolmentByInstitution.size > 0) {
        summary.enrolment = enrolmentTotal;
      }

      if (await relationExists(client, 'student_attendance')) {
        try {
          const result = await client.query(
            `SELECT
               COUNT(*) FILTER (WHERE status IN ('PRESENT', 'LATE'))::float AS present_like,
               COUNT(*)::float AS total
             FROM student_attendance
             WHERE institution_id::text = ANY($1::text[])`,
            [institutionIds],
          );
          const row = result.rows[0] as { present_like?: number; total?: number } | undefined;
          const total = Number(row?.total ?? 0);
          if (total > 0) {
            const presentLike = Number(row?.present_like ?? 0);
            summary.attendancePercent = Math.round((presentLike / total) * 10000) / 100;
          }
        } catch {
          summary.attendancePercent = null;
        }
      }

      if (await relationExists(client, 'parent_fee_payments')) {
        summary.feesCollectedCents = await safeNumber(
          client,
          `SELECT COALESCE(SUM(amount_cents), 0)::bigint AS value
           FROM parent_fee_payments
           WHERE status = 'succeeded'`,
          [],
        );
      }

      if (await relationExists(client, 'lms_skill_mastery')) {
        try {
          const result = await client.query(
            `SELECT AVG(mastery)::float AS avg_mastery
             FROM lms_skill_mastery
             WHERE institution_id IS NULL
                OR institution_id::text = ANY($1::text[])`,
            [institutionIds],
          );
          const row = result.rows[0] as { avg_mastery?: number | null } | undefined;
          if (row?.avg_mastery != null && Number.isFinite(Number(row.avg_mastery))) {
            summary.lmsCompletionPercent = Math.round(Number(row.avg_mastery) * 10000) / 100;
          }
        } catch {
          summary.lmsCompletionPercent = null;
        }
      } else if (await relationExists(client, 'lms_submissions')) {
        try {
          const result = await client.query(
            `SELECT
               COUNT(*) FILTER (WHERE status IN ('graded', 'returned'))::float AS done,
               COUNT(*)::float AS total
             FROM lms_submissions
             WHERE institution_id IS NULL
                OR institution_id::text = ANY($1::text[])`,
            [institutionIds],
          );
          const row = result.rows[0] as { done?: number; total?: number } | undefined;
          const total = Number(row?.total ?? 0);
          if (total > 0) {
            summary.lmsCompletionPercent =
              Math.round((Number(row?.done ?? 0) / total) * 10000) / 100;
          }
        } catch {
          summary.lmsCompletionPercent = null;
        }
      }

      return summary;
    });
  } catch {
    return emptyBoardSummary(boardId);
  }
}

export interface GetBoardSummaryOptions {
  /** Force in-memory path (unit tests), even when DATABASE_URL is set. */
  forceMemory?: boolean;
}

/**
 * Resolve a board rollup. Always returns a full shape (unknown board → zeros).
 */
export async function getBoardSummary(
  boardId: string,
  tenantId: string,
  options: GetBoardSummaryOptions = {},
): Promise<BoardSummary> {
  const id = boardId?.trim() || '';
  if (!id) {
    return emptyBoardSummary('');
  }

  if (isPgEnabled(options.forceMemory)) {
    return loadFromPostgres(tenantId || 'default', id);
  }

  const seeded = memorySummaries.get(id);
  if (seeded) {
    return { ...seeded, schoolsBreakdown: [...seeded.schoolsBreakdown] };
  }
  return emptyBoardSummary(id);
}
