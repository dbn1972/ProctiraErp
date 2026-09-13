import { describe, expect, it } from 'vitest';
import { majorUnitsToCents } from '@proctira/common';

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

  it('W2-FIN-08: nets majorUnitsToCents amount and reverses on cancel', async () => {
    const repo = new InMemoryFeesRepository();
    const service = new FeesService(repo);
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const studentId = '22222222-2222-4222-8222-222222222222';
    const structure = await service.createFeeStructure(tenantId, 'staff', {
      name: 'Tuition',
      category: 'tuition',
      amountCents: 10_000,
    });
    const { created } = await service.bulkInvoiceClass(tenantId, 'staff', {
      structureId: structure.id,
      studentIds: [studentId],
    });
    const amountCents = majorUnitsToCents(19.99);
    expect(amountCents).toBe(1999);
    await service.applyScholarshipNetting(tenantId, 'staff', {
      studentId,
      disbursementId: 'disb-float',
      amountCents,
      invoiceId: created[0]!.id,
    });
    expect((await service.getInvoice(tenantId, created[0]!.id)).amountCents).toBe(8001);

    const reversed = await service.reverseScholarshipNetting(tenantId, 'staff', {
      disbursementId: 'disb-float',
    });
    expect(reversed.reversed).toBe(true);
    expect(reversed.idempotent).toBe(false);
    expect((await service.getInvoice(tenantId, created[0]!.id)).amountCents).toBe(10_000);

    const again = await service.reverseScholarshipNetting(tenantId, 'staff', {
      disbursementId: 'disb-float',
    });
    expect(again.idempotent).toBe(true);

    const legs = (await service.getInvoiceLedger(tenantId, created[0]!.id)).filter(
      (e) => e.memo === 'scholarship netting reversed',
    );
    expect(legs).toHaveLength(2);
    expect(legs.every((e) => e.amountCents === 1999)).toBe(true);
  });
});
