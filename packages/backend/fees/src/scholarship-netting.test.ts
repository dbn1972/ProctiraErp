import { describe, expect, it } from 'vitest';
import { FeesService } from './fees-service.js';
import { InMemoryFeesRepository } from './in-memory-repository.js';

describe('G-1 scholarship netting', () => {
  it('credits an open invoice and is idempotent on disbursementId', async () => {
    const repo = new InMemoryFeesRepository();
    const service = new FeesService(repo);
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const studentId = '22222222-2222-4222-8222-222222222222';
    const structure = await service.createFeeStructure(tenantId, 'staff', {
      name: 'Tuition',
      category: 'tuition',
      amountCents: 10000,
    });
    const { created } = await service.bulkInvoiceClass(tenantId, 'staff', {
      structureId: structure.id,
      studentIds: [studentId],
    });
    expect(created).toHaveLength(1);
    const first = await service.applyScholarshipNetting(tenantId, 'staff', {
      studentId,
      disbursementId: 'disb-1',
      amountCents: 2500,
      invoiceId: created[0]!.id,
    });
    expect(first.idempotent).toBe(false);
    expect(first.invoice?.amountCents).toBe(7500);
    const second = await service.applyScholarshipNetting(tenantId, 'staff', {
      studentId,
      disbursementId: 'disb-1',
      amountCents: 2500,
    });
    expect(second.idempotent).toBe(true);
    const again = await service.getInvoice(tenantId, created[0]!.id);
    expect(again.amountCents).toBe(7500);
  });
});
