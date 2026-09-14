/**
 * W1-SEC-10 — nurse incident writes share COMMIT with audit.
 */
import { describe, expect, it, vi } from 'vitest';

import { PgNurseIncidentStore } from './pg-nurse-incident-store.js';

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
          if (typeof sql === 'string' && sql.includes('INSERT INTO health_nurse_incidents')) {
            return {
              rows: [
                {
                  id: 'inc-1',
                  tenant_id: 't1',
                  student_id: 's1',
                  institution_id: 'i1',
                  incident_at: new Date('2024-06-01T10:00:00Z'),
                  category: 'injury',
                  severity: 'medium',
                  notes: 'enc',
                  reported_by: 'nurse-1',
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

describe('W1-SEC-10 nurse incident write + audit same txn', () => {
  const pool = { connect: vi.fn() } as never;

  function stubStore(): PgNurseIncidentStore {
    const store = new PgNurseIncidentStore(pool);
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
        id: 'inc-1',
        tenantId: 't1',
        studentId: 's1',
        institutionId: 'i1',
        incidentAt: new Date('2024-06-01T10:00:00Z'),
        category: 'injury',
        severity: 'medium',
        notes: 'scraped knee',
        reportedBy: 'nurse-1',
      },
      { appendAuditInTxn },
    );
    expect(entity.id).toBe('inc-1');
    expect(appendAuditInTxn).toHaveBeenCalledTimes(1);
    expect(appendAuditInTxn.mock.calls[0]?.[1]).toMatchObject({ id: 'inc-1' });
  });
});
