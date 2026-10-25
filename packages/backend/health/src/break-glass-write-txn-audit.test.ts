/**
 * W1-SEC-10 — break-glass grant creates share COMMIT with audit.
 */
import { describe, expect, it, vi } from 'vitest';

import { PgBreakGlassStore } from './pg-break-glass-store.js';

const pendingGrantRow = {
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
};

vi.mock('@proctira/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@proctira/database')>();
  return {
    ...actual,
    withPgTenant: async (
      _pool: unknown,
      _tenantId: string,
      fn: (client: { query: ReturnType<typeof vi.fn> }) => Promise<unknown>,
    ) => {
      const client = {
        query: vi.fn(async (sql: string) => {
          if (typeof sql === 'string' && sql.includes('INSERT INTO health_phi_break_glass')) {
            return { rows: [pendingGrantRow] };
          }
          // PRC-M519/L115: approve()/deny() SELECT the existing pending row,
          // then UPDATE it — both now return a row so appendAuditInTxn fires.
          if (
            typeof sql === 'string' &&
            sql.includes('FROM health_phi_break_glass') &&
            sql.includes('SELECT')
          ) {
            return { rows: [pendingGrantRow] };
          }
          if (
            typeof sql === 'string' &&
            sql.includes('UPDATE health_phi_break_glass') &&
            sql.includes("status='approved'")
          ) {
            return { rows: [{ ...pendingGrantRow, status: 'approved', approver_user_id: 'u2' }] };
          }
          if (
            typeof sql === 'string' &&
            sql.includes('UPDATE health_phi_break_glass') &&
            sql.includes("status='denied'")
          ) {
            return { rows: [{ ...pendingGrantRow, status: 'denied', approver_user_id: 'u2' }] };
          }
          return { rows: [] };
        }),
      };
      return fn(client);
    },
  };
});

describe('W1-SEC-10 break-glass write + audit same txn', () => {
  const pool = { connect: vi.fn() } as never;

  function stubStore(): PgBreakGlassStore {
    const store = new PgBreakGlassStore(pool);
    (store as unknown as { ensureSchema: () => Promise<void> }).ensureSchema = async () => {};
    return store;
  }

  it('create invokes appendAuditInTxn with the same client', async () => {
    const store = stubStore();
    const appendAuditInTxn = vi.fn(async () => undefined);
    const entity = await store.create(
      {
        tenantId: 't1',
        requesterUserId: 'u1',
        studentId: 's1',
        fieldPath: 'counselling.case_notes',
        justification: 'emergency review',
        durationMinutes: 30,
      },
      { appendAuditInTxn },
    );
    expect(entity.id).toBe('bg-1');
    expect(appendAuditInTxn).toHaveBeenCalledTimes(1);
    expect(appendAuditInTxn.mock.calls[0]?.[1]).toMatchObject({ id: 'bg-1' });
  });

  // ─── PRC-M519/L115: approve()/deny() previously had no appendAuditInTxn
  // hook at all — no binder, no call site ─────────────────────────────────

  it('approve invokes appendAuditInTxn with the same client', async () => {
    const store = stubStore();
    const appendAuditInTxn = vi.fn(async () => undefined);
    const entity = await store.approve('bg-1', 't1', 'u2', { appendAuditInTxn });
    expect(entity?.status).toBe('approved');
    expect(appendAuditInTxn).toHaveBeenCalledTimes(1);
    expect(appendAuditInTxn.mock.calls[0]?.[1]).toMatchObject({ id: 'bg-1', status: 'approved' });
  });

  it('deny invokes appendAuditInTxn with the same client', async () => {
    const store = stubStore();
    const appendAuditInTxn = vi.fn(async () => undefined);
    const entity = await store.deny('bg-1', 't1', 'u2', { appendAuditInTxn });
    expect(entity?.status).toBe('denied');
    expect(appendAuditInTxn).toHaveBeenCalledTimes(1);
    expect(appendAuditInTxn.mock.calls[0]?.[1]).toMatchObject({ id: 'bg-1', status: 'denied' });
  });

  it('approve/deny without appendAuditInTxn still succeed', async () => {
    const store = stubStore();
    const approved = await store.approve('bg-1', 't1', 'u2');
    expect(approved?.status).toBe('approved');
  });
});
