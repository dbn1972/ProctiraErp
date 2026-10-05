/**
 * PRC-H079 — a client-supplied paymentRef is never proof of offer-fee payment.
 * Acceptance of a fee-bearing offer requires the server-owned fee invoice to be
 * `paid` (set only by the verified PSP webhook path); the verifier is read-only.
 */
import { randomUUID } from 'node:crypto';
import { BusinessRuleError, ConflictError, ValidationError } from '@proctira/common';
import { describe, expect, it } from 'vitest';
import { InMemoryRegistrationRepository } from '../in-memory-repository.js';
import {
  AdmissionsPipelineService,
  type VerifyOfferFeeInvoiceOwnership,
} from './pipeline-service.js';
import { InMemoryAdmissionsPipelineStore } from './pipeline-store.js';

const TENANT = randomUUID();
const INSTITUTION = randomUUID();
const PERIOD = randomUUID();
const GRADE = randomUUID();

function setup(
  opts: {
    feeHooks?: boolean;
    verifyOwnership?: VerifyOfferFeeInvoiceOwnership;
  } = {},
) {
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
    undefined,
    undefined,
    opts.verifyOwnership,
  );
  async function application() {
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
      firstName: 'Owner',
      lastName: 'Check',
      dateOfBirth: '2013-03-03',
      guardianName: 'Guardian',
      guardianPhone: '+91777',
      guardianEmail: 'guardian@family.test',
    });
    return (await service.convertEnquiry(TENANT, enquiry.id)).application;
  }
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
    application,
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
    // PRC-M327: cannot even be sent without invoicing; accept from draft is 409.
    await expect(ctx.sentOffer(1000)).rejects.toBeInstanceOf(ConflictError);
    const draft = (await ctx.store.listOffers(TENANT))[0]!;
    await expect(
      ctx.service.acceptOffer(TENANT, draft.id, { paymentRef: 'x' }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(ctx.enrolments).toHaveLength(0);
  });

  it('rejects accepting a fee-bearing offer straight from draft (409)', async () => {
    const ctx = setup();
    const draft = await ctx.sentOffer(1000, false);
    await expect(
      ctx.service.acceptOffer(TENANT, draft.id, { paymentRef: 'x' }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('PRC-M327: rejects accepting a zero-fee draft offer (409)', async () => {
    const ctx = setup();
    const draft = await ctx.sentOffer(0, false);
    await expect(ctx.service.acceptOffer(TENANT, draft.id, {})).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(ctx.enrolments).toHaveLength(0);
  });

  it('PRC-M327: rejects a client-supplied offerFeeInvoiceId on create (400)', async () => {
    const ctx = setup();
    const offer = await ctx.sentOffer(0, false);
    await expect(
      ctx.service.createOffer(TENANT, {
        applicationId: offer.applicationId,
        feeAmount: 1000,
        offerFeeInvoiceId: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('PRC-M327: verifier receives application, offer and expected fee', async () => {
    const calls: unknown[] = [];
    const store = new InMemoryAdmissionsPipelineStore();
    const apps = new InMemoryRegistrationRepository();
    const service = new AdmissionsPipelineService(
      store,
      apps,
      async () => ({ studentId: randomUUID(), enrollmentId: randomUUID() }),
      async () => ({ invoiceId: randomUUID() }),
      async (input) => {
        calls.push(input);
      },
    );
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
      firstName: 'A',
      lastName: 'B',
      dateOfBirth: '2013-03-03',
      guardianName: 'G',
      guardianPhone: '+91777',
    });
    const converted = await service.convertEnquiry(TENANT, enquiry.id);
    const offer = await service.createOffer(TENANT, {
      applicationId: converted.application.id,
      feeAmount: 1500,
    });
    const sent = await service.sendOffer(TENANT, offer.id);
    await service.acceptOffer(TENANT, offer.id, {});
    expect(calls).toEqual([
      expect.objectContaining({
        invoiceId: sent.offerFeeInvoiceId,
        applicationId: converted.application.id,
        offerId: offer.id,
        expectedAmount: 1500,
        expectedCurrency: 'INR',
      }),
    ]);
  });

  it('a zero-fee offer is accepted without any payment reference', async () => {
    const ctx = setup();
    const offer = await ctx.sentOffer(0);
    const accepted = await ctx.service.acceptOffer(TENANT, offer.id, {});
    expect(accepted.status).toBe('accepted');
  });
});

describe('PRC-H079 create-time offer invoice ownership', () => {
  it('rejects a staff-supplied invoice that the verifier says is not this application', async () => {
    const seen: unknown[] = [];
    const ctx = setup({
      verifyOwnership: async (input) => {
        seen.push(input);
        return false;
      },
    });
    const app = await ctx.application();
    const foreign = randomUUID();
    await expect(
      ctx.service.createOffer(TENANT, {
        applicationId: app.id,
        feeAmount: 500,
        offerFeeInvoiceId: foreign,
      }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    // The verifier receives the offer's fee so it can reject a different-amount invoice.
    expect(seen).toEqual([
      {
        tenantId: TENANT,
        applicationId: app.id,
        invoiceId: foreign,
        feeAmount: 500,
        feeCurrency: 'INR',
      },
    ]);
  });

  it('fails closed when no ownership verifier is wired', async () => {
    const ctx = setup();
    const app = await ctx.application();
    await expect(
      ctx.service.createOffer(TENANT, {
        applicationId: app.id,
        feeAmount: 500,
        offerFeeInvoiceId: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it("keeps the application's own verified invoice", async () => {
    const ctx = setup({ verifyOwnership: async () => true });
    const app = await ctx.application();
    const own = randomUUID();
    const offer = await ctx.service.createOffer(TENANT, {
      applicationId: app.id,
      feeAmount: 500,
      offerFeeInvoiceId: own,
    });
    expect(offer.offerFeeInvoiceId).toBe(own);
  });

  it('needs no verifier when the invoice is left to be raised on send', async () => {
    const ctx = setup();
    const app = await ctx.application();
    const offer = await ctx.service.createOffer(TENANT, { applicationId: app.id, feeAmount: 500 });
    expect(offer.offerFeeInvoiceId).toBeNull();
  });
});
