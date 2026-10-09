/**
 * PRC-M554 — tenant assignment:
 *  - uuid tenant_id must not be compared to '' (22P02)
 *  - tables discovered from the catalog, not a hardcoded list
 */
import { describe, it, expect, vi } from 'vitest';

import { discoverTenantScopedTables } from './assign-tenant.js';

describe('discoverTenantScopedTables (PRC-M554)', () => {
  it('selects every table with a tenant_id column except tenants/schema_migrations', async () => {
    const query = vi.fn(async () => ({
      rows: [{ table_name: 'students' }, { table_name: 'invoices' }, { table_name: 'new_domain' }],
    }));
    const tables = await discoverTenantScopedTables({ query } as never, 'public');
    expect(tables).toEqual(['students', 'invoices', 'new_domain']);
    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toContain("column_name = 'tenant_id'");
    expect(sql).toContain("NOT IN ('tenants', 'schema_migrations')");
    expect(params).toEqual(['public']);
  });

  it('is not limited to the legacy hardcoded 10 tables', async () => {
    const query = vi.fn(async () => ({ rows: [{ table_name: 'brand_new_table' }] }));
    const tables = await discoverTenantScopedTables({ query } as never, 'public');
    expect(tables).toContain('brand_new_table');
  });
});
