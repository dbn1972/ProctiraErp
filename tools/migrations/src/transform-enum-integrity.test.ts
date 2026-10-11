/**
 * Data-integrity regression tests for map_enum (PRC-H105): unknown legacy codes
 * must never be silently rewritten to the first mapped value.
 */
import { describe, it, expect, vi } from 'vitest';
import { getMappingForTarget } from './table-mappings.js';
import {
  buildTransformExpression,
  buildUnmappedEnumSQL,
  findUnmappedEnumCodes,
  transformTable,
} from './transform-schema.js';

describe('map_enum fallback (PRC-H105)', () => {
  it('maps unmapped and NULL codes to NULL, never to the first mapping value', () => {
    const expr = buildTransformExpression('gender_id', {
      type: 'map_enum',
      mapping: { '1': 'male', '2': 'female' },
    });
    expect(expr).toMatch(/ELSE NULL END$/);
    expect(expr).not.toContain("ELSE 'male'");
  });

  it('builds a pre-flight query listing codes outside the mapping', () => {
    const students = getMappingForTarget('students')!;
    const gender = students.columns.find((c) => c.source === 'gender_id')!;
    const sql = buildUnmappedEnumSQL(students, gender, 'migration_staging')!;
    expect(sql).toContain('"migration_staging"."security_users"');
    expect(sql).toContain('s."gender_id" IS NOT NULL');
    expect(sql).toMatch(/NOT IN \('1', '2'\)/);
  });

  it('reports a fixture with gender_id=9 as an unmapped code', async () => {
    const students = getMappingForTarget('students')!;
    const client = {
      query: vi.fn(async (sql: string) =>
        sql.includes('"gender_id" AS text) AS code')
          ? { rows: [{ code: '9', count: 3 }] }
          : { rows: [] },
      ),
    };
    const found = await findUnmappedEnumCodes(client as never, students, 'migration_staging');
    expect(found).toEqual([
      expect.objectContaining({
        sourceColumn: 'gender_id',
        targetColumn: 'gender',
        codes: [{ code: '9', count: 3 }],
      }),
    ]);
  });

  it('fails the table transform and writes no rows when a code is unmapped', async () => {
    const students = getMappingForTarget('students')!;
    const client = {
      query: vi.fn(async (sql: string) =>
        sql.includes('"gender_id" AS text) AS code')
          ? { rows: [{ code: '9', count: 1 }] }
          : { rows: [], rowCount: 1 },
      ),
    };
    await expect(
      transformTable(client as never, students, 'migration_staging', 'public'),
    ).rejects.toThrow(/Unmapped legacy enum codes in security_users: gender_id→gender: 9\(1\)/);
    const inserts = client.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO'));
    expect(inserts).toHaveLength(0);
  });

  it('PRC-M556: reports source rows GENUINELY missing from the target as dropped', async () => {
    const students = getMappingForTarget('students')!;
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('AS code')) return { rows: [] }; // no unmapped codes
        if (sql.includes('INSERT INTO')) return { rows: [], rowCount: 7 }; // 7 inserted
        if (sql.includes('NOT EXISTS')) return { rows: [{ c: 3 }] }; // 3 still missing
        return { rows: [] };
      }),
    };
    const result = await transformTable(client as never, students, 'migration_staging', 'public');
    expect(result.inserted).toBe(7);
    expect(result.dropped).toBe(3);
  });

  it('PRC-M556: dropped is zero when every source row is present in the target', async () => {
    const students = getMappingForTarget('students')!;
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('AS code')) return { rows: [] };
        if (sql.includes('INSERT INTO')) return { rows: [], rowCount: 5 };
        if (sql.includes('NOT EXISTS')) return { rows: [{ c: 0 }] };
        return { rows: [] };
      }),
    };
    const result = await transformTable(client as never, students, 'migration_staging', 'public');
    expect(result).toEqual({ inserted: 5, dropped: 0 });
  });

  it('PRC-M556 re-run: ON CONFLICT skips of already-present rows are NOT data loss', async () => {
    // Second pipeline run: 10 source rows, 0 inserted (all already present in
    // the target), and NOT EXISTS finds none missing. The old
    // `sourceCount - inserted` logic would report 10 "dropped" and fail the
    // table; the fixed logic reports zero.
    const students = getMappingForTarget('students')!;
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('AS code')) return { rows: [] };
        if (sql.includes('INSERT INTO')) return { rows: [], rowCount: 0 };
        if (sql.includes('NOT EXISTS')) return { rows: [{ c: 0 }] };
        return { rows: [] };
      }),
    };
    const result = await transformTable(client as never, students, 'migration_staging', 'public');
    expect(result).toEqual({ inserted: 0, dropped: 0 });
    // The data-loss check must query NOT EXISTS against the target, not a bare
    // source COUNT compared to inserted.
    const usedNotExists = client.query.mock.calls.some(([sql]) => sql.includes('NOT EXISTS'));
    expect(usedNotExists).toBe(true);
  });
});
