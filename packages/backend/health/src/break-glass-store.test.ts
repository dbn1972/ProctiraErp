/**
 * PRC-L113: break-glass grant-model integrity.
 *
 *  - sub-issue 2 (no-op-returns-200): approve()/deny() on an already-resolved
 *    grant must throw BreakGlassNotPendingError instead of silently returning
 *    the unchanged row with an implicit 200.
 *  - sub-issue 3 (mutate-on-read): findActiveGrant must issue no UPDATE
 *    statement (it is the hot read path, called on every counselling-session
 *    read); the expiry sweep moved to list().
 *  - sub-issue 1 (approver-scope invariant): every approver role must also be
 *    a tenant-wide role.
 *
 * Failing-first for (a): before throwing BreakGlassNotPendingError, approve()
 * on a non-pending row returned `row` unchanged (success) — the
 * `.rejects.toThrow` assertions below would have failed (resolved instead of
 * rejected) against that pre-fix return-the-row behavior.
 *
 * Failing-first for (b): before moving the sweep, findActiveGrant issued an
 * `UPDATE health_phi_break_glass SET status='expired' ...` as its first
 * query on every call — the "no UPDATE" assertion below would have failed
 * against that pre-fix SQL.
 */
import { describe, expect, it, vi } from 'vitest';

import { BreakGlassNotPendingError, PgBreakGlassStore } from './pg-break-glass-store.js';
import { HEALTH_BREAK_GLASS_APPROVER_ROLES } from './phi-field-acl.js';
import { TENANT_WIDE_HEALTH_ROLES } from './health-service.js';

function mockRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'bg-1',
    tenant_id: 't1',
    requester_user_id: 'u1',
    approver_user_id: null,
    student_id: 's1',
    field_path: 'counselling.case_notes',
    justification: 'emergency review',
    status: 'pending',
    duration_minutes: 30,
    approved_at: null,
    expires_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

vi.mock('@proctira/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@proctira/database')>();
  return {
    ...actual,
    withPgTenant: async (
      _pool: unknown,
      _tenantId: string,
      fn: (client: { query: ReturnType<typeof vi.fn> }) => Promise<unknown>,
    ) => {
      const client = { query: queryMock };
      return fn(client);
    },
  };
});

// Populated per-test via `queryMock.mockImplementation(...)`.
const queryMock = vi.fn();

function stubStore(): PgBreakGlassStore {
  const pool = { connect: vi.fn() } as never;
  const store = new PgBreakGlassStore(pool);
  (store as unknown as { ensureSchema: () => Promise<void> }).ensureSchema = async () => {};
  return store;
}

describe('PRC-L113 (a): approve()/deny() reject on an already-resolved grant', () => {
  it('approve() throws BreakGlassNotPendingError for an already-approved grant', async () => {
    const store = stubStore();
    queryMock.mockReset();
    queryMock.mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && sql.startsWith('SELECT')) {
        return { rows: [mockRow({ status: 'approved', approver_user_id: 'admin-2' })] };
      }
      return { rows: [] };
    });

    await expect(store.approve('bg-1', 't1', 'admin-3')).rejects.toThrow(BreakGlassNotPendingError);
  });

  it('approve() throws BreakGlassNotPendingError for an already-denied grant', async () => {
    const store = stubStore();
    queryMock.mockReset();
    queryMock.mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && sql.startsWith('SELECT')) {
        return { rows: [mockRow({ status: 'denied', approver_user_id: 'admin-2' })] };
      }
      return { rows: [] };
    });

    await expect(store.approve('bg-1', 't1', 'admin-3')).rejects.toThrow(BreakGlassNotPendingError);
  });

  it('deny() throws BreakGlassNotPendingError for an already-resolved grant', async () => {
    const store = stubStore();
    queryMock.mockReset();
    queryMock.mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && sql.startsWith('SELECT')) {
        return { rows: [mockRow({ status: 'approved', approver_user_id: 'admin-2' })] };
      }
      return { rows: [] };
    });

    await expect(store.deny('bg-1', 't1', 'admin-3')).rejects.toThrow(BreakGlassNotPendingError);
  });
});

describe('PRC-L113 (b): findActiveGrant issues no mutating statement; list() still sweeps', () => {
  it("findActiveGrant does not send an UPDATE ... SET status='expired' statement", async () => {
    const store = stubStore();
    queryMock.mockReset();
    queryMock.mockImplementation(async () => ({ rows: [] }));

    await store.findActiveGrant('t1', 'u1', 's1', 'counselling.case_notes');

    expect(queryMock).toHaveBeenCalledTimes(1);
    const sql = queryMock.mock.calls[0]?.[0] as string;
    expect(sql).toMatch(/^\s*SELECT/i);
    expect(sql).not.toMatch(/UPDATE/i);
  });

  it("list() still sweeps: an approved-but-expired grant shows status 'expired' after calling list()", async () => {
    const store = stubStore();
    queryMock.mockReset();
    const calls: string[] = [];
    queryMock.mockImplementation(async (sql: string) => {
      calls.push(sql);
      if (typeof sql === 'string' && sql.trim().toUpperCase().startsWith('UPDATE')) {
        return { rows: [] };
      }
      // The SELECT after the sweep returns the grant already flipped to 'expired'.
      return {
        rows: [
          mockRow({
            status: 'expired',
            approver_user_id: 'admin-2',
            expires_at: new Date(Date.now() - 60_000).toISOString(),
          }),
        ],
      };
    });

    const result = await store.list('t1');

    expect(calls[0]).toMatch(/^\s*UPDATE health_phi_break_glass/i);
    expect(calls[0]).toMatch(/status='expired'/);
    expect(result[0]?.status).toBe('expired');
  });
});

describe('PRC-L113 (c): approver-scope invariant (static regression)', () => {
  it('every HEALTH_BREAK_GLASS_APPROVER_ROLES entry is also a TENANT_WIDE_HEALTH_ROLES entry', () => {
    expect(
      HEALTH_BREAK_GLASS_APPROVER_ROLES.every((role) =>
        (TENANT_WIDE_HEALTH_ROLES as readonly string[]).includes(role),
      ),
    ).toBe(true);
  });
});
