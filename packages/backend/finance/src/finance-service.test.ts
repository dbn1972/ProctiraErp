import { describe, expect, it } from 'vitest';
import { InMemoryFinanceRepository } from './in-memory-repository.js';
import { FinanceService } from './finance-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';

describe('FinanceService', () => {
  it('creates and lists FeeStructure', async () => {
    const service = new FinanceService(new InMemoryFinanceRepository());
    const created = await service.createFeeStructure(tenantId, {
      name: 'sample',
      academicYear: 'sample',
      amount: 1,
      currency: 'INR',
      frequency: 'annual',
      status: 'active',
    } as any);
    expect(created.id).toBeTruthy();
    const rows = await service.listFeeStructures(tenantId);
    expect(rows).toHaveLength(1);
  });
});
