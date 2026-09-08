/**
 * Unit tests for withPgTenant (G-103 raw-SQL RLS binding).
 */
import { describe, it, expect, vi } from 'vitest';

import { withPgTenant } from './pg-tenant.js';

describe('withPgTenant', () => {
  it('BEGIN + set_config app.tenant_id / app.current_tenant_id + COMMIT on connectable pool', async () => {
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
      `SELECT set_config('app.tenant_id', $1, true)`,
      `SELECT set_config('app.current_tenant_id', $1, true)`,
      'SELECT 1 FROM staff_leave_requests',
      'COMMIT',
    ]);
    expect(queries[1]?.values).toEqual([tenantId]);
    expect(queries[2]?.values).toEqual([tenantId]);
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

    expect(queries[0]).toContain('app.tenant_id');
    expect(queries[1]).toContain('app.current_tenant_id');
    expect(queries[2]).toContain('counselling_sessions');
  });

  it('rejects empty tenantId', async () => {
    await expect(
      withPgTenant({ query: async () => ({ rows: [] }) }, '', async () => null),
    ).rejects.toThrow(/tenantId/);
  });
});
