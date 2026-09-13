/**
 * G-903 property tests: instalment splits conserve the structure amount,
 * and refunds never exceed the amount paid.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { BusinessRuleError } from '@proctira/common';

import { InMemoryFeesRepository } from './in-memory-repository.js';
import { FeesService } from './fees-service.js';
import {
  allocateByShares,
  allocateInstalments,
  remainingRefundableCents,
} from './instalment-schedule.js';

const TENANT = '00000000-0000-4000-8000-000000000001';
const STUDENT = '00000000-0000-4000-8000-000000000099';
const CLASS_ID = '00000000-0000-4000-8000-0000000000c1';

describe('G-903 instalment + refund properties', () => {
  it('sum(instalments) === structure amount for random even splits', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 1, max: 24 }),
        (amountCents, partCount) => {
          const parts = allocateInstalments(amountCents, partCount);
          expect(parts).toHaveLength(partCount);
          expect(parts.reduce((sum, n) => sum + n, 0)).toBe(amountCents);
          expect(parts.every((n) => Number.isInteger(n) && n >= 0)).toBe(true);
        },
      ),
      { numRuns: 80 },
    );
  });

  it('sum(instalments) === structure amount for random share vectors', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5_000_000 }),
        fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 12 }),
        (amountCents, shares) => {
          const parts = allocateByShares(amountCents, shares);
          expect(parts).toHaveLength(shares.length);
          expect(parts.reduce((sum, n) => sum + n, 0)).toBe(amountCents);
        },
      ),
      { numRuns: 80 },
    );
  });

  it('service-generated instalments conserve the structure amount', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 2_000_000 }),
        fc.integer({ min: 1, max: 8 }),
        async (amountCents, partCount) => {
          const service = new FeesService(new InMemoryFeesRepository());
          const structure = await service.createFeeStructure(TENANT, 'staff', {
            name: 'Tuition',
            category: 'tuition',
            amountCents,
          });
          const instalments = await service.generateInstalmentSchedule(TENANT, structure.id, {
            partCount,
          });
          expect(instalments.reduce((sum, row) => sum + row.amountCents, 0)).toBe(amountCents);
        },
      ),
      { numRuns: 25 },
    );
  });

  it('refunds never exceed paid (remainingRefundableCents is a floor)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (paid, requested) => {
          const remaining = remainingRefundableCents(paid, 0);
          expect(remaining).toBe(paid);
          expect(requested > remaining ? remaining : requested).toBeLessThanOrEqual(paid);
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe('FeesService G-903 structures', () => {
  let repository: InMemoryFeesRepository;
  let service: FeesService;

  beforeEach(() => {
    repository = new InMemoryFeesRepository();
    service = new FeesService(repository);
  });

  it('bulk-invoices a class idempotently and applies a concession before pay/refund', async () => {
    repository.seedClassRoster(TENANT, { classId: CLASS_ID }, [STUDENT]);
    const structure = await service.createFeeStructure(TENANT, 'staff', {
      name: 'Term 1 tuition',
      category: 'tuition',
      term: 'T1',
      amountCents: 100_000,
      classId: CLASS_ID,
    });
    const instalments = await service.generateInstalmentSchedule(TENANT, structure.id, {
      partCount: 4,
    });
    expect(instalments.reduce((sum, row) => sum + row.amountCents, 0)).toBe(100_000);

    const first = await service.bulkInvoiceClass(TENANT, 'staff', {
      structureId: structure.id,
      classId: CLASS_ID,
    });
    expect(first.created).toHaveLength(1);
    expect(first.created[0]!.amountCents).toBe(100_000);
    expect(first.created[0]!.invoiceNumber).toMatch(/^INV-/);

    const again = await service.bulkInvoiceClass(TENANT, 'staff', {
      structureId: structure.id,
      classId: CLASS_ID,
    });
    expect(again.created).toHaveLength(0);
    expect(again.skipped).toEqual([STUDENT]);

    const pendingConcession = await service.applyConcession(TENANT, 'clerk', {
      studentId: STUDENT,
      structureId: structure.id,
      invoiceId: first.created[0]!.id,
      kind: 'percent',
      percent: 20,
      reason: 'Sibling discount',
    });
    expect(pendingConcession.concession.status).toBe('pending');
    const concession = await service.approveConcession(
      TENANT,
      'bursar',
      pendingConcession.concession.id,
    );
    expect(concession.discountCents).toBe(20_000);
    expect(concession.invoice?.amountCents).toBe(80_000);

    const paid = await service.recordPayment(TENANT, 'parent', {
      invoiceId: first.created[0]!.id,
    });
    expect(paid.payment.amountCents).toBe(80_000);

    await expect(
      service.recordRefund(TENANT, 'staff', {
        invoiceId: first.created[0]!.id,
        amountCents: 80_001,
        reason: 'too much',
      }),
    ).rejects.toThrow(BusinessRuleError);

    const refund = await service.recordRefund(TENANT, 'staff', {
      invoiceId: first.created[0]!.id,
      amountCents: 10_000,
      reason: 'Overcharge',
    });
    expect(refund.amountCents).toBe(10_000);

    const csv = `invoiceNumber,amountCents\n${first.created[0]!.invoiceNumber},80000\nMISSING,1`;
    const recon = await service.importReconciliationCsv(TENANT, 'staff', csv);
    expect(recon.matched).toHaveLength(1);
    expect(recon.unmatched).toHaveLength(1);

    const report = await service.duesReport(TENANT);
    expect(report.byStatus.some((row) => row.status === 'paid')).toBe(true);
  });

  it('isolates structures across tenants', async () => {
    await service.createFeeStructure(TENANT, 'staff', {
      name: 'A',
      category: 'tuition',
      amountCents: 1,
    });
    const other = '00000000-0000-4000-8000-000000000002';
    expect(await service.listFeeStructures(other)).toEqual([]);
  });
});
