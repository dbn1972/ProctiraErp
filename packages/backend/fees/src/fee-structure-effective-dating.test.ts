import { describe, expect, it } from 'vitest';
import { InMemoryFeesRepository } from './in-memory-repository.js';

describe('W1-DATA-07 fee structure effective dating', () => {
  it('filters listFeeStructures by asOf valid window', async () => {
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
    };
    await repo.createFeeStructure({
      ...base,
      id: 'a',
      code: 'A',
      name: 'Past',
      amountCents: 100,
      validFrom: '2024-01-01',
      validTo: '2024-12-31',
      version: 1,
      supersedesId: null,
    });
    await repo.createFeeStructure({
      ...base,
      id: 'b',
      code: 'B',
      name: 'Current',
      amountCents: 200,
      validFrom: '2025-01-01',
      validTo: null,
      version: 1,
      supersedesId: null,
    });
    const asOf = await repo.listFeeStructures('t1', { asOf: '2025-06-01' });
    expect(asOf.map((r) => r.id)).toEqual(['b']);
    const all = await repo.listFeeStructures('t1');
    expect(all).toHaveLength(2);
  });
});
