/**
 * FeesService unit tests — plan → invoice → pay → receipt + amount invariant.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach } from 'vitest';
import { BusinessRuleError, NotFoundError } from '@proctira/common';

import { InMemoryFeesRepository } from './in-memory-repository.js';
import { FeesService } from './fees-service.js';
import { SandboxPaymentAdapter, type PaymentAdapter } from './payment-adapter.js';

const TENANT_A = '00000000-0000-4000-8000-000000000001';
const TENANT_B = '00000000-0000-4000-8000-000000000002';
const STUDENT_ID = '00000000-0000-4000-8000-000000000099';

describe('FeesService', () => {
  let repository: InMemoryFeesRepository;
  let service: FeesService;

  beforeEach(() => {
    repository = new InMemoryFeesRepository();
    service = new FeesService(repository, new SandboxPaymentAdapter());
  });

  describe('plans and invoices', () => {
    it('creates a plan and issues an invoice from it', async () => {
      const plan = await service.createFeePlan(TENANT_A, 'staff-1', {
        name: 'Term 1 Tuition',
        amountCents: 1500000,
        frequency: 'term',
      });

      expect(plan.code).toBe('TERM_1_TUITION');
      expect(plan.amountCents).toBe(1500000);
      expect(plan.status).toBe('active');

      const invoice = await service.createInvoice(TENANT_A, 'staff-1', {
        studentId: STUDENT_ID,
        planId: plan.id,
      });

      expect(invoice.planId).toBe(plan.id);
      expect(invoice.title).toBe(plan.name);
      expect(invoice.amountCents).toBe(1500000);
      expect(invoice.status).toBe('open');
    });

    it('isolates plans by tenant', async () => {
      await service.createFeePlan(TENANT_A, 'staff-1', {
        name: 'A Plan',
        amountCents: 100,
      });
      await service.createFeePlan(TENANT_B, 'staff-2', {
        name: 'B Plan',
        amountCents: 200,
      });

      const aPlans = await service.listFeePlans(TENANT_A);
      const bPlans = await service.listFeePlans(TENANT_B);
      expect(aPlans).toHaveLength(1);
      expect(bPlans).toHaveLength(1);
      expect(aPlans[0]!.name).toBe('A Plan');
      expect(bPlans[0]!.name).toBe('B Plan');
    });
  });

  describe('recordPayment', () => {
    it('enforces receipt.amountCents === payment.amountCents === invoice.amountCents', async () => {
      const invoice = await service.createInvoice(TENANT_A, 'staff-1', {
        studentId: STUDENT_ID,
        title: 'Lab fee',
        amountCents: 2500000,
      });

      const {
        payment,
        receipt,
        invoice: paid,
      } = await service.recordPayment(TENANT_A, 'parent-a', {
        invoiceId: invoice.id,
        method: 'sandbox',
      });

      expect(paid.status).toBe('paid');
      expect(payment.amountCents).toBe(invoice.amountCents);
      expect(receipt.amountCents).toBe(payment.amountCents);
      expect(receipt.amountCents).toBe(invoice.amountCents);
      expect(receipt.receiptNumber).toMatch(/^RCP-/);
      expect(receipt.paymentId).toBe(payment.id);

      // G-718: two balanced journals — issuance (AR/revenue) and payment (cash/AR)
      const ledger = await service.getInvoiceLedger(TENANT_A, invoice.id);
      expect(ledger).toHaveLength(4);
      expect(new Set(ledger.map((e) => e.journalId)).size).toBe(2);
      const trial = await service.getTrialBalance(TENANT_A);
      expect(trial.debitCents).toBe(trial.creditCents);
      expect(trial.accounts.accounts_receivable).toBe(0);
      expect(trial.accounts.cash).toBe(invoice.amountCents);
      expect(trial.accounts.fee_revenue).toBe(-invoice.amountCents);
      expect(ledger.filter((e) => e.paymentId === payment.id)).toHaveLength(2);
    });

    it('voiding an open invoice reverses the receivable (G-718)', async () => {
      const invoice = await service.createInvoice(TENANT_A, 'staff-1', {
        studentId: STUDENT_ID,
        title: 'Cancelled trip',
        amountCents: 10_000,
      });
      await service.voidInvoice(TENANT_A, invoice.id);
      const trial = await service.getTrialBalance(TENANT_A);
      expect(trial.debitCents).toBe(trial.creditCents);
      expect(trial.accounts.accounts_receivable).toBe(0);
      expect(trial.accounts.fee_revenue).toBe(0);
    });

    it('repository rejects an unbalanced journal (G-718)', async () => {
      await expect(
        repository.postLedgerEntries([
          {
            id: 'e1',
            tenantId: TENANT_A,
            journalId: 'j1',
            invoiceId: 'inv',
            paymentId: null,
            receiptId: null,
            account: 'cash',
            side: 'debit',
            amountCents: 500,
            currency: 'INR',
            memo: null,
            postedBy: null,
            postedAt: new Date(),
          },
          {
            id: 'e2',
            tenantId: TENANT_A,
            journalId: 'j1',
            invoiceId: 'inv',
            paymentId: null,
            receiptId: null,
            account: 'accounts_receivable',
            side: 'credit',
            amountCents: 400,
            currency: 'INR',
            memo: null,
            postedBy: null,
            postedAt: new Date(),
          },
        ]),
      ).rejects.toThrow(/unbalanced/);
    });

    it('rejects mismatched amountCents override', async () => {
      const invoice = await service.createInvoice(TENANT_A, 'staff-1', {
        studentId: STUDENT_ID,
        title: 'Sports fee',
        amountCents: 50000,
      });

      await expect(
        service.recordPayment(TENANT_A, 'parent-a', {
          invoiceId: invoice.id,
          amountCents: 1,
        }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('rejects paying a non-open invoice', async () => {
      const invoice = await service.createInvoice(TENANT_A, 'staff-1', {
        studentId: STUDENT_ID,
        title: 'Once',
        amountCents: 10000,
      });
      await service.recordPayment(TENANT_A, 'parent-a', { invoiceId: invoice.id });

      await expect(
        service.recordPayment(TENANT_A, 'parent-a', { invoiceId: invoice.id }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('rejects charge adapter amount mismatch', async () => {
      const badAdapter: PaymentAdapter = {
        async charge(input) {
          return {
            status: 'succeeded',
            method: 'sandbox',
            amountCents: input.amountCents + 1,
            reference: 'bad',
          };
        },
      };
      const badService = new FeesService(repository, badAdapter);
      const invoice = await badService.createInvoice(TENANT_A, 'staff-1', {
        studentId: STUDENT_ID,
        title: 'Broken',
        amountCents: 1000,
      });

      await expect(
        badService.recordPayment(TENANT_A, 'parent-a', { invoiceId: invoice.id }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('throws NotFound for unknown invoice', async () => {
      await expect(
        service.recordPayment(TENANT_A, 'parent-a', {
          invoiceId: '00000000-0000-4000-8000-0000000000aa',
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('voidInvoice', () => {
    it('voids an open invoice and refuses paid ones', async () => {
      const open = await service.createInvoice(TENANT_A, 'staff-1', {
        studentId: STUDENT_ID,
        title: 'Void me',
        amountCents: 100,
      });
      const voided = await service.voidInvoice(TENANT_A, open.id);
      expect(voided.status).toBe('void');

      const paidInv = await service.createInvoice(TENANT_A, 'staff-1', {
        studentId: STUDENT_ID,
        title: 'Pay me',
        amountCents: 200,
      });
      await service.recordPayment(TENANT_A, 'parent-a', { invoiceId: paidInv.id });
      await expect(service.voidInvoice(TENANT_A, paidInv.id)).rejects.toThrow(BusinessRuleError);
    });
  });

  describe('reconciliation exceptions (F3)', () => {
    it('lists match/exception rows and resolves with audit', async () => {
      const invoice = await service.createInvoice(TENANT_A, 'staff-1', {
        studentId: STUDENT_ID,
        title: 'Recon target',
        amountCents: 5000,
      });
      const csv = `invoiceNumber,amountCents\n${invoice.invoiceNumber},5000\nMISSING,100`;
      const imported = await service.importReconciliationCsv(
        TENANT_A,
        'cashier-1',
        csv,
        'bank.csv',
      );
      expect(imported.matched).toHaveLength(1);
      expect(imported.unmatched).toHaveLength(1);

      const batches = await service.listReconciliationBatches(TENANT_A);
      expect(batches[0]?.id).toBe(imported.batch.id);
      expect(batches[0]?.createdBy).toBe('cashier-1');

      const rows = await service.listReconciliationRows(TENANT_A, imported.batch.id);
      const matched = rows.find((row) => row.matched);
      const exception = rows.find((row) => !row.matched);
      expect(matched?.exceptionStatus).toBe('none');
      expect(exception?.exceptionStatus).toBe('open');

      const resolved = await service.resolveReconciliationException(TENANT_A, 'bursar-1', {
        rowId: exception!.id,
        status: 'resolved',
        resolutionNote: 'Bank memo typo — write-off',
      });
      expect(resolved.exceptionStatus).toBe('resolved');
      expect(resolved.resolvedBy).toBe('bursar-1');
      expect(resolved.resolutionNote).toBe('Bank memo typo — write-off');
      expect(resolved.resolvedAt).toBeInstanceOf(Date);

      await expect(
        service.resolveReconciliationException(TENANT_A, 'bursar-1', {
          rowId: exception!.id,
          status: 'ignored',
          resolutionNote: 'again',
        }),
      ).rejects.toThrow(BusinessRuleError);

      await expect(
        service.resolveReconciliationException(TENANT_A, 'bursar-1', {
          rowId: matched!.id,
          status: 'resolved',
          resolutionNote: 'nope',
        }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('isolates recon batches by tenant', async () => {
      const invoice = await service.createInvoice(TENANT_A, 'staff-1', {
        studentId: STUDENT_ID,
        title: 'A only',
        amountCents: 1000,
      });
      await service.importReconciliationCsv(
        TENANT_A,
        'staff-1',
        `invoiceNumber,amountCents\n${invoice.invoiceNumber},1000`,
      );
      expect(await service.listReconciliationBatches(TENANT_B)).toEqual([]);
    });
  });


  describe('W2-FIN-03 ledger amount foundation', () => {
    it('postJournal posts an explicit amountCents argument (not invoice.amountCents)', () => {
      const srcPath = fileURLToPath(new URL('./fees-service.ts', import.meta.url));
      const src = readFileSync(srcPath, 'utf8');
      const start = src.indexOf('private async postJournal');
      const end = src.indexOf('async getInvoiceLedger');
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      const body = src.slice(start, end);
      // Foundation: journal legs take an explicit amount, not the invoice face amount.
      expect(body).toMatch(/amountCents:\s*amountCents/);
      expect(body).not.toMatch(/amountCents:\s*invoice\.amountCents/);
    });

    it('refund and concession journals use event amounts while invoice face stays independent', async () => {
      const structure = await service.createFeeStructure(TENANT_A, 'staff-1', {
        name: 'Tuition',
        category: 'tuition',
        amountCents: 10_000,
      });
      const invoice = await service.createInvoice(TENANT_A, 'staff-1', {
        studentId: STUDENT_ID,
        title: 'Tuition',
        amountCents: 10_000,
      });

      await service.applyConcession(TENANT_A, 'staff-1', {
        studentId: STUDENT_ID,
        structureId: structure.id,
        invoiceId: invoice.id,
        kind: 'amount',
        amountCents: 1_500,
        reason: 'sibling discount',
      });

      const afterConcession = await service.getInvoice(TENANT_A, invoice.id);
      expect(afterConcession.amountCents).toBe(8_500);

      const concessionLegs = (await service.getInvoiceLedger(TENANT_A, invoice.id)).filter(
        (e) => e.memo === 'concession applied',
      );
      expect(concessionLegs).toHaveLength(2);
      expect(concessionLegs.every((e) => e.amountCents === 1_500)).toBe(true);

      await service.recordPayment(TENANT_A, 'parent-a', {
        invoiceId: invoice.id,
        amountCents: 8_500,
      });

      await service.recordRefund(TENANT_A, 'staff-1', {
        invoiceId: invoice.id,
        amountCents: 2_000,
        reason: 'partial withdrawal',
      });

      const afterRefund = await service.getInvoice(TENANT_A, invoice.id);
      expect(afterRefund.amountCents).toBe(8_500);

      const refundLegs = (await service.getInvoiceLedger(TENANT_A, invoice.id)).filter(
        (e) => e.memo === 'refund posted',
      );
      expect(refundLegs).toHaveLength(2);
      expect(refundLegs.every((e) => e.amountCents === 2_000)).toBe(true);
    });
  });

  describe('money integrity (integer cents)', () => {
    it('rejects floating-point amountCents on create invoice / structure / payment / refund', async () => {
      await expect(
        service.createInvoice(TENANT_A, 'staff-1', {
          studentId: STUDENT_ID,
          title: 'Float invoice',
          amountCents: 10.5,
        }),
      ).rejects.toThrow(BusinessRuleError);

      await expect(
        service.createFeePlan(TENANT_A, 'staff-1', {
          name: 'Float plan',
          amountCents: 10.5,
        }),
      ).rejects.toThrow(BusinessRuleError);

      await expect(
        service.createFeeStructure(TENANT_A, 'staff-1', {
          name: 'Tuition',
          category: 'tuition',
          amountCents: 10.5,
        }),
      ).rejects.toThrow(BusinessRuleError);

      const invoice = await service.createInvoice(TENANT_A, 'staff-1', {
        studentId: STUDENT_ID,
        title: 'Ok invoice',
        amountCents: 1000,
      });

      await expect(
        service.recordPayment(TENANT_A, 'parent-a', {
          invoiceId: invoice.id,
          amountCents: 10.5,
        }),
      ).rejects.toThrow(BusinessRuleError);

      await expect(
        service.recordRefund(TENANT_A, 'staff-1', {
          invoiceId: invoice.id,
          amountCents: 10.5,
          reason: 'partial',
        }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('accepts integer amountCents for invoice, structure, payment, and refund', async () => {
      const structure = await service.createFeeStructure(TENANT_A, 'staff-1', {
        name: 'Lab',
        category: 'lab',
        amountCents: 2500,
      });
      expect(structure.amountCents).toBe(2500);

      const invoice = await service.createInvoice(TENANT_A, 'staff-1', {
        studentId: STUDENT_ID,
        title: 'Lab fee',
        amountCents: 2500,
      });
      expect(invoice.amountCents).toBe(2500);

      const { payment, receipt } = await service.recordPayment(TENANT_A, 'parent-a', {
        invoiceId: invoice.id,
        amountCents: 2500,
      });
      expect(payment.amountCents).toBe(2500);
      expect(receipt.amountCents).toBe(2500);

      const refund = await service.recordRefund(TENANT_A, 'staff-1', {
        invoiceId: invoice.id,
        amountCents: 500,
        reason: 'overcharge correction',
      });
      expect(refund.amountCents).toBe(500);
    });
  });
});
