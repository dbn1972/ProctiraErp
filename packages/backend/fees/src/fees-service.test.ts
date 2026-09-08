/**
 * FeesService unit tests — plan → invoice → pay → receipt + amount invariant.
 */
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

      const { payment, receipt, invoice: paid } = await service.recordPayment(
        TENANT_A,
        'parent-a',
        { invoiceId: invoice.id, method: 'sandbox' },
      );

      expect(paid.status).toBe('paid');
      expect(payment.amountCents).toBe(invoice.amountCents);
      expect(receipt.amountCents).toBe(payment.amountCents);
      expect(receipt.amountCents).toBe(invoice.amountCents);
      expect(receipt.receiptNumber).toMatch(/^RCP-/);
      expect(receipt.paymentId).toBe(payment.id);
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
});
