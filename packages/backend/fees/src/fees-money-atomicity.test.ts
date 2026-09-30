/**
 * PRC-H058: refund / credit note / write-off / concession / void run the
 * read-check-write and the ledger journal under one invoice lock + transaction.
 * In-memory adapter mirrors the Pg semantics (serialized per invoice, rollback on throw).
 */
import { BusinessRuleError } from '@proctira/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { FeesService } from './fees-service.js';
import { InMemoryFeesRepository } from './in-memory-repository.js';
import { SandboxPaymentAdapter } from './payment-adapter.js';

const TENANT = '00000000-0000-4000-8000-0000000000a1';
const STUDENT = '00000000-0000-4000-8000-0000000000b1';

describe('fees money atomicity (PRC-H058)', () => {
  let repository: InMemoryFeesRepository;
  let service: FeesService;

  beforeEach(() => {
    repository = new InMemoryFeesRepository();
    service = new FeesService(repository, new SandboxPaymentAdapter());
  });

  async function paidInvoice(face: number, paid: number) {
    const invoice = await service.createInvoice(TENANT, 'staff-1', {
      studentId: STUDENT,
      title: 'Atomicity probe',
      amountCents: face,
    });
    await service.recordPayment(TENANT, 'parent-1', { invoiceId: invoice.id, amountCents: paid });
    return invoice;
  }

  it('5 concurrent full refunds -> exactly one succeeds, refunds never exceed payments', async () => {
    const invoice = await paidInvoice(10_000, 10_000);
    const outcomes = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        service.recordRefund(TENANT, `staff-${i}`, {
          invoiceId: invoice.id,
          amountCents: 10_000,
          reason: 'duplicate click',
        }),
      ),
    );
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    for (const o of outcomes.filter((x) => x.status === 'rejected')) {
      expect((o as PromiseRejectedResult).reason).toBeInstanceOf(BusinessRuleError);
    }
    const refunds = await repository.listRefundsForInvoice(TENANT, invoice.id);
    expect(refunds.reduce((s, r) => s + r.amountCents, 0)).toBeLessThanOrEqual(10_000);
    const tb = await service.getTrialBalance(TENANT);
    expect(tb.debitCents).toBe(tb.creditCents);
  });

  it('concurrent refunds totalling more than paid: the second is rejected', async () => {
    const invoice = await paidInvoice(10_000, 6_000);
    const outcomes = await Promise.allSettled([
      service.recordRefund(TENANT, 'staff-1', {
        invoiceId: invoice.id,
        amountCents: 4_000,
        reason: 'a',
      }),
      service.recordRefund(TENANT, 'staff-2', {
        invoiceId: invoice.id,
        amountCents: 4_000,
        reason: 'b',
      }),
    ]);
    expect(outcomes.map((o) => o.status).sort()).toEqual(['fulfilled', 'rejected']);
    const refunds = await repository.listRefundsForInvoice(TENANT, invoice.id);
    expect(refunds.reduce((s, r) => s + r.amountCents, 0)).toBe(4_000);
  });

  it('journal failure rolls back the refund row', async () => {
    const invoice = await paidInvoice(10_000, 10_000);
    const ledgerBefore = (await service.getInvoiceLedger(TENANT, invoice.id)).length;
    const original = repository.postLedgerEntries.bind(repository);
    repository.postLedgerEntries = async (entries) => {
      if (entries[0]?.memo === 'refund posted') throw new Error('ledger insert failed');
      return original(entries);
    };
    await expect(
      service.recordRefund(TENANT, 'staff-1', {
        invoiceId: invoice.id,
        amountCents: 1_000,
        reason: 'x',
      }),
    ).rejects.toThrow('ledger insert failed');
    expect(await repository.listRefundsForInvoice(TENANT, invoice.id)).toHaveLength(0);
    expect(await service.getInvoiceLedger(TENANT, invoice.id)).toHaveLength(ledgerBefore);
  });

  it('journal failure rolls back the credit note and the invoice amount change', async () => {
    const invoice = await service.createInvoice(TENANT, 'staff-1', {
      studentId: STUDENT,
      title: 'Credit probe',
      amountCents: 10_000,
    });
    const original = repository.postLedgerEntries.bind(repository);
    repository.postLedgerEntries = async (entries) => {
      if (entries[0]?.memo === 'credit note posted') throw new Error('ledger insert failed');
      return original(entries);
    };
    await expect(
      service.issueCreditNote(TENANT, 'staff-1', {
        invoiceId: invoice.id,
        amountCents: 2_500,
        reason: 'sibling discount',
      }),
    ).rejects.toThrow('ledger insert failed');
    expect(await repository.listCreditNotesForInvoice(TENANT, invoice.id)).toHaveLength(0);
    expect((await service.getInvoice(TENANT, invoice.id)).amountCents).toBe(10_000);
  });

  it('journal failure on invoice issue rolls back the invoice row', async () => {
    const original = repository.postLedgerEntries.bind(repository);
    repository.postLedgerEntries = async (entries) => {
      if (entries[0]?.memo === 'invoice issued') throw new Error('ledger insert failed');
      return original(entries);
    };
    await expect(
      service.createInvoice(TENANT, 'staff-1', {
        studentId: STUDENT,
        title: 'Issue probe',
        amountCents: 5_000,
      }),
    ).rejects.toThrow('ledger insert failed');
    expect(await service.listInvoices(TENANT)).toHaveLength(0);
  });

  it('concurrent write-offs of the full unpaid balance: only one posts, AR never negative', async () => {
    const invoice = await paidInvoice(10_000, 4_000);
    const outcomes = await Promise.allSettled(
      Array.from({ length: 3 }, (_, i) =>
        service.writeOffInvoice(TENANT, `staff-${i}`, {
          invoiceId: invoice.id,
          amountCents: 6_000,
          reason: 'uncollectible',
        }),
      ),
    );
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const tb = await service.getTrialBalance(TENANT);
    expect(tb.debitCents).toBe(tb.creditCents);
    expect(tb.accounts.accounts_receivable).toBe(0);
    expect(await repository.listWriteOffsForInvoice(TENANT, invoice.id)).toHaveLength(1);
  });

  it('concurrent credit notes cannot drive the invoice below cash collected', async () => {
    const invoice = await paidInvoice(10_000, 4_000);
    const outcomes = await Promise.allSettled(
      Array.from({ length: 3 }, (_, i) =>
        service.issueCreditNote(TENANT, `staff-${i}`, {
          invoiceId: invoice.id,
          amountCents: 6_000,
          reason: 'waiver',
        }),
      ),
    );
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect((await service.getInvoice(TENANT, invoice.id)).amountCents).toBe(4_000);
    const tb = await service.getTrialBalance(TENANT);
    expect(tb.debitCents).toBe(tb.creditCents);
    expect(tb.accounts.accounts_receivable).toBe(0);
  });
});
