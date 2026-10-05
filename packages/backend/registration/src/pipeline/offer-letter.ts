import { createHmac, timingSafeEqual } from 'node:crypto';

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
  /** Class placement used at enrolment; covered by the signature (PRC-M336). */
  classId?: string | null;
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
  classId: string | null;
  html: string;
  /** PRC-M336: keyed server signature, not a bare content hash. */
  signatureAlg: 'hmac-sha256';
  signature: string;
}

/** Allowed offer-fee currencies (ISO 4217). */
export const OFFER_FEE_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'] as const;
/** Upper bound on an offer fee in major units. */
export const MAX_OFFER_FEE_AMOUNT = 10_000_000;

/** Thrown when an offer document fails authenticity verification. */
export class OfferSignatureError extends Error {}

/**
 * Signing key. Production requires `ADMISSIONS_OFFER_SIGNING_SECRET` (or
 * `JWT_SECRET`) and fails closed without it; a fixed key is only used outside
 * production so local/test flows work.
 */
function signingSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.ADMISSIONS_OFFER_SIGNING_SECRET ?? env.JWT_SECRET;
  if (secret && secret.length >= 16) return secret;
  if (env.NODE_ENV === 'production') {
    throw new OfferSignatureError(
      'ADMISSIONS_OFFER_SIGNING_SECRET is not configured; refusing to sign/verify offers',
    );
  }
  return 'proctira-admissions-offer-dev-only-key';
}

/** Deterministic JSON (sorted keys) so JSONB round-trips verify identically. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sign(unsigned: Record<string, unknown>, env?: NodeJS.ProcessEnv): string {
  return createHmac('sha256', signingSecret(env)).update(canonicalJson(unsigned)).digest('hex');
}

export function buildOfferDocument(
  input: OfferLetterInput,
  env?: NodeJS.ProcessEnv,
): SignedOfferDocument {
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
    classId: input.classId ?? null,
    html,
    signatureAlg: 'hmac-sha256' as const,
  };
  return { ...unsigned, signature: sign(unsigned, env) };
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * PRC-M336: verify a stored offer document was issued by this server and was
 * not altered. Legacy unkeyed SHA-256 documents are rejected unless
 * `ADMISSIONS_OFFER_ACCEPT_LEGACY_SIGNATURE=1` (default unset: fail closed).
 */
export function verifyOfferDocument(
  doc: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const { signature, ...unsigned } = doc;
  if (typeof signature !== 'string' || signature.length === 0) {
    throw new OfferSignatureError('Offer document is not signed');
  }
  if (unsigned.signatureAlg === 'hmac-sha256') {
    if (!safeEqualHex(sign(unsigned, env), signature)) {
      throw new OfferSignatureError('Offer document signature is invalid');
    }
    return;
  }
  // Legacy documents carried an unkeyed SHA-256 that cannot prove authenticity
  // (and JSONB key re-ordering prevents recomputing it). They are refused unless
  // an operator explicitly opts in during the migration window.
  if (env.ADMISSIONS_OFFER_ACCEPT_LEGACY_SIGNATURE === '1') return;
  throw new OfferSignatureError('Offer document uses an unsupported or invalid signature');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
