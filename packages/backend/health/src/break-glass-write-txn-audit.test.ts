/**
 * W1-SEC-10 — break-glass grant creates share COMMIT with audit.
 */
import { describe, expect, it, vi } from 'vitest';

import { PgBreakGlassStore } from './pg-break-glass-store.js';

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
            return {
              rows: [
                {
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
                },
              ],
            };
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
});
