import { describe, expect, it } from 'vitest';
import { InMemoryPayrollRepository } from './in-memory-repository.js';
import { PayrollService } from './payroll-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';

describe('PayrollService', () => {
  it('creates and lists PayStructure', async () => {
    const service = new PayrollService(new InMemoryPayrollRepository());
    const created = await service.createPayStructure(tenantId, {
      name: 'sample',
      currency: 'INR',
      components: '[]',
      status: 'active',
    } as any);
    expect(created.id).toBeTruthy();
    const rows = await service.listPayStructures(tenantId);
    expect(rows).toHaveLength(1);
  });
});
