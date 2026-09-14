/**
 * W1-SEC-10 — special-needs PHI creates share COMMIT with audit.
 */
import { describe, expect, it, vi } from 'vitest';

import { PgSpecialNeedsStore } from './pg-special-needs-store.js';

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
          if (typeof sql === 'string' && sql.includes('INSERT INTO health_special_needs_assessments')) {
            return {
              rows: [
                {
                  id: 'asn-1',
                  tenant_id: 't1',
                  student_id: 's1',
                  assessment_date: '2024-06-01',
                  assessor_name: 'Dr A',
                  assessor_role: 'psychologist',
                  assessment_type: 'initial',
                  findings: 'enc',
                  recommendations: 'enc',
                  created_at: new Date(),
                  updated_at: new Date(),
                },
              ],
            };
          }
          if (typeof sql === 'string' && sql.includes('INSERT INTO health_diagnoses')) {
            return {
              rows: [
                {
                  id: 'dx-1',
                  tenant_id: 't1',
                  student_id: 's1',
                  assessment_id: 'asn-1',
                  diagnosis_date: '2024-06-02',
                  diagnosed_by: 'Dr A',
                  condition: 'ADHD',
                  category: 'neurodevelopmental',
                  severity: 'moderate',
                  notes: 'enc',
                  created_at: new Date(),
                  updated_at: new Date(),
                },
              ],
            };
          }
          if (typeof sql === 'string' && sql.includes('INSERT INTO health_referrals')) {
            return {
              rows: [
                {
                  id: 'ref-1',
                  tenant_id: 't1',
                  student_id: 's1',
                  diagnosis_id: 'dx-1',
                  referral_date: '2024-06-03',
                  referred_by: 'Dr A',
                  referred_to: 'clinic',
                  reason: 'enc',
                  status: 'pending',
                  appointment_date: null,
                  outcome: null,
                  created_at: new Date(),
                  updated_at: new Date(),
                },
              ],
            };
          }
          if (typeof sql === 'string' && sql.includes('INSERT INTO health_accommodation_plans')) {
            return {
              rows: [
                {
                  id: 'plan-1',
                  tenant_id: 't1',
                  student_id: 's1',
                  diagnosis_id: 'dx-1',
                  plan_name: 'IEP',
                  start_date: '2024-09-01',
                  end_date: null,
                  accommodations: '[]',
                  review_date: null,
                  status: 'active',
                  notes: 'enc',
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

describe('W1-SEC-10 special-needs write + audit same txn', () => {
  const pool = { connect: vi.fn() } as never;

  function stubStore(): PgSpecialNeedsStore {
    const store = new PgSpecialNeedsStore(pool);
    (store as unknown as { ensureSchema: () => Promise<void> }).ensureSchema = async () => {};
    (store as unknown as { phiScope: () => Promise<unknown> }).phiScope = async () => ({
      tenantId: 't1',
      institutionId: 'i1',
    });
    return store;
  }

  it('createAssessment invokes appendAuditInTxn with the same client', async () => {
    const store = stubStore();
    const appendAuditInTxn = vi.fn(async () => undefined);
    const entity = await store.createAssessment(
      {
        id: 'asn-1',
        tenantId: 't1',
        studentId: 's1',
        assessmentDate: '2024-06-01',
        assessorName: 'Dr A',
        assessorRole: 'psychologist',
        assessmentType: 'initial',
        findings: 'findings',
        recommendations: 'recs',
      },
      { appendAuditInTxn },
    );
    expect(entity.id).toBe('asn-1');
    expect(appendAuditInTxn).toHaveBeenCalledTimes(1);
    expect(appendAuditInTxn.mock.calls[0]?.[1]).toMatchObject({ id: 'asn-1' });
  });

  it('createDiagnosis invokes appendAuditInTxn', async () => {
    const store = stubStore();
    const appendAuditInTxn = vi.fn(async () => undefined);
    await store.createDiagnosis(
      {
        id: 'dx-1',
        tenantId: 't1',
        studentId: 's1',
        assessmentId: 'asn-1',
        diagnosisDate: '2024-06-02',
        diagnosedBy: 'Dr A',
        condition: 'ADHD',
        category: 'neurodevelopmental',
        severity: 'moderate',
        notes: 'n',
      },
      { appendAuditInTxn },
    );
    expect(appendAuditInTxn).toHaveBeenCalledTimes(1);
  });

  it('createReferral invokes appendAuditInTxn', async () => {
    const store = stubStore();
    const appendAuditInTxn = vi.fn(async () => undefined);
    await store.createReferral(
      {
        id: 'ref-1',
        tenantId: 't1',
        studentId: 's1',
        diagnosisId: 'dx-1',
        referralDate: '2024-06-03',
        referredBy: 'Dr A',
        referredTo: 'clinic',
        reason: 'r',
        status: 'pending',
        appointmentDate: null,
        outcome: null,
      },
      { appendAuditInTxn },
    );
    expect(appendAuditInTxn).toHaveBeenCalledTimes(1);
  });

  it('createAccommodationPlan invokes appendAuditInTxn', async () => {
    const store = stubStore();
    const appendAuditInTxn = vi.fn(async () => undefined);
    await store.createAccommodationPlan(
      {
        id: 'plan-1',
        tenantId: 't1',
        studentId: 's1',
        diagnosisId: 'dx-1',
        planName: 'IEP',
        startDate: '2024-09-01',
        endDate: null,
        accommodations: [],
        reviewDate: null,
        status: 'active',
        notes: 'n',
      },
      { appendAuditInTxn },
    );
    expect(appendAuditInTxn).toHaveBeenCalledTimes(1);
  });
});
