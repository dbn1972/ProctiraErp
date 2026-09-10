import { createHash } from 'node:crypto';

export interface OfferLetterInput {
  offerId: string;
  tenantId: string;
  applicationId: string;
  firstName: string;
  lastName: string;
  institutionId: string;
  academicPeriodId: string;
  gradeId: string;
  quota: string;
  feeAmount: number;
  feeCurrency: string;
  issuedAt: string;
}

export interface SignedOfferDocument {
  kind: 'admission_offer';
  version: 1;
  offerId: string;
  tenantId: string;
  applicationId: string;
  applicant: { firstName: string; lastName: string };
  seat: {
    institutionId: string;
    academicPeriodId: string;
    gradeId: string;
    quota: string;
  };
  fee: { amount: number; currency: string };
  issuedAt: string;
  html: string;
  signature: string;
}

export function buildOfferDocument(input: OfferLetterInput): SignedOfferDocument {
  const html = [
    `<h1>Offer of admission</h1>`,
    `<p>${escapeHtml(input.firstName)} ${escapeHtml(input.lastName)}</p>`,
    `<p>Quota ${escapeHtml(input.quota)} · fee ${input.feeAmount} ${escapeHtml(input.feeCurrency)}</p>`,
    `<p>Offer ${escapeHtml(input.offerId)}</p>`,
  ].join('');
  const unsigned = {
    kind: 'admission_offer' as const,
    version: 1 as const,
    offerId: input.offerId,
    tenantId: input.tenantId,
    applicationId: input.applicationId,
    applicant: { firstName: input.firstName, lastName: input.lastName },
    seat: {
      institutionId: input.institutionId,
      academicPeriodId: input.academicPeriodId,
      gradeId: input.gradeId,
      quota: input.quota,
    },
    fee: { amount: input.feeAmount, currency: input.feeCurrency },
    issuedAt: input.issuedAt,
    html,
  };
  const signature = createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
  return { ...unsigned, signature };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
