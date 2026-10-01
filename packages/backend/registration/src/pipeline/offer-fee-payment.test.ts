/**
 * PRC-H079 — a client-supplied paymentRef is never proof of offer-fee payment.
 * Acceptance of a fee-bearing offer requires the server-owned fee invoice to be
 * `paid` (set only by the verified PSP webhook path); the verifier is read-only.
 */
import { randomUUID } from 'node:crypto';
import { BusinessRuleError } from '@proctira/common';
import { describe, expect, it } from 'vitest';
import { InMemoryRegistrationRepository } from '../in-memory-repository.js';
import { AdmissionsPipelineService } from './pipeline-service.js';
import { InMemoryAdmissionsPipelineStore } from './pipeline-store.js';

const TENANT = randomUUID();
const INSTITUTION = randomUUID();
const PERIOD = randomUUID();
const GRADE = randomUUID();

function setup(opts: { feeHooks?: boolean } = {}) {
  const store = new InMemoryAdmissionsPipelineStore();
  const apps = new InMemoryRegistrationRepository();
  /** Fake fee ledger: invoiceId -> status. Only `pay()` (the webhook) marks paid. */
  const invoices = new Map<string, 'unpaid' | 'paid'>();
  let recordedPayments = 0;
  const enrolments: string[] = [];
  const feeHooks = opts.feeHooks !== false;
  const service = new AdmissionsPipelineService(
    store,
    apps,
    async () => {
      const studentId = randomUUID();
      enrolments.push(studentId);
      return { studentId, enrollmentId: randomUUID() };
    },
    feeHooks
      ? async () => {
          const invoiceId = randomUUID();
          invoices.set(invoiceId, 'unpaid');
          return { invoiceId };
        }
      : undefined,
    feeHooks
      ? async ({ invoiceId }) => {
          if (invoices.get(invoiceId) !== 'paid') {
            throw new BusinessRuleError('Offer fee invoice must be paid before enrolment');
          }
        }
      : undefined,
  );
  async function sentOffer(feeAmount: number, send = true) {
    await service.upsertSeat(TENANT, {
      institutionId: INSTITUTION,
      academicPeriodId: PERIOD,
      gradeId: GRADE,
      seats: 5,
    });
    const enquiry = await service.createEnquiry(TENANT, {
      institutionId: INSTITUTION,
      academicPeriodId: PERIOD,
      gradeId: GRADE,
      firstName: 'Fee',
      lastName: 'Payer',
      dateOfBirth: '2013-03-03',
      guardianName: 'Guardian',
      guardianPhone: '+91777',
      guardianEmail: 'guardian@family.test',
    });
    const converted = await service.convertEnquiry(TENANT, enquiry.id);
    const offer = await service.createOffer(TENANT, {
      applicationId: converted.application.id,
      feeAmount,
    });
    return send ? service.sendOffer(TENANT, offer.id) : offer;
  }
  return {
    service,
    store,
    invoices,
    enrolments,
    sentOffer,
    get recordedPayments() {
      return recordedPayments;
    },
    pay(invoiceId: string) {
      recordedPayments += 1;
      invoices.set(invoiceId, 'paid');
    },
  };
}

describe('PRC-H079 offer fee payment proof', () => {
  it('rejects accept with an arbitrary paymentRef on an unpaid invoice; offer stays sent', async () => {
    const ctx = setup();
    const offer = await ctx.sentOffer(1000);
    expect(offer.offerFeeInvoiceId).toBeTruthy();
    await expect(
      ctx.service.acceptOffer(TENANT, offer.id, { paymentRef: 'x' }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    const after = await ctx.store.findOffer(TENANT, offer.id);
    expect(after?.status).toBe('sent');
    expect(ctx.invoices.get(offer.offerFeeInvoiceId!)).toBe('unpaid');
    expect(ctx.enrolments).toHaveLength(0);
  });

  it('rejects guardian accept via the parent portal path while the invoice is unpaid', async () => {
    const ctx = setup();
    const offer = await ctx.sentOffer(1000);
    await expect(
      ctx.service.acceptOfferForGuardian(TENANT, offer.id, 'guardian@family.test', {
        paymentRef: 'SANDBOX-PAY',
      }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    expect(ctx.enrolments).toHaveLength(0);
  });

  it('ignores a client-supplied offerFeeInvoiceId (cannot swap in another paid invoice)', async () => {
    const ctx = setup();
    const offer = await ctx.sentOffer(1000);
    const otherPaid = randomUUID();
    ctx.invoices.set(otherPaid, 'paid');
    await expect(
      ctx.service.acceptOffer(TENANT, offer.id, { paymentRef: 'x', offerFeeInvoiceId: otherPaid }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('accepts and enrols once the invoice is paid by the webhook path', async () => {
    const ctx = setup();
    const offer = await ctx.sentOffer(1000);
    ctx.pay(offer.offerFeeInvoiceId!);
    const accepted = await ctx.service.acceptOffer(TENANT, offer.id, {});
    expect(accepted.status).toBe('accepted');
    expect(accepted.enrolledStudentId).toBeTruthy();
    expect(accepted.offerFeeInvoiceId).toBe(offer.offerFeeInvoiceId);
  });

  it('fails closed for a fee offer when no fee verifier / invoice is configured', async () => {
    const ctx = setup({ feeHooks: false });
    const offer = await ctx.sentOffer(1000);
    await expect(
      ctx.service.acceptOffer(TENANT, offer.id, { paymentRef: 'x' }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    expect(ctx.enrolments).toHaveLength(0);
  });

  it('rejects accepting a fee-bearing offer straight from draft', async () => {
    const ctx = setup();
    const draft = await ctx.sentOffer(1000, false);
    await expect(
      ctx.service.acceptOffer(TENANT, draft.id, { paymentRef: 'x' }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('a zero-fee offer is accepted without any payment reference', async () => {
    const ctx = setup();
    const offer = await ctx.sentOffer(0);
    const accepted = await ctx.service.acceptOffer(TENANT, offer.id, {});
    expect(accepted.status).toBe('accepted');
  });
});
