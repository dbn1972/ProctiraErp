/**
 * PRC-M554 — tenant assignment:
 *  - uuid tenant_id must not be compared to '' (22P02)
 *  - tables discovered from the catalog, not a hardcoded list
 *  - discovery must NOT re-home platform-owned rows: only NOT NULL tenant_id
 *    columns are tenant-scoped; NULLable tenant_id marks platform ownership
 *    (e.g. control_plane_documents) and must never be assigned.
 */
import { describe, it, expect, vi } from 'vitest';

import { discoverTenantScopedTables } from './assign-tenant.js';

describe('discoverTenantScopedTables (PRC-M554)', () => {
  it('selects every table with a NOT NULL tenant_id column except tenants/schema_migrations', async () => {
    const query = vi.fn(async () => ({
      rows: [{ table_name: 'students' }, { table_name: 'invoices' }, { table_name: 'new_domain' }],
    }));
    const tables = await discoverTenantScopedTables({ query } as never, 'public');
    expect(tables).toEqual(['students', 'invoices', 'new_domain']);
    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toContain("column_name = 'tenant_id'");
    expect(sql).toContain("is_nullable = 'NO'");
    expect(sql).toContain("NOT IN ('tenants', 'schema_migrations')");
    expect(params).toEqual(['public']);
  });

  it('is not limited to the legacy hardcoded 10 tables', async () => {
    const query = vi.fn(async () => ({ rows: [{ table_name: 'brand_new_table' }] }));
    const tables = await discoverTenantScopedTables({ query } as never, 'public');
    expect(tables).toContain('brand_new_table');
  });

  it('excludes platform-owned tables whose tenant_id is NULLable (control_plane_documents)', async () => {
    // Simulate a catalog where the query filters by is_nullable = 'NO'. The
    // fake applies that filter so a nullable tenant_id table (platform-owned)
    // can never reach the UPDATE path that would re-home its NULL rows.
    const catalog = [
      { table_name: 'students', is_nullable: 'NO' },
      { table_name: 'invoices', is_nullable: 'NO' },
      // Platform-owned: tenant_id NULL by design — must be excluded.
      { table_name: 'control_plane_documents', is_nullable: 'YES' },
    ];
    const query = vi.fn(async (sql: string) => {
      const notNullOnly = sql.includes("is_nullable = 'NO'");
      return {
        rows: catalog
          .filter((r) => (notNullOnly ? r.is_nullable === 'NO' : true))
          .map((r) => ({ table_name: r.table_name })),
      };
    });
    const tables = await discoverTenantScopedTables({ query } as never, 'public');
    expect(tables).toEqual(['students', 'invoices']);
    expect(tables).not.toContain('control_plane_documents');
  });
});
