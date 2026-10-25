/**
 * PRC-M343: the exam_results catalogue provider reads the real examination
 * schema (exam_marks_entries) with an explicit column list, scoped to the
 * tenant, instead of `SELECT *` from guessed tables and the first 6 columns.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

type QueryFn = (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
const state: { pool: unknown; query: QueryFn } = {
  pool: null,
  query: async () => ({ rows: [] }),
};

vi.mock('@proctira/database', () => ({
  getSharedPgPool: () => state.pool,
  withPgTenant: async (
    _pool: unknown,
    _tenantId: string,
    fn: (client: { query: QueryFn }) => Promise<unknown>,
  ) => fn({ query: (text, values) => state.query(text, values) }),
}));

const { fetchCatalogueTable, ReportDataUnavailableError, CATALOGUE_FETCH_LIMIT } =
  await import('./providers.js');

const TENANT = '00000000-0000-4000-8000-0000000000e1';

interface Captured {
  text: string;
  values?: unknown[];
}

/** Stub DB: `relations` exist; data queries are captured and return `rows`. */
function stubDb(relations: string[], rows: unknown[]): Captured[] {
  const captured: Captured[] = [];
  state.pool = {};
  state.query = async (text, values) => {
    if (text.includes('to_regclass')) {
      const name = String(values?.[0] ?? '').replace(/^public\./, '');
      return { rows: [{ reg: relations.includes(name) ? `public.${name}` : null }] };
    }
    captured.push({ text, values });
    return { rows };
  };
  return captured;
}

describe('PRC-M343 exam_results provider', () => {
  afterEach(() => {
    state.pool = null;
  });

  it('queries exam_marks_entries with explicit columns, tenant-scoped and capped', async () => {
    const captured = stubDb(['exam_marks_entries'], []);

    await fetchCatalogueTable(TENANT, 'exam_results');

    expect(captured).toHaveLength(1);
    const [query] = captured;
    expect(query!.text).toMatch(/FROM\s+exam_marks_entries/);
    expect(query!.text).not.toMatch(/SELECT\s+\*/i);
    expect(query!.text).toMatch(/tenant_id\s*=\s*\$1/);
    expect(query!.text).toMatch(/final_marks\s+IS\s+NOT\s+NULL/i);
    expect(query!.values).toEqual([TENANT, CATALOGUE_FETCH_LIMIT]);
  });

  it('emits exactly the fixed result columns and drops any extra source columns', async () => {
    stubDb(
      ['exam_marks_entries'],
      [
        {
          examination_id: 'exam-1',
          candidate_id: 'cand-1',
          subject_id: 'subj-1',
          final_marks: 78.5,
          resolved_at: new Date('2026-03-01T10:00:00Z'),
          entered_by: 'clerk-1',
          marks: 80,
        },
        {
          examination_id: 'exam-1',
          candidate_id: 'cand-2',
          subject_id: 'subj-1',
          final_marks: 64,
          resolved_at: null,
          entered_by: 'clerk-2',
        },
      ],
    );

    const table = await fetchCatalogueTable(TENANT, 'exam_results');

    expect(table.columns).toEqual([
      { name: 'examinationId', label: 'Examination' },
      { name: 'candidateId', label: 'Candidate' },
      { name: 'subjectId', label: 'Subject' },
      { name: 'finalMarks', label: 'Final marks' },
      { name: 'resolvedAt', label: 'Resolved at' },
      { name: 'tenantId', label: 'Tenant' },
    ]);
    expect(table.rows).toEqual([
      {
        examinationId: 'exam-1',
        candidateId: 'cand-1',
        subjectId: 'subj-1',
        finalMarks: 78.5,
        resolvedAt: '2026-03-01T10:00:00.000Z',
        tenantId: TENANT,
      },
      {
        examinationId: 'exam-1',
        candidateId: 'cand-2',
        subjectId: 'subj-1',
        finalMarks: 64,
        resolvedAt: null,
        tenantId: TENANT,
      },
    ]);
    for (const row of table.rows) {
      expect(row).not.toHaveProperty('entered_by');
      expect(row).not.toHaveProperty('marks');
    }
  });

  it('fails the run when exam_marks_entries is not available (no fabrication)', async () => {
    stubDb(['examination_results', 'exam_results', 'candidate_results'], [{ id: 'x' }]);

    await expect(fetchCatalogueTable(TENANT, 'exam_results')).rejects.toBeInstanceOf(
      ReportDataUnavailableError,
    );
  });
});
