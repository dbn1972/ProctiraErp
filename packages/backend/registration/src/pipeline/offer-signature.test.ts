/**
 * PRC-M336 — offer documents carry a keyed HMAC signature verified on accept;
 * fee amounts are bounded 2-decimal values in an allowed ISO currency.
 */
import { randomUUID } from 'node:crypto';
import { ConflictError, ValidationError } from '@proctira/common';
import { describe, expect, it } from 'vitest';
import { InMemoryRegistrationRepository } from '../in-memory-repository.js';
import { buildOfferDocument, OfferSignatureError, verifyOfferDocument } from './offer-letter.js';
import { AdmissionsPipelineService } from './pipeline-service.js';
import { InMemoryAdmissionsPipelineStore } from './pipeline-store.js';

const TENANT = randomUUID();
const INSTITUTION = randomUUID();
const PERIOD = randomUUID();
const GRADE = randomUUID();

const base = {
  offerId: randomUUID(),
  tenantId: TENANT,
  applicationId: randomUUID(),
  firstName: 'A',
  lastName: 'B',
  institutionId: INSTITUTION,
  academicPeriodId: PERIOD,
  gradeId: GRADE,
  quota: 'general',
  feeAmount: 1500,
  feeCurrency: 'INR',
  issuedAt: '2026-01-01T00:00:00.000Z',
};

async function setup() {
  const store = new InMemoryAdmissionsPipelineStore();
  const apps = new InMemoryRegistrationRepository();
  const service = new AdmissionsPipelineService(store, apps, async () => ({
    studentId: randomUUID(),
    enrollmentId: randomUUID(),
  }));
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
    firstName: 'S',
    lastName: 'T',
    dateOfBirth: '2013-01-01',
    guardianName: 'G',
    guardianPhone: '+91000',
  });
  const converted = await service.convertEnquiry(TENANT, enquiry.id);
  return { store, service, applicationId: converted.application.id };
}

describe('PRC-M336 offer signature + fee validation', () => {
  it('signature is keyed (different secret -> different signature) and key-order independent', () => {
    const a = buildOfferDocument(base, { ADMISSIONS_OFFER_SIGNING_SECRET: 'k'.repeat(32) });
    const b = buildOfferDocument(base, { ADMISSIONS_OFFER_SIGNING_SECRET: 'z'.repeat(32) });
    expect(a.signatureAlg).toBe('hmac-sha256');
    expect(a.signature).not.toBe(b.signature);
    // JSONB re-orders keys; verification must still pass.
    const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(a).reverse())));
    expect(() =>
      verifyOfferDocument(reordered, { ADMISSIONS_OFFER_SIGNING_SECRET: 'k'.repeat(32) }),
    ).not.toThrow();
  });

  it('tampering with a stored document fails verification', () => {
    const env = { ADMISSIONS_OFFER_SIGNING_SECRET: 'k'.repeat(32) };
    const doc = buildOfferDocument(base, env) as unknown as Record<string, unknown>;
    const tampered = { ...doc, fee: { amount: 1, currency: 'INR' } };
    expect(() => verifyOfferDocument(tampered, env)).toThrow(OfferSignatureError);
    expect(() => verifyOfferDocument({ ...doc, classId: randomUUID() }, env)).toThrow(
      OfferSignatureError,
    );
  });

  it('legacy unkeyed documents are refused by default', () => {
    expect(() => verifyOfferDocument({ kind: 'admission_offer', signature: 'abc' }, {})).toThrow(
      OfferSignatureError,
    );
  });

  it('production without a signing secret fails closed', () => {
    expect(() => buildOfferDocument(base, { NODE_ENV: 'production' })).toThrow(OfferSignatureError);
  });

  it('accepting an offer whose stored document was tampered -> 409', async () => {
    const { store, service, applicationId } = await setup();
    const offer = await service.createOffer(TENANT, { applicationId });
    await service.sendOffer(TENANT, offer.id);
    const stored = (await store.findOffer(TENANT, offer.id))!;
    await store.updateOffer({
      ...stored,
      offerDocument: { ...stored.offerDocument, classId: randomUUID() },
    });
    await expect(service.acceptOffer(TENANT, offer.id, {})).rejects.toBeInstanceOf(ConflictError);
  });

  it('accepting an offer whose row fee diverges from the signed document -> 409', async () => {
    const { store, service, applicationId } = await setup();
    const offer = await service.createOffer(TENANT, { applicationId });
    await service.sendOffer(TENANT, offer.id);
    const stored = (await store.findOffer(TENANT, offer.id))!;
    await store.updateOffer({ ...stored, quota: 'management' });
    await expect(service.acceptOffer(TENANT, offer.id, {})).rejects.toBeInstanceOf(ConflictError);
  });

  it.each([10.005, 1e12, -1, Number.NaN])('feeAmount %s -> 400', async (feeAmount) => {
    const { service, applicationId } = await setup();
    await expect(service.createOffer(TENANT, { applicationId, feeAmount })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('unknown currency -> 400; 2-decimal amount is fine', async () => {
    const { service, applicationId } = await setup();
    await expect(
      service.createOffer(TENANT, { applicationId, feeAmount: 10, feeCurrency: 'XXX' }),
    ).rejects.toBeInstanceOf(ValidationError);
    const ok = await service.createOffer(TENANT, { applicationId, feeAmount: 10.05 });
    expect(ok.feeAmount).toBe(10.05);
  });
});
