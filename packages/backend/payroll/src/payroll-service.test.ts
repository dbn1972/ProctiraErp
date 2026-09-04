import { describe, expect, it } from 'vitest';
import { NotFoundError } from '@proctira/common';
import { InMemoryPayrollRepository } from './in-memory-repository.js';
import { PayrollService } from './payroll-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const staffA = '55555555-5555-4555-8555-555555555555';
const staffB = '66666666-6666-4666-8666-666666666666';

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

  it('generateRun creates payslips from structure components and sums nets', async () => {
    const service = new PayrollService(new InMemoryPayrollRepository());
    const structure = await service.createPayStructure(tenantId, {
      name: 'Teacher Grade A',
      currency: 'INR',
      components: JSON.stringify([
        { name: 'basic', type: 'earning', amount: 40000 },
        { name: 'hra', type: 'earning', amount: 10000 },
        { name: 'pf', type: 'deduction', amount: 5000 },
      ]),
      status: 'active',
    });

    const { run, payslips } = await service.generateRun(tenantId, {
      periodYear: 2026,
      periodMonth: 9,
      payStructureId: structure.id,
      staffIds: [staffA, staffB],
    });

    expect(run.status).toBe('generated');
    expect(run.periodYear).toBe(2026);
    expect(run.periodMonth).toBe(9);
    expect(run.payStructureId).toBe(structure.id);
    expect(payslips).toHaveLength(2);
    expect(payslips.every((p) => p.grossAmount === 50000)).toBe(true);
    expect(payslips.every((p) => p.netAmount === 45000)).toBe(true);
    expect(payslips.every((p) => p.payrollRunId === run.id)).toBe(true);
    expect(run.totalAmount).toBe(90000);
  });

  it('generateRun uses gross 0 when components empty', async () => {
    const service = new PayrollService(new InMemoryPayrollRepository());
    const structure = await service.createPayStructure(tenantId, {
      name: 'Empty',
      currency: 'INR',
      components: '[]',
      status: 'active',
    });

    const { run, payslips } = await service.generateRun(tenantId, {
      periodYear: 2026,
      periodMonth: 1,
      payStructureId: structure.id,
      staffIds: [staffA],
    });

    expect(payslips[0].grossAmount).toBe(0);
    expect(payslips[0].netAmount).toBe(0);
    expect(run.totalAmount).toBe(0);
  });

  it('generateRun throws when pay structure missing', async () => {
    const service = new PayrollService(new InMemoryPayrollRepository());
    await expect(
      service.generateRun(tenantId, {
        periodYear: 2026,
        periodMonth: 1,
        payStructureId: '00000000-0000-4000-8000-000000000099',
        staffIds: [staffA],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
