/**
 * PRC-M173: gateway holiday lookup over academic_calendar_events (fake pg client).
 */
import { describe, expect, it } from 'vitest';

import { createAttendanceHolidayLookup } from './attendance-holiday-lookup.js';

const TENANT = '550e8400-e29b-41d4-a716-446655440000';
const INSTITUTION = '11111111-1111-4111-8111-111111111111';

function fakePool(rows: Array<{ start_date: string; end_date: string }>) {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const client = {
    query: async (sql: string, values: unknown[] = []) => {
      queries.push({ sql, values });
      return { rows: sql.includes('academic_calendar_events') ? rows : [] };
    },
    release: () => undefined,
  };
  return { pool: { connect: async () => client, query: client.query }, queries };
}

describe('createAttendanceHolidayLookup (PRC-M173)', () => {
  it('returns undefined without a shared pool', () => {
    expect(createAttendanceHolidayLookup(null)).toBeUndefined();
  });

  it('expands overlapping holiday/break events to dates clipped to the leave range', async () => {
    const { pool, queries } = fakePool([
      { start_date: '2024-06-05', end_date: '2024-06-10' },
      { start_date: '2024-06-12', end_date: '2024-06-12' },
      { start_date: '2024-06-14', end_date: '2024-06-20' },
    ]);
    const lookup = createAttendanceHolidayLookup(pool as never)!;
    const days = await lookup(TENANT, INSTITUTION, '2024-06-10', '2024-06-14');
    expect([...days].sort()).toEqual(['2024-06-10', '2024-06-12', '2024-06-14']);

    const select = queries.find((q) => q.sql.includes('academic_calendar_events'))!;
    expect(select.sql).toMatch(/kind = ANY\(\$2::text\[\]\)/);
    expect(select.sql).toMatch(/institution_id IS NULL OR institution_id::text = \$3/);
    expect(select.values).toEqual([
      TENANT,
      ['holiday', 'break'],
      INSTITUTION,
      '2024-06-10',
      '2024-06-14',
    ]);
    // Tenant-bound: the lookup runs inside withPgTenant (BEGIN + app.tenant_id GUC).
    expect(queries[0]!.sql).toBe('BEGIN');
    expect(queries.some((q) => q.values.includes(TENANT) && /set_config/i.test(q.sql))).toBe(true);
  });

  it('expands a multi-day event across a month boundary', async () => {
    const { pool } = fakePool([{ start_date: '2024-06-29', end_date: '2024-07-02' }]);
    const lookup = createAttendanceHolidayLookup(pool as never)!;
    const days = await lookup(TENANT, INSTITUTION, '2024-06-28', '2024-07-01');
    expect([...days].sort()).toEqual(['2024-06-29', '2024-06-30', '2024-07-01']);
  });

  it('returns an empty set when no event overlaps', async () => {
    const { pool } = fakePool([]);
    const lookup = createAttendanceHolidayLookup(pool as never)!;
    expect((await lookup(TENANT, INSTITUTION, '2024-06-10', '2024-06-14')).size).toBe(0);
  });
});
