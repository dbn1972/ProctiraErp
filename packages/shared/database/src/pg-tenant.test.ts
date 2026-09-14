/**
 * Unit tests for withPgTenant (G-103 / W1-DATA-12 raw-SQL RLS binding).
 */
import { describe, it, expect, vi } from 'vitest';

import { withPgTenant } from './pg-tenant.js';
import { BIND_TENANT_GUC_SQL } from './tenant-guc.js';

describe('withPgTenant', () => {
  it('BEGIN + bindTenantGuc (canonical + legacy) + COMMIT on connectable pool', async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      query: vi.fn(async (text: string, values?: unknown[]) => {
        queries.push({ text, values });
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(),
      connect: vi.fn(async () => client),
    };

    const tenantId = '11111111-1111-4111-8111-111111111111';
    const out = await withPgTenant(pool, tenantId, async (c) => {
      await c.query('SELECT 1 FROM staff_leave_requests');
      return 'ok';
    });

    expect(out).toBe('ok');
    expect(pool.connect).toHaveBeenCalledOnce();
    expect(client.release).toHaveBeenCalledOnce();
    expect(queries.map((q) => q.text)).toEqual([
      'BEGIN',
      BIND_TENANT_GUC_SQL,
      'SELECT 1 FROM staff_leave_requests',
      'COMMIT',
    ]);
    expect(queries[1]?.values).toEqual([tenantId]);
  });

  it('binds on query-only doubles without connect', async () => {
    const queries: string[] = [];
    const pool = {
      query: vi.fn(async (text: string) => {
        queries.push(text);
        return { rows: [{ id: 1 }] };
      }),
    };

    await withPgTenant(pool, 'tenant-text-id', async (c) => {
      await c.query('SELECT * FROM counselling_sessions');
    });

    expect(queries[0]).toBe(BIND_TENANT_GUC_SQL);
    expect(queries[0]).toContain('app.tenant_id');
    expect(queries[0]).toContain('app.current_tenant_id');
    expect(queries[1]).toContain('counselling_sessions');
  });

  it('rejects empty tenantId', async () => {
    await expect(
      withPgTenant({ query: async () => ({ rows: [] }) }, '', async () => null),
    ).rejects.toThrow(/tenantId/);
  });
});
