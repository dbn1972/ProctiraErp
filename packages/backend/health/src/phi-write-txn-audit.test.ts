/**
 * W1-SEC-10 — allergy/condition/vaccination/insurance/screening writes share COMMIT with audit.
 *
 * W1-SEC (audit completeness): extended to prove update/delete now share the
 * same COMMIT as their write too — those paths previously had no
 * `appendAuditInTxn` hook at all (create-only), so a health-record edit or
 * removal could commit with zero audit trail. See also
 * pg-phi-store.ts:updateMeasurement/deleteMeasurement/etc.
 */
import { describe, expect, it, vi } from 'vitest';

import { PgPhiStore } from './pg-phi-store.js';

const measurementRow = {
  id: 'meas-1',
  tenant_id: 't1',
  student_id: 's1',
  measured_on: '2024-01-01',
  height: 120,
  weight: 25,
  bmi: 17.4,
  blood_pressure_systolic: null,
  blood_pressure_diastolic: null,
  heart_rate: null,
  vision_left: null,
  vision_right: null,
  notes: null,
  created_at: new Date(),
  updated_at: new Date(),
};

const allergyRow = {
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
};

const conditionRow = {
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
};

const vaccinationRow = {
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
};

const insuranceRow = {
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
};

const screeningRow = {
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
          if (typeof sql !== 'string') return { rows: [] };
          // ─── measurements ──────────────────────────────────────────────
          if (sql.includes('FROM health_measurements') && sql.includes('SELECT')) {
            return { rows: [measurementRow] };
          }
          if (sql.includes('UPDATE health_measurements')) {
            return { rows: [measurementRow] };
          }
          if (sql.includes('DELETE FROM health_measurements')) {
            return { rows: [], rowCount: 1 };
          }
          // ─── allergies ──────────────────────────────────────────────────
          if (sql.includes('INSERT INTO health_allergies')) {
            return { rows: [allergyRow] };
          }
          if (sql.includes('FROM health_allergies') && sql.includes('SELECT')) {
            return { rows: [allergyRow] };
          }
          if (sql.includes('UPDATE health_allergies')) {
            return { rows: [allergyRow] };
          }
          if (sql.includes('DELETE FROM health_allergies')) {
            return { rows: [], rowCount: 1 };
          }
          // ─── conditions ─────────────────────────────────────────────────
          if (sql.includes('INSERT INTO health_conditions')) {
            return { rows: [conditionRow] };
          }
          if (sql.includes('FROM health_conditions') && sql.includes('SELECT')) {
            return { rows: [conditionRow] };
          }
          if (sql.includes('UPDATE health_conditions')) {
            return { rows: [conditionRow] };
          }
          if (sql.includes('DELETE FROM health_conditions')) {
            return { rows: [], rowCount: 1 };
          }
          // ─── vaccinations ───────────────────────────────────────────────
          if (sql.includes('INSERT INTO health_vaccinations')) {
            return { rows: [vaccinationRow] };
          }
          if (sql.includes('FROM health_vaccinations') && sql.includes('SELECT')) {
            return { rows: [vaccinationRow] };
          }
          if (sql.includes('UPDATE health_vaccinations')) {
            return { rows: [vaccinationRow] };
          }
          if (sql.includes('DELETE FROM health_vaccinations')) {
            return { rows: [], rowCount: 1 };
          }
          // ─── insurance ──────────────────────────────────────────────────
          if (sql.includes('INSERT INTO health_insurance')) {
            return { rows: [insuranceRow] };
          }
          if (sql.includes('FROM health_insurance') && sql.includes('SELECT')) {
            return { rows: [insuranceRow] };
          }
          if (sql.includes('UPDATE health_insurance')) {
            return { rows: [insuranceRow] };
          }
          if (sql.includes('DELETE FROM health_insurance')) {
            return { rows: [], rowCount: 1 };
          }
          // ─── screening programs ─────────────────────────────────────────
          if (sql.includes('INSERT INTO health_screening_programs')) {
            return { rows: [screeningRow] };
          }
          if (sql.includes('FROM health_screening_programs') && sql.includes('SELECT')) {
            return { rows: [screeningRow] };
          }
          if (sql.includes('UPDATE health_screening_programs')) {
            return { rows: [screeningRow] };
          }
          if (sql.includes('DELETE FROM health_screening_programs')) {
            return { rows: [], rowCount: 1 };
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

  // ─── W1-SEC: updates previously had NO appendAuditInTxn hook at all ──────

  it('updateMeasurement invokes appendAuditInTxn with the same client', async () => {
    const store = stubStore();
    const appendAuditInTxn = vi.fn(async () => undefined);
    const entity = await store.updateMeasurement(
      'meas-1',
      't1',
      { height: 121 },
      { appendAuditInTxn },
    );
    expect(entity?.id).toBe('meas-1');
    expect(appendAuditInTxn).toHaveBeenCalledTimes(1);
    expect(appendAuditInTxn.mock.calls[0]?.[1]).toMatchObject({ id: 'meas-1' });
  });

  it('updateAllergy invokes appendAuditInTxn with the same client', async () => {
    const store = stubStore();
    const appendAuditInTxn = vi.fn(async () => undefined);
    const entity = await store.updateAllergy(
      'alg-1',
      't1',
      { severity: 'severe' },
      { appendAuditInTxn },
    );
    expect(entity?.id).toBe('alg-1');
    expect(appendAuditInTxn).toHaveBeenCalledTimes(1);
    expect(appendAuditInTxn.mock.calls[0]?.[1]).toMatchObject({ id: 'alg-1' });
  });

  it('updateCondition invokes appendAuditInTxn', async () => {
    const store = stubStore();
    const appendAuditInTxn = vi.fn(async () => undefined);
    const entity = await store.updateCondition(
      'cond-1',
      't1',
      { status: 'resolved' },
      { appendAuditInTxn },
    );
    expect(entity?.id).toBe('cond-1');
    expect(appendAuditInTxn).toHaveBeenCalledTimes(1);
  });

  it('updateVaccination invokes appendAuditInTxn', async () => {
    const store = stubStore();
    const appendAuditInTxn = vi.fn(async () => undefined);
    const entity = await store.updateVaccination(
      'vax-1',
      't1',
      { doseNumber: 2 },
      { appendAuditInTxn },
    );
    expect(entity?.id).toBe('vax-1');
    expect(appendAuditInTxn).toHaveBeenCalledTimes(1);
  });

  it('updateInsurance invokes appendAuditInTxn with the same client', async () => {
    const store = stubStore();
    const appendAuditInTxn = vi.fn(async () => undefined);
    const entity = await store.updateInsurance(
      'ins-1',
      't1',
      { provider: 'NewCo' },
      { appendAuditInTxn },
    );
    expect(entity?.id).toBe('ins-1');
    expect(appendAuditInTxn).toHaveBeenCalledTimes(1);
    expect(appendAuditInTxn.mock.calls[0]?.[1]).toMatchObject({ id: 'ins-1' });
  });

  it('updateScreeningProgram invokes appendAuditInTxn', async () => {
    const store = stubStore();
    const appendAuditInTxn = vi.fn(async () => undefined);
    const entity = await store.updateScreeningProgram(
      'scr-1',
      't1',
      { status: 'completed' },
      { appendAuditInTxn },
    );
    expect(entity?.id).toBe('scr-1');
    expect(appendAuditInTxn).toHaveBeenCalledTimes(1);
  });

  // ─── W1-SEC: deletes previously had NO appendAuditInTxn hook at all ──────
  // (delete* methods didn't even accept an `options` parameter before this
  // fix — a PHI delete could commit with zero audit trail.)

  it('deleteMeasurement invokes appendAuditInTxn with the deleted entity', async () => {
    const store = stubStore();
    const appendAuditInTxn = vi.fn(async () => undefined);
    const deleted = await store.deleteMeasurement('meas-1', 't1', { appendAuditInTxn });
    expect(deleted).toBe(true);
    expect(appendAuditInTxn).toHaveBeenCalledTimes(1);
    expect(appendAuditInTxn.mock.calls[0]?.[1]).toMatchObject({ id: 'meas-1' });
  });

  it('deleteAllergy invokes appendAuditInTxn with the deleted entity', async () => {
    const store = stubStore();
    const appendAuditInTxn = vi.fn(async () => undefined);
    const deleted = await store.deleteAllergy('alg-1', 't1', { appendAuditInTxn });
    expect(deleted).toBe(true);
    expect(appendAuditInTxn).toHaveBeenCalledTimes(1);
    expect(appendAuditInTxn.mock.calls[0]?.[1]).toMatchObject({ id: 'alg-1' });
  });

  it('deleteCondition invokes appendAuditInTxn with the deleted entity', async () => {
    const store = stubStore();
    const appendAuditInTxn = vi.fn(async () => undefined);
    const deleted = await store.deleteCondition('cond-1', 't1', { appendAuditInTxn });
    expect(deleted).toBe(true);
    expect(appendAuditInTxn).toHaveBeenCalledTimes(1);
    expect(appendAuditInTxn.mock.calls[0]?.[1]).toMatchObject({ id: 'cond-1' });
  });

  it('deleteVaccination invokes appendAuditInTxn with the deleted entity', async () => {
    const store = stubStore();
    const appendAuditInTxn = vi.fn(async () => undefined);
    const deleted = await store.deleteVaccination('vax-1', 't1', { appendAuditInTxn });
    expect(deleted).toBe(true);
    expect(appendAuditInTxn).toHaveBeenCalledTimes(1);
    expect(appendAuditInTxn.mock.calls[0]?.[1]).toMatchObject({ id: 'vax-1' });
  });

  it('deleteInsurance invokes appendAuditInTxn with the deleted entity', async () => {
    const store = stubStore();
    const appendAuditInTxn = vi.fn(async () => undefined);
    const deleted = await store.deleteInsurance('ins-1', 't1', { appendAuditInTxn });
    expect(deleted).toBe(true);
    expect(appendAuditInTxn).toHaveBeenCalledTimes(1);
    expect(appendAuditInTxn.mock.calls[0]?.[1]).toMatchObject({ id: 'ins-1' });
  });

  it('deleteScreeningProgram invokes appendAuditInTxn with the deleted entity', async () => {
    const store = stubStore();
    const appendAuditInTxn = vi.fn(async () => undefined);
    const deleted = await store.deleteScreeningProgram('scr-1', 't1', { appendAuditInTxn });
    expect(deleted).toBe(true);
    expect(appendAuditInTxn).toHaveBeenCalledTimes(1);
    expect(appendAuditInTxn.mock.calls[0]?.[1]).toMatchObject({ id: 'scr-1' });
  });

  it('update/delete without appendAuditInTxn still succeeds (no forced audit dependency)', async () => {
    const store = stubStore();
    const updated = await store.updateAllergy('alg-1', 't1', { severity: 'mild' });
    expect(updated?.id).toBe('alg-1');
    const deleted = await store.deleteCondition('cond-1', 't1');
    expect(deleted).toBe(true);
  });
});
