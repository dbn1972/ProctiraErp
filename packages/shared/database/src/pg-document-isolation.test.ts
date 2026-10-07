/**
 * PRC-H007 / PRC-H116 — tenant-addressed control-plane document operations must
 * not bind the `app.platform_admin` RLS escape, and writes must never re-parent
 * a document owned by a different scope.
 */
import { describe, expect, it } from 'vitest';

import { DocumentOwnershipConflictError, PgDocumentCollection } from './pg-document-store';
import type { PgQueryable } from './pg-tenant';

const TENANT = '11111111-1111-4111-8111-111111111111';

function recordingPool(
  respond: (sql: string) => { rows: unknown[] } | Error = (sql) =>
    sql.includes('COUNT(*)') ? { rows: [{ c: 0 }] } : { rows: [] },
) {
  const statements: string[] = [];
  const pool: PgQueryable = {
    query: async (text: string) => {
      statements.push(text);
      const result = respond(text);
      if (result instanceof Error) throw result;
      return result;
    },
  };
  return { pool, statements };
}

const row = (tenantId: string | null) => ({
  id: 'd1',
  tenant_id: tenantId,
  data: { v: 1 },
  created_at: new Date(0),
  updated_at: new Date(0),
});

describe('PgDocumentCollection tenant isolation (PRC-H007 / PRC-H116)', () => {
  it('tenant-scoped reads bind app.tenant_id and never app.platform_admin', async () => {
    const { pool, statements } = recordingPool();
    const docs = new PgDocumentCollection<{ v: number }>(pool, 'c');

    await docs.get('d1', { tenantId: TENANT });
    await docs.all({ tenantId: TENANT });
    await docs.count({ tenantId: TENANT });
    await docs.where({ v: 1 }, TENANT);
    await docs.byTenant(TENANT);
    await docs.delete('d1', { tenantId: TENANT }).catch(() => undefined);

    expect(statements.some((s) => s.includes('app.platform_admin'))).toBe(false);
    expect(statements.filter((s) => s.includes("set_config('app.tenant_id'")).length).toBe(6);
  });

  it('platform-scoped operations still use the platform escape', async () => {
    const { pool, statements } = recordingPool();
    const docs = new PgDocumentCollection<{ v: number }>(pool, 'c');

    await docs.all({ platform: true });

    expect(statements.some((s) => s.includes("set_config('app.platform_admin', '1'"))).toBe(true);
  });

  it('tenant writes bind the tenant GUC and never re-parent an existing row', async () => {
    const { pool, statements } = recordingPool((sql) =>
      sql.startsWith('INSERT') ? { rows: [row(TENANT)] } : { rows: [] },
    );
    const docs = new PgDocumentCollection<{ v: number }>(pool, 'c');

    await docs.put('d1', { v: 1 }, TENANT);

    const insert = statements.find((s) => s.startsWith('INSERT')) ?? '';
    expect(insert).not.toMatch(/tenant_id\s*=\s*EXCLUDED\.tenant_id/);
    expect(insert).toContain('tenant_id IS NOT DISTINCT FROM EXCLUDED.tenant_id');
    expect(statements.some((s) => s.includes('app.platform_admin'))).toBe(false);
  });

  it('a put against a row owned by another scope is refused, not overwritten', async () => {
    // ON CONFLICT ... WHERE <owner matches> updates nothing -> no RETURNING row.
    const { pool } = recordingPool(() => ({ rows: [] }));
    const docs = new PgDocumentCollection<{ v: number }>(pool, 'c');

    await expect(docs.put('d1', { v: 2 }, null)).rejects.toBeInstanceOf(
      DocumentOwnershipConflictError,
    );
  });

  it('an RLS rejection under tenant binding surfaces as an ownership conflict', async () => {
    const rlsError = Object.assign(new Error('new row violates row-level security policy'), {
      code: '42501',
    });
    const { pool } = recordingPool((sql) => (sql.startsWith('INSERT') ? rlsError : { rows: [] }));
    const docs = new PgDocumentCollection<{ v: number }>(pool, 'c');

    await expect(docs.put('d1', { v: 2 }, TENANT)).rejects.toBeInstanceOf(
      DocumentOwnershipConflictError,
    );
  });

  it('insertIfAbsent never returns a row owned by a different scope', async () => {
    const { pool, statements } = recordingPool(() => ({ rows: [] }));
    const docs = new PgDocumentCollection<{ v: number }>(pool, 'c');

    await expect(docs.insertIfAbsent('d1', { v: 1 }, TENANT)).rejects.toBeInstanceOf(
      DocumentOwnershipConflictError,
    );
    const lookup = statements.find((s) => s.includes('SELECT * FROM control_plane_documents')) ?? '';
    expect(lookup).toContain('tenant_id IS NOT DISTINCT FROM $3');
  });
});
