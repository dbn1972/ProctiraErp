import { describe, expect, it } from 'vitest';
import { FinanceDomainError } from './finance-errors.js';
import { FinanceService } from './finance-service.js';
import { InMemoryFinanceRepository } from './in-memory-repository.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const studentId = '22222222-2222-4222-8222-222222222222';

describe('FinanceService fee cycle', () => {
  it('assigns fees, generates invoices, and records payments through paid', async () => {
    const service = new FinanceService(new InMemoryFinanceRepository());
    const structure = await service.createFeeStructure(tenantId, {
      name: 'Tuition 2026',
      academicYear: '2026-27',
      amount: 1000,
      currency: 'INR',
      frequency: 'annual',
      status: 'active',
      institutionId: null,
      gradeId: null,
    });

    const assignment = await service.assignFee(tenantId, {
      feeStructureId: structure.id,
      studentId,
      concessionAmount: 100,
    });
    expect(assignment.concessionAmount).toBe(100);

    const { created, skipped } = await service.generateInvoices(tenantId, {
      feeStructureId: structure.id,
      dueDate: '2026-09-30',
    });
    expect(skipped).toBe(0);
    expect(created).toHaveLength(1);
    expect(created[0]!.amountDue).toBe(900);
    expect(created[0]!.invoiceNumber).toMatch(/^INV-/);

    const again = await service.generateInvoices(tenantId, {
      feeStructureId: structure.id,
      dueDate: '2026-09-30',
    });
    expect(again.created).toHaveLength(0);
    expect(again.skipped).toBe(1);

    const partial = await service.recordPayment(tenantId, {
      invoiceId: created[0]!.id,
      amount: 400,
      method: 'upi',
    });
    expect(partial.invoice.status).toBe('partial');
    expect(partial.payment.receiptNumber).toMatch(/^RCPT-/);

    const final = await service.recordPayment(tenantId, {
      invoiceId: created[0]!.id,
      amount: 500,
      method: 'cash',
    });
    expect(final.invoice.status).toBe('paid');
    expect(final.invoice.amountPaid).toBe(900);
  });

  it('rejects overpayment', async () => {
    const service = new FinanceService(new InMemoryFinanceRepository());
    const structure = await service.createFeeStructure(tenantId, {
      name: 'Lab',
      academicYear: '2026-27',
      amount: 100,
      currency: 'INR',
      frequency: 'annual',
      status: 'active',
      institutionId: null,
      gradeId: null,
    });
    await service.assignFee(tenantId, { feeStructureId: structure.id, studentId });
    const { created } = await service.generateInvoices(tenantId, {
      feeStructureId: structure.id,
      dueDate: '2026-10-01',
    });
    await expect(
      service.recordPayment(tenantId, { invoiceId: created[0]!.id, amount: 150 }),
    ).rejects.toBeInstanceOf(FinanceDomainError);
  });
});
