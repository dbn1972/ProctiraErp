/**
 * PRC-L289 — curriculum references are verified in-tenant.
 *
 * (a) `updateOutcome` re-linking an outcome to a syllabus unit must refuse a
 *     unit that is absent or owned by another tenant (NotFoundError), exactly
 *     like `createOutcome` already does.
 * (c) a Postgres FK violation (23503) from a curriculum write surfaces as a
 *     ValidationError (400), not a raw 500.
 */
import { NotFoundError, ValidationError } from '@proctira/common';
import { describe, expect, it, vi } from 'vitest';

import { CurriculumService } from './service.js';
import { InMemoryCurriculumStore, PgCurriculumStore, type SyllabusUnitRecord } from './store.js';

const TENANT = '00000000-0000-4000-8000-000000000001';
const TENANT_B = '00000000-0000-4000-8000-0000000000bb';
const SUBJECT = '11111111-1111-4111-8111-111111111111';
const GRADE = '22222222-2222-4222-8222-222222222222';
const PERIOD = '33333333-3333-4333-8333-333333333333';

function unitInput(code: string) {
  return { subjectId: SUBJECT, gradeId: GRADE, academicPeriodId: PERIOD, code, name: code };
}

describe('PRC-L289 updateOutcome verifies the unit belongs to the tenant', () => {
  it('rejects another tenant’s unit and leaves the outcome unchanged', async () => {
    const service = new CurriculumService(new InMemoryCurriculumStore());
    const ownUnit = await service.createUnit(TENANT, unitInput('U1'));
    const foreignUnit = await service.createUnit(TENANT_B, unitInput('U1'));
    const outcome = await service.createOutcome(TENANT, {
      subjectId: SUBJECT,
      unitId: ownUnit.id,
      code: 'LO-1',
      statement: 'Reads numbers to 1000',
    });

    await expect(
      service.updateOutcome(TENANT, outcome.id, { unitId: foreignUnit.id }),
    ).rejects.toThrow(NotFoundError);

    const [after] = await service.listOutcomes(TENANT);
    expect(after?.unitId).toBe(ownUnit.id);
  });

  it('rejects a unit id that does not exist', async () => {
    const service = new CurriculumService(new InMemoryCurriculumStore());
    const outcome = await service.createOutcome(TENANT, {
      subjectId: SUBJECT,
      code: 'LO-2',
      statement: 'Adds fractions',
    });
    await expect(
      service.updateOutcome(TENANT, outcome.id, {
        unitId: '44444444-4444-4444-8444-444444444444',
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it('still allows re-linking to an own unit and clearing with null', async () => {
    const service = new CurriculumService(new InMemoryCurriculumStore());
    const u1 = await service.createUnit(TENANT, unitInput('U1'));
    const u2 = await service.createUnit(TENANT, unitInput('U2'));
    const outcome = await service.createOutcome(TENANT, {
      subjectId: SUBJECT,
      unitId: u1.id,
      code: 'LO-3',
      statement: 'Solves equations',
    });
    await expect(
      service.updateOutcome(TENANT, outcome.id, { unitId: u2.id }),
    ).resolves.toMatchObject({ unitId: u2.id });
    await expect(
      service.updateOutcome(TENANT, outcome.id, { unitId: null }),
    ).resolves.toMatchObject({ unitId: null });
  });
});

describe('PRC-L289 PgCurriculumStore maps FK violations to ValidationError', () => {
  it('a 23503 from INSERT INTO syllabus_units becomes a 400 ValidationError', async () => {
    const fkError = Object.assign(new Error('insert violates foreign key constraint'), {
      code: '23503',
      constraint: 'syllabus_units_subject_id_tenant_fk',
    });
    const client = {
      query: vi.fn(async (text: string) => {
        if (text.includes('INSERT INTO syllabus_units')) throw fkError;
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const store = new PgCurriculumStore({ query: vi.fn(), connect: async () => client } as never);
    const now = new Date().toISOString();
    const row: SyllabusUnitRecord = {
      id: '55555555-5555-4555-8555-555555555555',
      tenantId: TENANT,
      institutionId: null,
      subjectId: SUBJECT,
      gradeId: GRADE,
      academicPeriodId: PERIOD,
      code: 'U1',
      name: 'Unit 1',
      sequence: 1,
      planned: true,
      notes: null,
      createdAt: now,
      updatedAt: now,
    };
    const error = await store.createUnit(row).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({ statusCode: 400 });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });
});
