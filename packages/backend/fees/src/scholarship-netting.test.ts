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
    expect(first.concession?.sourceDisbursementId).toBe('disb-1');
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

  it('W2-FIN-09: does not treat disbursement id prefix as idempotent match', async () => {
    const repo = new InMemoryFeesRepository();
    const service = new FeesService(repo);
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const studentId = '22222222-2222-4222-8222-222222222222';
    const structure = await service.createFeeStructure(tenantId, 'staff', {
      name: 'Tuition',
      category: 'tuition',
      amountCents: 20_000,
    });
    const { created } = await service.bulkInvoiceClass(tenantId, 'staff', {
      structureId: structure.id,
      studentIds: [studentId],
    });

    const longer = await service.applyScholarshipNetting(tenantId, 'staff', {
      studentId,
      disbursementId: 'disb-10',
      amountCents: 1000,
      invoiceId: created[0]!.id,
    });
    expect(longer.idempotent).toBe(false);
    expect(longer.concession?.sourceDisbursementId).toBe('disb-10');
    // Old includes(marker) would match because reason "scholarship_netting:disb-10"
    // contains "scholarship_netting:disb-1".
    expect(longer.concession!.reason.includes('scholarship_netting:disb-1')).toBe(true);

    const prefix = await service.applyScholarshipNetting(tenantId, 'staff', {
      studentId,
      disbursementId: 'disb-1',
      amountCents: 500,
    });
    // Must not replay the disb-10 concession as an idempotent hit.
    expect(prefix.idempotent).toBe(false);
    expect(prefix.concession?.id).not.toBe(longer.concession?.id);
    expect(prefix.concession?.sourceDisbursementId).toBe('disb-1');
  });
});
