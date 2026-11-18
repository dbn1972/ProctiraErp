/**
 * D1 (failing-first): the academic store runs inside the `withPgTenant` transaction. A tolerated
 * 42P01 must not abort that transaction for the statements after it, and the report-card read
 * must only use columns and tables the schema has.
 *
 * The fake pool copies Postgres semantics: after a failed statement every statement fails with
 * 25P02 until `ROLLBACK` or `ROLLBACK TO SAVEPOINT`.
 */
import { describe, expect, it } from 'vitest';
import { AcademicColumnMissingError } from './academic-visibility-errors.js';
import { PgAcademicVisibilityStore } from './pg-academic-visibility-store.js';

const TENANT = '00000000-0000-4000-8000-000000000001';
const STUDENT = '00000000-0000-4000-8000-000000000099';
const JOB = '00000000-0000-4000-8000-0000000000a1';
const PERIOD = '00000000-0000-4000-8000-0000000000b1';

interface Rule {
  match: string;
  code?: string;
  rows?: unknown[];
}

function pgError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/** A pool with `connect()` whose client behaves like a Postgres transaction after an error. */
function transactionalPool(rules: Rule[]) {
  const log: string[] = [];
  let aborted = false;
  const client = {
    query: async (sql: string) => {
      log.push(sql);
      const head = sql.trim();
      if (head === 'ROLLBACK' || head.startsWith('ROLLBACK TO SAVEPOINT')) {
        aborted = false;
        return { rows: [] };
      }
      if (aborted) {
        throw pgError(
          '25P02',
          'current transaction is aborted, commands ignored until end of transaction block',
        );
      }
      for (const rule of rules) {
        if (!sql.includes(rule.match)) continue;
        if (rule.code) {
          aborted = true;
          throw pgError(rule.code, `simulated pg error ${rule.code}`);
        }
        return { rows: rule.rows ?? [] };
      }
      return { rows: [] };
    },
    release: () => undefined,
  };
  return { pool: { query: client.query, connect: async () => client }, log };
}

describe('PgAcademicVisibilityStore inside a transaction (D1)', () => {
  it('a tolerated 42P01 does not abort the reads that follow it', async () => {
    const { pool } = transactionalPool([
      { match: 'FROM grade_entries', code: '42P01' },
      {
        match: 'FROM report_card_jobs',
        rows: [
          {
            id: JOB,
            academic_period_id: PERIOD,
            status: 'completed',
            output_url: null,
            completed_at: '2026-10-01T00:00:00.000Z',
          },
        ],
      },
    ]);
    const store = new PgAcademicVisibilityStore(pool as never, () => undefined);
    const result = await store.getGrades(TENANT, STUDENT);
    expect(result.reportCards).toHaveLength(1);
    expect(result.meta.source).toBe('degraded');
  });

  it('report-card subject lines come from published grades in the card period', async () => {
    const { pool, log } = transactionalPool([
      {
        match: 'FROM report_card_jobs',
        rows: [
          {
            id: JOB,
            academic_period_id: PERIOD,
            status: 'completed',
            output_url: null,
            completed_at: '2026-10-01T00:00:00.000Z',
          },
        ],
      },
      {
        match: 'FROM grade_entries',
        rows: [{ subject: 'MATH-T1', numeric_score: '88.00', letter_grade: 'A' }],
      },
    ]);
    const store = new PgAcademicVisibilityStore(pool as never, () => undefined);
    const result = await store.getReportCards(TENANT, STUDENT);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.subjects).toEqual([
      { subject: 'MATH-T1', numericScore: 88, letterGrade: 'A', remarks: null },
    ]);
    expect(result.meta.source).toBe('postgres');
    const sql = log.join('\n');
    expect(sql).not.toContain('report_card_subject_lines');
    expect(sql).not.toContain('ge.subject');
    expect(sql).not.toContain('ge.comment');
    expect(sql).not.toContain('ge.academic_period_id');
    expect(sql).toContain('s.academic_period_id = $3::uuid');
  });

  it('a 42703 still surfaces as AcademicColumnMissingError and the transaction rolls back', async () => {
    const { pool, log } = transactionalPool([{ match: 'FROM section_enrollments', code: '42703' }]);
    const store = new PgAcademicVisibilityStore(pool as never, () => undefined);
    await expect(store.getTimetable(TENANT, STUDENT)).rejects.toBeInstanceOf(
      AcademicColumnMissingError,
    );
    expect(log).toContain('ROLLBACK');
  });
});
