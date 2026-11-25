/**
 * PRC-M535: a guardian's paymentRef on offer accept is no longer stored as
 * typed. It must name a payment recorded server-side on the offer's own fee
 * invoice; otherwise the accept is refused (400) and nothing changes.
 */
import { randomUUID } from 'node:crypto';
import { ValidationError } from '@proctira/common';
import { describe, expect, it } from 'vitest';
import { InMemoryRegistrationRepository } from '../in-memory-repository.js';
import { AdmissionsPipelineService, type VerifyOfferFeePaymentRef } from './pipeline-service.js';
import { InMemoryAdmissionsPipelineStore } from './pipeline-store.js';

const TENANT = randomUUID();
const INSTITUTION = randomUUID();
const PERIOD = randomUUID();
const GRADE = randomUUID();
const GUARDIAN = 'guardian@family.test';

function setup(verify?: VerifyOfferFeePaymentRef) {
  const store = new InMemoryAdmissionsPipelineStore();
  const paid = new Set<string>();
  const enrolments: string[] = [];
  const service = new AdmissionsPipelineService(
    store,
    new InMemoryRegistrationRepository(),
    async () => {
      const studentId = randomUUID();
      enrolments.push(studentId);
      return { studentId, enrollmentId: randomUUID() };
    },
    async () => ({ invoiceId: randomUUID() }),
    async ({ invoiceId }) => {
      if (!paid.has(invoiceId)) throw new Error('unpaid');
    },
    undefined,
    undefined,
    undefined,
    undefined,
    verify,
  );
  async function sentOffer(feeAmount: number) {
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
      firstName: 'Ref',
      lastName: 'Check',
      dateOfBirth: '2013-03-03',
      guardianName: 'Guardian',
      guardianPhone: '+91777',
      guardianEmail: GUARDIAN,
    });
    const converted = await service.convertEnquiry(TENANT, enquiry.id);
    const offer = await service.createOffer(TENANT, {
      applicationId: converted.application.id,
      feeAmount,
    });
    return service.sendOffer(TENANT, offer.id);
  }
  return { service, store, paid, enrolments, sentOffer };
}

describe('PRC-M535 guardian paymentRef must match a recorded payment', () => {
  it('refuses an arbitrary paymentRef on a paid offer (400, offer stays sent, no enrolment)', async () => {
    const calls: unknown[] = [];
    const ctx = setup(async (input) => {
      calls.push(input);
      return input.paymentRef === 'PAY-RECORDED';
    });
    const offer = await ctx.sentOffer(1000);
    ctx.paid.add(offer.offerFeeInvoiceId!);
    await expect(
      ctx.service.acceptOfferForGuardian(TENANT, offer.id, GUARDIAN, { paymentRef: 'made-up' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(calls).toEqual([
      { tenantId: TENANT, invoiceId: offer.offerFeeInvoiceId, paymentRef: 'made-up' },
    ]);
    expect((await ctx.store.findOffer(TENANT, offer.id))?.status).toBe('sent');
    expect(ctx.enrolments).toHaveLength(0);
  });

  it('stores a paymentRef that matches a payment recorded on the offer fee invoice', async () => {
    const ctx = setup(async (input) => input.paymentRef === 'PAY-RECORDED');
    const offer = await ctx.sentOffer(1000);
    ctx.paid.add(offer.offerFeeInvoiceId!);
    const accepted = await ctx.service.acceptOfferForGuardian(TENANT, offer.id, GUARDIAN, {
      paymentRef: 'PAY-RECORDED',
    });
    expect(accepted.status).toBe('accepted');
    expect(accepted.paymentRef).toBe('PAY-RECORDED');
  });

  it('refuses a paymentRef on a zero-fee offer (no invoice, so no recorded payment)', async () => {
    const ctx = setup(async () => true);
    const offer = await ctx.sentOffer(0);
    await expect(
      ctx.service.acceptOfferForGuardian(TENANT, offer.id, GUARDIAN, { paymentRef: 'anything' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(ctx.enrolments).toHaveLength(0);
  });

  it('fails closed when no verifier is wired', async () => {
    const ctx = setup();
    const offer = await ctx.sentOffer(1000);
    ctx.paid.add(offer.offerFeeInvoiceId!);
    await expect(
      ctx.service.acceptOfferForGuardian(TENANT, offer.id, GUARDIAN, { paymentRef: 'PAY-1' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('still accepts a paid offer without a paymentRef', async () => {
    const ctx = setup();
    const offer = await ctx.sentOffer(1000);
    ctx.paid.add(offer.offerFeeInvoiceId!);
    const accepted = await ctx.service.acceptOfferForGuardian(TENANT, offer.id, GUARDIAN, {});
    expect(accepted.status).toBe('accepted');
    expect(accepted.paymentRef).toBeNull();
  });
});
