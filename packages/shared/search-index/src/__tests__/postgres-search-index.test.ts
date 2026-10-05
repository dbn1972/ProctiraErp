/**
 * PRC-L494: Postgres tsvector adapter — tenant GUC bound per transaction,
 * tenant filter on every statement, bounded queries, fail-closed health.
 */
import { describe, expect, it } from 'vitest';
import { PostgresSearchIndex } from '../adapters/postgres-search-index.js';
import { createSearchIndex } from '../factory.js';

const TENANT_A = '11111111-1111-4111-8111-111111111111';

function fakePool(rows: unknown[] = []) {
  const log: Array<{ sql: string; values?: unknown[] }> = [];
  let released = 0;
  const pool = {
    async connect() {
      return {
        async query(sql: string, values?: unknown[]) {
          log.push({ sql, values });
          if (sql.includes('to_regclass')) return { rows: [{ present: true }] };
          if (sql.includes('FROM search_index_documents')) return { rows };
          return { rows: [] };
        },
        release() {
          released += 1;
        },
      };
    },
  };
  return { pool, log, released: () => released };
}

describe('PRC-L494 PostgresSearchIndex', () => {
  it('binds app.tenant_id in a transaction and filters by tenant on search', async () => {
    const { pool, log, released } = fakePool([
      {
        id: 'd1',
        tenant_id: TENANT_A,
        entity_type: 'student',
        entity_id: 's1',
        title: 'Asha',
        body: 'Grade 5',
        metadata: { grade: '5' },
        indexed_at: new Date('2026-01-01T00:00:00Z'),
        score: 0.6,
      },
    ]);
    const index = new PostgresSearchIndex(pool);
    const hits = await index.search({
      tenantId: TENANT_A,
      query: 'asha',
      entityTypes: ['student'],
      limit: 500,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.document).toMatchObject({ tenantId: TENANT_A, entityId: 's1' });
    const sqls = log.map((l) => l.sql);
    expect(sqls[0]).toBe('BEGIN');
    expect(log[1]).toEqual({
      sql: `SELECT set_config('app.tenant_id', $1, true)`,
      values: [TENANT_A],
    });
    const select = log.find((l) => l.sql.includes('websearch_to_tsquery'))!;
    expect(select.sql).toContain('tenant_id = $1::uuid');
    expect(select.values).toEqual([TENANT_A, 'asha', ['student'], 100]);
    expect(sqls).toContain('COMMIT');
    expect(released()).toBe(1);
  });

  it('upserts on index and scopes remove by tenant', async () => {
    const { pool, log } = fakePool();
    const index = new PostgresSearchIndex(pool);
    await index.index(
      { entityType: 'student', entityId: 's1', title: 'Asha', body: 'Grade 5' },
      { tenantId: TENANT_A },
    );
    await index.remove(TENANT_A, 'student', 's1');
    expect(log.some((l) => l.sql.includes('ON CONFLICT (tenant_id, entity_type, entity_id)'))).toBe(
      true,
    );
    const del = log.find((l) => l.sql.includes('DELETE FROM search_index_documents'))!;
    expect(del.values).toEqual([TENANT_A, 'student', 's1']);
  });

  it('rejects non-UUID tenants and returns [] for blank queries without a round-trip', async () => {
    const { pool, log } = fakePool();
    const index = new PostgresSearchIndex(pool);
    await expect(index.search({ tenantId: 'tenant-a', query: 'x' })).rejects.toThrow(/UUID/);
    expect(await index.search({ tenantId: TENANT_A, query: '   ' })).toEqual([]);
    expect(log).toHaveLength(0);
  });

  it('factory requires an injected pool for postgres', async () => {
    expect(() => createSearchIndex({ adapter: 'postgres', connectionUrl: 'postgres://x' })).toThrow(
      /injected pg pool/,
    );
    const { pool } = fakePool();
    const index = createSearchIndex({ adapter: 'postgres', pool });
    expect((await index.healthCheck()).healthy).toBe(true);
  });
});
