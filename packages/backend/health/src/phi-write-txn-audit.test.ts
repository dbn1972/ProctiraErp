/**
 * W1-SEC-10 — allergy/condition/vaccination/insurance/screening writes share COMMIT with audit.
 */
import { describe, expect, it, vi } from 'vitest';

import { PgPhiStore } from './pg-phi-store.js';

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
          if (typeof sql === 'string' && sql.includes('INSERT INTO health_allergies')) {
            return {
              rows: [
                {
                  id: 'alg-1',
                  tenant_id: 't1',
                  student_id: 's1',
                  allergy_type: 'food',
                  description: 'enc',
                  severity: 'mild',
                  reaction: null,
                  treatment: null,
                  diagnosed_date: null,
                  created_at: new Date(),
                  updated_at: new Date(),
                },
              ],
            };
          }
          if (typeof sql === 'string' && sql.includes('INSERT INTO health_conditions')) {
            return {
              rows: [
                {
                  id: 'cond-1',
                  tenant_id: 't1',
                  student_id: 's1',
                  condition_name: 'asthma',
                  condition_type: 'chronic',
                  diagnosed_date: null,
                  status: 'active',
                  treatment: null,
                  medication: null,
                  notes: null,
                  created_at: new Date(),
                  updated_at: new Date(),
                },
              ],
            };
          }
          if (typeof sql === 'string' && sql.includes('INSERT INTO health_vaccinations')) {
            return {
              rows: [
                {
                  id: 'vax-1',
                  tenant_id: 't1',
                  student_id: 's1',
                  vaccine_name: 'MMR',
                  dose_number: 1,
                  date_administered: '2024-01-01',
                  administered_by: null,
                  batch_number: null,
                  next_due_date: null,
                  notes: null,
                  created_at: new Date(),
                  updated_at: new Date(),
                },
              ],
            };
          }
          if (typeof sql === 'string' && sql.includes('INSERT INTO health_insurance')) {
            return {
              rows: [
                {
                  id: 'ins-1',
                  tenant_id: 't1',
                  student_id: 's1',
                  provider: 'Acme',
                  policy_number: 'P-1',
                  coverage_type: 'primary',
                  start_date: '2024-01-01',
                  end_date: null,
                  notes: null,
                  created_at: new Date(),
                  updated_at: new Date(),
                },
              ],
            };
          }
          if (typeof sql === 'string' && sql.includes('INSERT INTO health_screening_programs')) {
            return {
              rows: [
                {
                  id: 'scr-1',
                  tenant_id: 't1',
                  name: 'Vision',
                  description: null,
                  grade_level: '3',
                  academic_period_id: 'ap-1',
                  assessment_types: ['vision'],
                  scheduled_date: null,
                  status: 'planned',
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

describe('W1-SEC-10 PHI write + audit same txn', () => {
  const pool = { connect: vi.fn() } as never;

  function stubStore(): PgPhiStore {
    const store = new PgPhiStore(pool);
    (store as unknown as { ensureSchema: () => Promise<void> }).ensureSchema = async () => {};
    (store as unknown as { phiScope: () => Promise<unknown> }).phiScope = async () => ({
      tenantId: 't1',
      institutionId: 'i1',
    });
    return store;
  }

  it('createAllergy invokes appendAuditInTxn with the same client', async () => {
    const store = stubStore();
    const appendAuditInTxn = vi.fn(async () => undefined);
    const entity = await store.createAllergy(
      {
        id: 'alg-1',
        tenantId: 't1',
        studentId: 's1',
        allergyType: 'food',
        description: 'peanuts',
        severity: 'mild',
        reaction: null,
        treatment: null,
        diagnosedDate: null,
      },
      { appendAuditInTxn },
    );
    expect(entity.id).toBe('alg-1');
    expect(appendAuditInTxn).toHaveBeenCalledTimes(1);
    expect(appendAuditInTxn.mock.calls[0]?.[1]).toMatchObject({ id: 'alg-1' });
  });

  it('createCondition invokes appendAuditInTxn', async () => {
    const store = stubStore();
    const appendAuditInTxn = vi.fn(async () => undefined);
    await store.createCondition(
      {
        id: 'cond-1',
        tenantId: 't1',
        studentId: 's1',
        conditionName: 'asthma',
        conditionType: 'chronic',
        diagnosedDate: null,
        status: 'active',
        treatment: null,
        medication: null,
        notes: null,
      },
      { appendAuditInTxn },
    );
    expect(appendAuditInTxn).toHaveBeenCalledTimes(1);
  });

  it('createVaccination invokes appendAuditInTxn', async () => {
    const store = stubStore();
    const appendAuditInTxn = vi.fn(async () => undefined);
    await store.createVaccination(
      {
        id: 'vax-1',
        tenantId: 't1',
        studentId: 's1',
        vaccineName: 'MMR',
        doseNumber: 1,
        dateAdministered: '2024-01-01',
        administeredBy: null,
        batchNumber: null,
        nextDueDate: null,
        notes: null,
      },
      { appendAuditInTxn },
    );
    expect(appendAuditInTxn).toHaveBeenCalledTimes(1);
  });

  it('createInsurance invokes appendAuditInTxn with the same client', async () => {
    const store = stubStore();
    const appendAuditInTxn = vi.fn(async () => undefined);
    const entity = await store.createInsurance(
      {
        id: 'ins-1',
        tenantId: 't1',
        studentId: 's1',
        provider: 'Acme',
        policyNumber: 'P-1',
        coverageType: 'primary',
        startDate: '2024-01-01',
        endDate: null,
        notes: null,
      },
      { appendAuditInTxn },
    );
    expect(entity.id).toBe('ins-1');
    expect(appendAuditInTxn).toHaveBeenCalledTimes(1);
    expect(appendAuditInTxn.mock.calls[0]?.[1]).toMatchObject({ id: 'ins-1' });
  });

  it('createScreeningProgram invokes appendAuditInTxn', async () => {
    const store = stubStore();
    const appendAuditInTxn = vi.fn(async () => undefined);
    await store.createScreeningProgram(
      {
        id: 'scr-1',
        tenantId: 't1',
        name: 'Vision',
        description: null,
        gradeLevel: '3',
        academicPeriodId: 'ap-1',
        assessmentTypes: ['vision'],
        scheduledDate: null,
        status: 'planned',
      },
      { appendAuditInTxn },
    );
    expect(appendAuditInTxn).toHaveBeenCalledTimes(1);
  });
});
