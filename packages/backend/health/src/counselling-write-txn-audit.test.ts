/**
 * W1-SEC-10 — counselling session writes share COMMIT with audit.
 */
import { describe, expect, it, vi } from 'vitest';

import { PgCounsellingStore } from './pg-counselling-store.js';

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
          if (typeof sql === 'string' && sql.includes('INSERT INTO counselling_sessions')) {
            return {
              rows: [
                {
                  id: 'cs-1',
                  tenant_id: 't1',
                  student_id: 's1',
                  counsellor_id: 'c1',
                  session_date: '2024-06-01',
                  session_type: 'individual',
                  reason: 'enc',
                  case_notes: 'enc',
                  outcome: null,
                  follow_up_required: false,
                  follow_up_date: null,
                  status: 'completed',
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

vi.mock('./phi-crypto.js', () => ({
  encryptPhi: (v: unknown) => v,
  decryptPhi: (v: unknown) => v,
  phiScopeForStudent: () => ({ tenantId: 't1', institutionId: 'i1' }),
}));

describe('W1-SEC-10 counselling write + audit same txn', () => {
  const pool = { connect: vi.fn() } as never;

  function stubStore(): PgCounsellingStore {
    const store = new PgCounsellingStore(pool);
    (store as unknown as { ensureSchema: () => Promise<void> }).ensureSchema = async () => {};
    (store as unknown as { phiScope: () => Promise<unknown> }).phiScope = async () => ({
      tenantId: 't1',
      institutionId: 'i1',
    });
    return store;
  }

  it('create invokes appendAuditInTxn with the same client', async () => {
    const store = stubStore();
    const appendAuditInTxn = vi.fn(async () => undefined);
    const entity = await store.create(
      {
        id: 'cs-1',
        tenantId: 't1',
        studentId: 's1',
        counsellorId: 'c1',
        sessionDate: '2024-06-01',
        sessionType: 'individual',
        reason: 'anxiety',
        caseNotes: 'notes',
        outcome: null,
        followUpRequired: false,
        followUpDate: null,
        status: 'completed',
      },
      { appendAuditInTxn },
    );
    expect(entity.id).toBe('cs-1');
    expect(appendAuditInTxn).toHaveBeenCalledTimes(1);
    expect(appendAuditInTxn.mock.calls[0]?.[1]).toMatchObject({ id: 'cs-1' });
  });
});
