import { describe, expect, it } from 'vitest';

import { InMemoryFeesRepository } from './in-memory-repository.js';
import { FeesService } from './fees-service.js';

describe('W1-DATA-07 COMPLETE fee structure append-only versions', () => {
  it('rejects overlapping active windows for the same code', async () => {
    const repo = new InMemoryFeesRepository();
    const base = {
      tenantId: 't1',
      institutionId: null,
      academicPeriodId: null,
      gradeId: null,
      classId: null,
      category: 'tuition',
      term: null,
      currency: 'INR',
      status: 'active' as const,
      createdBy: 'u1',
      version: 1,
      supersedesId: null,
    };
    await repo.createFeeStructure({
      ...base,
      id: 'a',
      code: 'TUITION',
      name: 'v1',
      amountCents: 100,
      validFrom: '2025-01-01',
      validTo: null,
    });
    await expect(
      repo.createFeeStructure({
        ...base,
        id: 'b',
        code: 'TUITION',
        name: 'overlap',
        amountCents: 200,
        validFrom: '2025-06-01',
        validTo: null,
        version: 2,
        supersedesId: 'a',
      }),
    ).rejects.toThrow(/overlap/);
  });

  it('supersede closes prior valid_to and inserts a non-overlapping successor', async () => {
    const repo = new InMemoryFeesRepository();
    const service = new FeesService(repo);
    const prior = await service.createFeeStructure('t1', 'staff', {
      category: 'tuition',
      name: 'Tuition 2025',
      code: 'TUITION25',
      amountCents: 10000,
      validFrom: '2025-01-01',
      validTo: null,
    });
    const next = await service.supersedeFeeStructure('t1', 'staff', prior.id, {
      category: 'tuition',
      name: 'Tuition 2026',
      amountCents: 12000,
      validFrom: '2026-01-01',
      validTo: null,
    });
    expect(next.version).toBe(2);
    expect(next.supersedesId).toBe(prior.id);
    expect(next.amountCents).toBe(12000);
    const closed = await repo.findFeeStructureById(prior.id, 't1');
    expect(closed?.validTo).toBe('2025-12-31');
    expect(closed?.amountCents).toBe(10000);
  });

  it('valid_to can only narrow, never reopen or extend', async () => {
    const repo = new InMemoryFeesRepository();
    await repo.createFeeStructure({
      id: 'a',
      tenantId: 't1',
      institutionId: null,
      academicPeriodId: null,
      gradeId: null,
      classId: null,
      category: 'tuition',
      term: null,
      code: 'X',
      name: 'X',
      amountCents: 1,
      currency: 'INR',
      status: 'active',
      validFrom: '2025-01-01',
      validTo: '2025-06-30',
      version: 1,
      supersedesId: null,
      createdBy: 'u1',
    });
    await expect(repo.closeFeeStructureValidTo('t1', 'a', '2025-12-31')).rejects.toThrow(/narrow/);
  });
});
