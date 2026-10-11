/**
 * PRC-M554 — tenant assignment:
 *  - uuid tenant_id must not be compared to '' (22P02)
 *  - the assigned + verified set is the TABLE_MAPPINGS targets (getAllTargetTables)
 *    that have a tenant_id column, not a catalog `is_nullable = 'NO'` filter
 *    (which made the UPDATE … WHERE tenant_id IS NULL a guaranteed no-op)
 *  - non-mapped tables, notably platform-owned control_plane_documents whose
 *    NULL tenant_id means "platform", are never assigned or verified
 *  - a mapped target without tenant_id, or orphans left after assignment, are errors
 */
import { describe, it, expect, vi } from 'vitest';

import { assignAndVerifyTenant, resolveTenantAssignmentTables } from './assign-tenant.js';
import { getAllTargetTables } from './table-mappings.js';

const TENANT = '11111111-1111-4111-8111-111111111111';

interface FakeTable {
  hasTenantId: boolean;
  /** Rows whose tenant_id is currently NULL. */
  nullRows: number;
}

/**
 * Stateful fake of the target schema. The catalog query is answered from the
 * fake catalog honestly: it honours the `table_name = ANY($2)` parameter when
 * the implementation passes one, and otherwise returns every table that has a
 * tenant_id column. The test therefore does not depend on the SQL text; it
 * observes which tables receive UPDATE / COUNT statements.
 */
function fakeSchema(tables: Record<string, FakeTable>, opts: { failUpdate?: string } = {}) {
  const updated: string[] = [];
  const verified: string[] = [];
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes('information_schema.columns')) {
      const filter = Array.isArray(params?.[1]) ? new Set(params[1] as string[]) : null;
      return {
        rows: Object.entries(tables)
          .filter(([name, t]) => t.hasTenantId && (!filter || filter.has(name)))
          .map(([name]) => ({ table_name: name })),
      };
    }
    const update = /^\s*UPDATE "public"\."([^"]+)"/.exec(sql);
    if (update) {
      const name = update[1]!;
      updated.push(name);
      if (opts.failUpdate === name) throw new Error('boom');
      expect(sql).toContain('WHERE tenant_id IS NULL');
      expect(sql).not.toContain("''");
      expect(params).toEqual([TENANT]);
      const n = tables[name]!.nullRows;
      tables[name]!.nullRows = 0;
      return { rows: [], rowCount: n };
    }
    const count = /COUNT\(\*\) as count FROM "public"\."([^"]+)"/.exec(sql);
    if (count) {
      const name = count[1]!;
      verified.push(name);
      return { rows: [{ count: String(tables[name]!.nullRows) }] };
    }
    throw new Error(`unexpected SQL: ${sql}`);
  });
  return { client: { query }, updated, verified, tables };
}

/** Every mapped target present with a nullable tenant_id holding unstamped rows. */
function mappedTargets(nullRows = 5): Record<string, FakeTable> {
  return Object.fromEntries(
    getAllTargetTables().map((t) => [t, { hasTenantId: true, nullRows } satisfies FakeTable]),
  );
}

describe('assignAndVerifyTenant (PRC-M554)', () => {
  it('assigns and verifies every mapped target that has tenant_id, and excludes non-mapped tables', async () => {
    const targets = getAllTargetTables();
    expect(targets.length).toBeGreaterThan(0);
    const schema = fakeSchema({
      ...mappedTargets(5),
      // Platform-owned: NULL tenant_id by design. Not a migration target.
      control_plane_documents: { hasTenantId: true, nullRows: 7 },
      // Other non-mapped tenant tables (runtime-owned, NOT NULL tenant_id).
      invoices: { hasTenantId: true, nullRows: 0 },
      audit_events: { hasTenantId: true, nullRows: 2 },
    });

    const outcome = await assignAndVerifyTenant(schema.client as never, 'public', TENANT);

    expect(outcome.errors).toEqual([]);
    // (a) every mapped target is assigned and verified — and actually stamped.
    expect(outcome.tables).toEqual(targets);
    expect(schema.updated).toEqual(targets);
    expect(schema.verified).toEqual(targets);
    expect(outcome.assigned).toEqual(targets.map((table) => ({ table, count: 5 })));
    for (const t of targets) expect(schema.tables[t]!.nullRows).toBe(0);
    // (b) non-mapped tables are never touched; platform NULL rows survive.
    for (const t of ['control_plane_documents', 'invoices', 'audit_events']) {
      expect(schema.updated).not.toContain(t);
      expect(schema.verified).not.toContain(t);
    }
    expect(schema.tables.control_plane_documents!.nullRows).toBe(7);
    expect(schema.tables.audit_events!.nullRows).toBe(2);
  });

  it('never widens beyond mapped targets even if the catalog returns extra tables', async () => {
    const extra = { control_plane_documents: { hasTenantId: true, nullRows: 3 } };
    const all = { ...mappedTargets(1), ...extra };
    // Catalog ignores the ANY($2) filter and returns everything with tenant_id.
    const query = vi.fn(async () => ({
      rows: Object.keys(all).map((table_name) => ({ table_name })),
    }));
    const { tables, missing } = await resolveTenantAssignmentTables({ query } as never, 'public');
    expect(tables).toEqual(getAllTargetTables());
    expect(tables).not.toContain('control_plane_documents');
    expect(missing).toEqual([]);
    const [, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(params).toEqual(['public', getAllTargetTables()]);
  });

  it('fails when a mapped target has no tenant_id column', async () => {
    const tables = mappedTargets(0);
    tables.students = { hasTenantId: false, nullRows: 0 };
    const schema = fakeSchema(tables);
    const outcome = await assignAndVerifyTenant(schema.client as never, 'public', TENANT);
    expect(outcome.errors).toEqual([
      expect.objectContaining({ table: 'students', message: expect.stringContaining('tenant_id') }),
    ]);
    expect(schema.updated).not.toContain('students');
  });

  it('reports orphans left after assignment as errors (not warnings)', async () => {
    const schema = fakeSchema(mappedTargets(2));
    // Simulate a row that stays NULL (e.g. concurrent insert) by re-seeding after UPDATE.
    const original = schema.client.query.getMockImplementation()!;
    schema.client.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      const res = await original(sql, params);
      if (/UPDATE "public"\."grades"/.test(sql)) schema.tables.grades!.nullRows = 1;
      return res;
    });
    const outcome = await assignAndVerifyTenant(schema.client as never, 'public', TENANT);
    expect(outcome.errors).toEqual([
      { table: 'grades', message: '1 rows still missing tenant_id after assignment' },
    ]);
  });

  it('records a per-table UPDATE failure as an error', async () => {
    const schema = fakeSchema(mappedTargets(1), { failUpdate: 'enrollments' });
    const outcome = await assignAndVerifyTenant(schema.client as never, 'public', TENANT);
    expect(outcome.errors).toEqual([
      { table: 'enrollments', message: 'Tenant assignment failed: boom' },
      { table: 'enrollments', message: '1 rows still missing tenant_id after assignment' },
    ]);
  });
});
