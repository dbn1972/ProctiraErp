import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type { AdmissionsCrmStore } from '../admissions-crm-store.js';
import { dateOfBirthErrors, parseTimestamp } from '../input-validation.js';
import { MAX_LIST_PAGE_SIZE, toPageResult, type ListPage } from '../pagination.js';
import type { RegistrationEntity, RegistrationRepository } from '../registration-repository.js';
import { generateTrackingNumber } from '../registration-service.js';

import {
  buildOfferDocument,
  MAX_OFFER_FEE_AMOUNT,
  OFFER_FEE_CURRENCIES,
  OfferSignatureError,
  verifyOfferDocument,
  type SignedOfferDocument,
} from './offer-letter.js';
import type {
  ApplicationPlacement,
  AdmissionsPipelineStore,
  EnquiryRecord,
  FollowupRecord,
  MeritListEntryRecord,
  MeritListRecord,
  OfferRecord,
  SeatMatrixRecord,
} from './pipeline-store.js';
import { rankCandidates, type MeritWeights } from './ranking.js';
import type {
  AcceptOfferDto,
  CreateEnquiryDto,
  CreateFollowupDto,
  CreateOfferDto,
  EnquiryStage,
  GenerateMeritListDto,
  ApplicationPlacementDto,
  UpdateEnquiryDto,
  UpsertSeatMatrixDto,
} from './schemas.js';

export interface EnrolOnAcceptInput {
  tenantId: string;
  applicationId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  guardianName: string;
  guardianPhone: string;
  guardianEmail: string | null;
  institutionId: string;
  gradeId: string;
  classId?: string | null;
  academicPeriodId: string;
}

export type EnrolOnAccept = (
  input: EnrolOnAcceptInput,
) => Promise<{ studentId: string; enrollmentId: string }>;

export interface SeatAvailability extends SeatMatrixRecord {
  filled: number;
  available: number;
}

/** PRC-M336: fee must be a non-negative amount with at most 2 decimals, bounded, ISO currency. */
function assertValidOfferFee(amount: number, currency: string): void {
  const cents = amount * 100;
  if (
    !Number.isFinite(amount) ||
    amount < 0 ||
    amount > MAX_OFFER_FEE_AMOUNT ||
    Math.abs(cents - Math.round(cents)) > 1e-6
  ) {
    throw new ValidationError('Invalid offer fee amount', [
      {
        field: 'feeAmount',
        rule: 'format',
        message: `feeAmount must be 0..${MAX_OFFER_FEE_AMOUNT} with at most 2 decimal places`,
      },
    ]);
  }
  if (!(OFFER_FEE_CURRENCIES as readonly string[]).includes(currency)) {
    throw new ValidationError('Invalid offer fee currency', [
      {
        field: 'feeCurrency',
        rule: 'enum',
        message: `feeCurrency must be one of ${OFFER_FEE_CURRENCIES.join(', ')}`,
      },
    ]);
  }
}

/**
 * PRC-M336: the stored offer document must carry a valid server signature and
 * agree with the offer row (fee, seat, applicant) before it can be accepted.
 */
function assertOfferDocumentAuthentic(offer: OfferRecord): void {
  try {
    verifyOfferDocument(offer.offerDocument);
  } catch (error) {
    throw new ConflictError(
      error instanceof OfferSignatureError ? error.message : 'Offer document cannot be verified',
    );
  }
  const doc = offer.offerDocument as Partial<SignedOfferDocument>;
  if (doc.signatureAlg !== 'hmac-sha256') return; // explicitly allowed legacy document
  const matches =
    doc.offerId === offer.id &&
    doc.tenantId === offer.tenantId &&
    doc.applicationId === offer.applicationId &&
    doc.seat?.institutionId === offer.institutionId &&
    doc.seat?.academicPeriodId === offer.academicPeriodId &&
    doc.seat?.gradeId === offer.gradeId &&
    doc.seat?.quota === offer.quota &&
    Number(doc.fee?.amount) === Number(offer.feeAmount) &&
    doc.fee?.currency === offer.feeCurrency;
  if (!matches) throw new ConflictError('Offer record does not match its signed offer document');
}

/** Upper bound on stale waitlist entries skipped in one promotion (PRC-M329). */
const MAX_WAITLIST_SKIPS = 50;

function num(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function formatEnquiry(row: EnquiryRecord) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function formatFollowup(row: FollowupRecord) {
  return {
    ...row,
    dueAt: row.dueAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function formatOffer(row: OfferRecord) {
  return {
    ...row,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export type CreateOfferFeeInvoice = (input: {
  tenantId: string;
  applicationId: string;
  offerId: string;
  feeAmount: number;
  feeCurrency: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  guardianName: string;
  guardianPhone: string;
  guardianEmail: string | null;
}) => Promise<{ invoiceId: string }>;

/**
 * Verifies (read-only) that the offer-fee invoice is paid. Must never record a
 * payment: payment state is set only by the verified PSP webhook / callback
 * path. A client `paymentRef` is informational and is not passed (PRC-H079).
 */
export type AssertOfferFeePaid = (input: {
  tenantId: string;
  invoiceId: string;
  /** PRC-M327: the invoice must belong to this application/offer and match the fee. */
  applicationId: string;
  offerId: string;
  expectedAmount: number;
  expectedCurrency: string;
}) => Promise<void>;

/**
 * Verifies that a staff-supplied offer-fee invoice belongs to this tenant and
 * application (PRC-H079). Returns false when the invoice is unknown, belongs to
 * another student/application, or is not an admissions offer-fee invoice.
 */
export type VerifyOfferFeeInvoiceOwnership = (input: {
  tenantId: string;
  applicationId: string;
  invoiceId: string;
  /** The new offer's fee (major units) and currency: the invoice must match both. */
  feeAmount: number;
  feeCurrency: string;
}) => Promise<boolean>;

export type ReconcileOfferResources = (input: {
  tenantId: string;
  applicationId: string;
  invoiceId: string | null;
  status: 'declined' | 'expired';
}) => Promise<void>;

export class AdmissionsPipelineService {
  constructor(
    private readonly store: AdmissionsPipelineStore,
    private readonly applications: Pick<
      RegistrationRepository,
      'create' | 'findById' | 'listByTenant' | 'updateStatus'
    >,
    private readonly enrolOnAccept?: EnrolOnAccept,
    private readonly createOfferFeeInvoice?: CreateOfferFeeInvoice,
    private readonly assertOfferFeePaid?: AssertOfferFeePaid,
    /** Optional CRM waitlist used to promote the next applicant when a seat frees. */
    private readonly crm?: AdmissionsCrmStore,
    private readonly reconcileOfferResources?: ReconcileOfferResources,
    private readonly verifyOfferFeeInvoiceOwnership?: VerifyOfferFeeInvoiceOwnership,
  ) {}

  async createEnquiry(tenantId: string, input: CreateEnquiryDto) {
    const dobErrors = dateOfBirthErrors(input.dateOfBirth);
    if (dobErrors.length > 0) throw new ValidationError('Invalid date of birth', dobErrors);
    const now = new Date();
    const record: EnquiryRecord = {
      id: uuidv4(),
      tenantId,
      institutionId: input.institutionId,
      institutionName: input.institutionName ?? null,
      academicPeriodId: input.academicPeriodId,
      gradeId: input.gradeId,
      quota: input.quota ?? 'general',
      source: input.source ?? 'other',
      stage: 'new',
      firstName: input.firstName,
      lastName: input.lastName,
      dateOfBirth: input.dateOfBirth,
      gender: input.gender ?? 'other',
      guardianName: input.guardianName,
      guardianPhone: input.guardianPhone,
      guardianEmail: input.guardianEmail ?? null,
      interviewScore: input.interviewScore ?? null,
      testScore: input.testScore ?? null,
      applicationId: null,
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
    return formatEnquiry(await this.store.createEnquiry(record));
  }

  async listEnquiries(tenantId: string, page: ListPage = { limit: MAX_LIST_PAGE_SIZE, offset: 0 }) {
    const rows = await this.store.listEnquiries(tenantId, page);
    const result = toPageResult(rows, page);
    return { ...result, data: result.data.map(formatEnquiry) };
  }

  async updateEnquiry(tenantId: string, id: string, input: UpdateEnquiryDto) {
    const existing = await this.requireEnquiry(tenantId, id);
    const next: EnquiryRecord = {
      ...existing,
      stage: input.stage ?? existing.stage,
      source: input.source ?? existing.source,
      interviewScore: input.interviewScore ?? existing.interviewScore,
      testScore: input.testScore ?? existing.testScore,
      notes: input.notes ?? existing.notes,
      quota: input.quota ?? existing.quota,
      updatedAt: new Date(),
    };
    return formatEnquiry(await this.store.updateEnquiry(next));
  }

  async addFollowup(tenantId: string, enquiryId: string, input: CreateFollowupDto) {
    await this.requireEnquiry(tenantId, enquiryId);
    const dueAt = new Date(input.dueAt);
    if (Number.isNaN(dueAt.getTime())) {
      throw new ValidationError('Invalid follow-up due date', [
        { field: 'dueAt', rule: 'format', message: 'dueAt must be an ISO timestamp' },
      ]);
    }
    const now = new Date();
    const record: FollowupRecord = {
      id: uuidv4(),
      tenantId,
      enquiryId,
      dueAt,
      ownerId: input.ownerId ?? null,
      notes: input.notes ?? '',
      status: 'open',
      createdAt: now,
      updatedAt: now,
    };
    return formatFollowup(await this.store.createFollowup(record));
  }

  async listFollowups(tenantId: string, enquiryId: string) {
    await this.requireEnquiry(tenantId, enquiryId);
    return (await this.store.listFollowups(tenantId, enquiryId)).map(formatFollowup);
  }

  async convertEnquiry(tenantId: string, enquiryId: string) {
    const enquiry = await this.requireEnquiry(tenantId, enquiryId);
    if (enquiry.applicationId) {
      const existing = await this.applications.findById(enquiry.applicationId, tenantId);
      if (existing) {
        return {
          enquiry: formatEnquiry(enquiry),
          application: this.formatApplication(existing),
        };
      }
    }

    const created = await this.applications.create({
      id: uuidv4(),
      tenantId,
      trackingNumber: generateTrackingNumber(),
      institutionId: enquiry.institutionId,
      institutionName: enquiry.institutionName ?? 'School',
      status: 'pending',
      firstName: enquiry.firstName,
      lastName: enquiry.lastName,
      dateOfBirth: enquiry.dateOfBirth,
      gender: enquiry.gender,
      guardianName: enquiry.guardianName,
      guardianPhone: enquiry.guardianPhone,
      guardianEmail: enquiry.guardianEmail,
      customFields: [],
      documents: [],
      preferredLanguage: null,
      remarks: null,
    });

    await this.store.upsertPlacement({
      applicationId: created.id,
      tenantId,
      institutionId: enquiry.institutionId,
      academicPeriodId: enquiry.academicPeriodId,
      gradeId: enquiry.gradeId,
      quota: enquiry.quota,
      interviewScore: num(enquiry.interviewScore),
      testScore: num(enquiry.testScore),
      firstName: created.firstName,
      lastName: created.lastName,
      submittedAt: created.submittedAt,
    });

    const next: EnquiryRecord = {
      ...enquiry,
      applicationId: created.id,
      stage: 'applied' satisfies EnquiryStage,
      updatedAt: new Date(),
    };
    await this.store.updateEnquiry(next);
    return {
      enquiry: formatEnquiry(next),
      application: this.formatApplication(created),
    };
  }

  async upsertSeat(tenantId: string, input: UpsertSeatMatrixDto): Promise<SeatAvailability> {
    const now = new Date();
    const saved = await this.store.upsertSeat({
      id: uuidv4(),
      tenantId,
      institutionId: input.institutionId,
      academicPeriodId: input.academicPeriodId,
      gradeId: input.gradeId,
      quota: input.quota ?? 'general',
      seats: input.seats,
      createdAt: now,
      updatedAt: now,
    });
    return this.withAvailability(tenantId, saved);
  }

  async listSeats(
    tenantId: string,
    filter?: { institutionId?: string; academicPeriodId?: string },
  ): Promise<SeatAvailability[]> {
    const rows = await this.store.listSeats(tenantId, filter);
    return Promise.all(rows.map((row) => this.withAvailability(tenantId, row)));
  }

  async setPlacement(tenantId: string, applicationId: string, input: ApplicationPlacementDto) {
    const application = await this.requireApplication(tenantId, applicationId);
    const saved = await this.store.upsertPlacement({
      applicationId,
      tenantId,
      institutionId: application.institutionId,
      academicPeriodId: input.academicPeriodId,
      gradeId: input.gradeId,
      quota: input.quota ?? 'general',
      interviewScore: num(input.interviewScore),
      testScore: num(input.testScore),
      firstName: application.firstName,
      lastName: application.lastName,
      submittedAt: application.submittedAt,
    });
    return saved;
  }

  async generateMeritList(tenantId: string, input: GenerateMeritListDto) {
    const weights: MeritWeights = {
      interview: input.interviewWeight,
      test: input.testWeight,
    };
    try {
      rankCandidates([], weights);
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : 'Invalid merit weights', [
        { field: 'weights', rule: 'sum', message: 'interviewWeight + testWeight must equal 1' },
      ]);
    }

    const placements = await this.store.listPlacements(tenantId, {
      institutionId: input.institutionId,
      academicPeriodId: input.academicPeriodId,
      gradeId: input.gradeId,
    });
    const ranked = rankCandidates(
      placements.map((row) => ({
        applicationId: row.applicationId,
        interviewScore: row.interviewScore,
        testScore: row.testScore,
        submittedAt: row.submittedAt,
      })),
      weights,
    );

    const list: MeritListRecord = {
      id: uuidv4(),
      tenantId,
      institutionId: input.institutionId,
      academicPeriodId: input.academicPeriodId,
      gradeId: input.gradeId,
      interviewWeight: weights.interview,
      testWeight: weights.test,
      weightsSnapshot: weights,
      generatedAt: new Date(),
    };
    const entries: MeritListEntryRecord[] = ranked.map((row) => ({
      id: uuidv4(),
      tenantId,
      meritListId: list.id,
      applicationId: row.applicationId,
      rank: row.rank,
      score: row.score,
      interviewScore: row.interviewScore,
      testScore: row.testScore,
      weightsSnapshot: weights,
    }));
    const saved = await this.store.replaceMeritList(list, entries);
    return this.formatMerit(saved.list, saved.entries, placements);
  }

  async getMeritList(
    tenantId: string,
    filter: { institutionId: string; academicPeriodId: string; gradeId: string },
  ) {
    const found = await this.store.findMeritList(tenantId, filter);
    if (!found) return null;
    const placements = await this.store.listPlacements(tenantId, filter);
    return this.formatMerit(found.list, found.entries, placements);
  }

  async createOffer(tenantId: string, input: CreateOfferDto) {
    // PRC-M327: offer-fee invoices are server-owned (raised at send). A client
    // supplied invoice id could reference another applicant's paid invoice.
    if (input.offerFeeInvoiceId !== undefined) {
      throw new ValidationError('offerFeeInvoiceId cannot be supplied by the client', [
        {
          field: 'offerFeeInvoiceId',
          rule: 'forbidden',
          message: 'The offer-fee invoice is raised by the server when the offer is sent',
        },
      ]);
    }
    const application = await this.requireApplication(tenantId, input.applicationId);
    const placement = await this.store.getPlacement(tenantId, application.id);
    if (!placement) {
      throw new BusinessRuleError(
        'Application is missing grade / period / quota placement required for an offer',
      );
    }
    const feeAmount = input.feeAmount ?? 0;
    const feeCurrency = input.feeCurrency ?? 'INR';
    assertValidOfferFee(feeAmount, feeCurrency);
    // PRC-M333: expiresAt must be a real timestamp in the future.
    let expiresAt: Date | null = null;
    if (input.expiresAt !== undefined) {
      expiresAt = parseTimestamp(input.expiresAt);
      if (!expiresAt || expiresAt.getTime() <= Date.now()) {
        throw new ValidationError('Invalid offer expiry', [
          {
            field: 'expiresAt',
            rule: 'format',
            message: 'expiresAt must be a future ISO timestamp',
          },
        ]);
      }
    }
    await this.assertSeatAvailable(tenantId, placement);
    const now = new Date();
    const document = buildOfferDocument({
      offerId: uuidv4(),
      tenantId,
      applicationId: application.id,
      firstName: application.firstName,
      lastName: application.lastName,
      institutionId: placement.institutionId,
      academicPeriodId: placement.academicPeriodId,
      gradeId: placement.gradeId,
      quota: placement.quota,
      feeAmount,
      feeCurrency,
      issuedAt: now.toISOString(),
      classId: input.classId ?? null,
    });
    const offerFeeInvoiceId = null;
    const record: OfferRecord = {
      id: document.offerId,
      tenantId,
      applicationId: application.id,
      meritListId: input.meritListId ?? null,
      institutionId: placement.institutionId,
      academicPeriodId: placement.academicPeriodId,
      gradeId: placement.gradeId,
      quota: placement.quota,
      status: 'draft',
      feeAmount,
      feeCurrency,
      paymentRef: null,
      offerFeeInvoiceId,
      enrolledStudentId: null,
      expiresAt,
      offerDocument: document as unknown as Record<string, unknown>,
      createdAt: now,
      updatedAt: now,
    };
    return formatOffer(await this.store.createOffer(record));
  }

  async sendOffer(tenantId: string, offerId: string) {
    return this.store.withOfferLock(tenantId, offerId, () =>
      this.sendOfferLocked(tenantId, offerId),
    );
  }

  private async sendOfferLocked(tenantId: string, offerId: string) {
    const offer = await this.requireOffer(tenantId, offerId);
    if (offer.status !== 'draft') {
      throw new BusinessRuleError(`Cannot send an offer in '${offer.status}' status`);
    }
    await this.assertSeatAvailable(tenantId, offer);
    let offerFeeInvoiceId = offer.offerFeeInvoiceId;
    if (offerFeeInvoiceId) {
      // PRC-H079: createOffer no longer accepts a client invoice id (PRC-M327), but a
      // draft persisted before that change may still carry a staff-supplied one. It must
      // be this application's own offer-fee invoice for THIS offer's amount/currency;
      // otherwise another student's (or an earlier, different-amount offer's) paid
      // invoice could satisfy acceptance. No verifier wired -> fail closed.
      const owned = this.verifyOfferFeeInvoiceOwnership
        ? await this.verifyOfferFeeInvoiceOwnership({
            tenantId,
            applicationId: offer.applicationId,
            invoiceId: offerFeeInvoiceId,
            feeAmount: offer.feeAmount,
            feeCurrency: offer.feeCurrency,
          })
        : false;
      if (!owned) {
        throw new BusinessRuleError(
          'offerFeeInvoiceId does not belong to this application and offer fee; the offer fee invoice must be raised on send',
        );
      }
    }
    if (!offerFeeInvoiceId && offer.feeAmount > 0 && !this.createOfferFeeInvoice) {
      // PRC-M327: fail closed — a fee offer without an invoice could never be paid.
      throw new ConflictError('Offer fee invoicing is not configured; cannot send a fee offer');
    }
    if (!offerFeeInvoiceId && offer.feeAmount > 0 && this.createOfferFeeInvoice) {
      const application = await this.requireApplication(tenantId, offer.applicationId);
      const invoice = await this.createOfferFeeInvoice({
        tenantId,
        applicationId: application.id,
        offerId: offer.id,
        feeAmount: offer.feeAmount,
        feeCurrency: offer.feeCurrency,
        firstName: application.firstName,
        lastName: application.lastName,
        dateOfBirth: application.dateOfBirth,
        gender: application.gender,
        guardianName: application.guardianName,
        guardianPhone: application.guardianPhone,
        guardianEmail: application.guardianEmail,
      });
      offerFeeInvoiceId = invoice.invoiceId;
    }
    const next: OfferRecord = {
      ...offer,
      offerFeeInvoiceId,
      status: 'sent',
      updatedAt: new Date(),
    };
    return formatOffer(await this.store.updateOffer(next));
  }

  async acceptOffer(tenantId: string, offerId: string, input: AcceptOfferDto) {
    return this.store.withOfferLock(tenantId, offerId, () =>
      this.acceptOfferLocked(tenantId, offerId, input),
    );
  }

  private async acceptOfferLocked(tenantId: string, offerId: string, input: AcceptOfferDto) {
    const offer = await this.requireOffer(tenantId, offerId);
    if (offer.status === 'accepted') {
      return formatOffer(offer);
    }
    const effective = await this.expireIfNeeded(offer);
    if (effective.status === 'expired') {
      throw new BusinessRuleError('Offer has expired');
    }
    // PRC-M327: only a sent offer can be accepted (drafts were never issued).
    if (effective.status !== 'sent') {
      throw new ConflictError(`Cannot accept an offer in '${effective.status}' status`);
    }
    if (effective.feeAmount > 0) {
      // PRC-H079: a fee-bearing offer is accepted only against a verified paid
      // invoice raised at send time. No invoice / no verifier -> fail closed.
      if (!effective.offerFeeInvoiceId || !this.assertOfferFeePaid) {
        throw new ConflictError(
          'Offer fee payment cannot be verified; acceptance is blocked until the fee is paid',
        );
      }
    }
    // PRC-M328: seat count + enrolment + accepted write run under one lock per
    // seat-matrix key so concurrent accepts of different offers cannot over-fill.
    return this.store.withSeatLock(tenantId, effective, () =>
      this.acceptOfferSeatLocked(tenantId, effective, input),
    );
  }

  private async acceptOfferSeatLocked(
    tenantId: string,
    effective: OfferRecord,
    input: AcceptOfferDto,
  ) {
    assertOfferDocumentAuthentic(effective);
    await this.assertSeatAvailable(tenantId, effective);
    const application = await this.requireApplication(tenantId, effective.applicationId);

    if (effective.feeAmount > 0 && effective.offerFeeInvoiceId && this.assertOfferFeePaid) {
      await this.assertOfferFeePaid({
        tenantId,
        invoiceId: effective.offerFeeInvoiceId,
        applicationId: effective.applicationId,
        offerId: effective.id,
        expectedAmount: effective.feeAmount,
        expectedCurrency: effective.feeCurrency,
      });
    }

    let enrolledStudentId = effective.enrolledStudentId;
    if (!enrolledStudentId) {
      if (!this.enrolOnAccept) {
        throw new BusinessRuleError('Student enrolment is not configured for admissions');
      }
      const enrolled = await this.enrolOnAccept({
        tenantId,
        applicationId: application.id,
        firstName: application.firstName,
        lastName: application.lastName,
        dateOfBirth: application.dateOfBirth,
        gender: application.gender,
        guardianName: application.guardianName,
        guardianPhone: application.guardianPhone,
        guardianEmail: application.guardianEmail,
        institutionId: effective.institutionId,
        gradeId: effective.gradeId,
        classId:
          typeof effective.offerDocument['classId'] === 'string'
            ? effective.offerDocument['classId']
            : null,
        academicPeriodId: effective.academicPeriodId,
      });
      enrolledStudentId = enrolled.studentId;
    }

    const next: OfferRecord = {
      ...effective,
      status: 'accepted',
      // Informational client reference only; never payment proof (PRC-H079).
      paymentRef: input.paymentRef ?? null,
      // The fee invoice is server-owned (raised at send); a client id is ignored.
      offerFeeInvoiceId: effective.offerFeeInvoiceId,
      enrolledStudentId,
      updatedAt: new Date(),
    };
    return formatOffer(await this.store.updateOffer(next));
  }

  async declineOffer(tenantId: string, offerId: string) {
    return this.store.withOfferLock(tenantId, offerId, () =>
      this.declineOfferLocked(tenantId, offerId),
    );
  }

  private async declineOfferLocked(tenantId: string, offerId: string) {
    const offer = await this.requireOffer(tenantId, offerId);
    if (offer.status === 'accepted') {
      throw new BusinessRuleError('Cannot decline an accepted offer');
    }
    await this.reconcileOfferResources?.({
      tenantId,
      applicationId: offer.applicationId,
      invoiceId: offer.offerFeeInvoiceId,
      status: 'declined',
    });
    if (offer.status === 'declined') {
      return {
        ...formatOffer(offer),
        promotedOffer: null as ReturnType<typeof formatOffer> | null,
      };
    }
    const next: OfferRecord = { ...offer, status: 'declined', updatedAt: new Date() };
    const declined = formatOffer(await this.store.updateOffer(next));
    // PRC-M337: only an issued (sent) offer holds a seat claim; declining a
    // draft releases nothing, so the waitlist is left untouched.
    const promotedOffer =
      offer.status === 'sent' ? await this.promoteNextWaitlisted(tenantId, offer) : null;
    return { ...declined, promotedOffer };
  }

  /**
   * W2-ADM-02: when a seat is released by a declined offer, promote the head
   * of the institution waitlist into a draft offer (when CRM is wired).
   */
  private async promoteNextWaitlisted(
    tenantId: string,
    released: OfferRecord,
  ): Promise<ReturnType<typeof formatOffer> | null> {
    if (!this.crm) return null;
    // PRC-M329: skip (and drop) stale entries whose application is no longer
    // `waitlisted` — a rejected/approved applicant is never promoted.
    let head: Awaited<ReturnType<AdmissionsCrmStore['dequeueWaitlistHead']>> = null;
    for (let i = 0; i < MAX_WAITLIST_SKIPS; i += 1) {
      const candidate = await this.crm.dequeueWaitlistHead(tenantId, released.institutionId);
      if (!candidate) return null;
      const app = await this.applications.findById(candidate.applicationId, tenantId);
      if (app && app.tenantId === tenantId && app.status === 'waitlisted') {
        head = candidate;
        break;
      }
    }
    if (!head) return null;

    // Ensure placement matches the freed seat band when missing.
    const existingPlacement = await this.store.getPlacement(tenantId, head.applicationId);
    if (!existingPlacement) {
      const application = await this.applications.findById(head.applicationId, tenantId);
      if (!application) return null;
      await this.store.upsertPlacement({
        applicationId: head.applicationId,
        tenantId,
        institutionId: released.institutionId,
        academicPeriodId: released.academicPeriodId,
        gradeId: released.gradeId,
        quota: released.quota,
        interviewScore: 0,
        testScore: 0,
        firstName: application.firstName,
        lastName: application.lastName,
        submittedAt: application.submittedAt,
      });
    }

    try {
      if (this.applications.updateStatus) {
        await this.applications.updateStatus(
          head.applicationId,
          'under_review',
          'Promoted from waitlist after seat release',
          tenantId,
        );
      }
      return await this.createOffer(tenantId, {
        applicationId: head.applicationId,
        classId:
          typeof released.offerDocument['classId'] === 'string'
            ? released.offerDocument['classId']
            : undefined,
      });
    } catch {
      // If promotion fails (e.g. seat already refilled), leave the dequeue durable —
      // staff can re-offer manually. Decline still succeeds.
      return null;
    }
  }

  async getApplicationBundle(tenantId: string, applicationId: string) {
    const application = await this.requireApplication(tenantId, applicationId);
    // PRC-M337: targeted enquiry lookup instead of loading every enquiry.
    const [placement, offers, enquiry] = await Promise.all([
      this.store.getPlacement(tenantId, applicationId),
      this.store.listOffers(tenantId, applicationId),
      this.store.findEnquiryByApplication(tenantId, applicationId),
    ]);
    const resolvedOffers = await Promise.all(offers.map((row) => this.expireIfNeeded(row)));
    return {
      application: this.formatApplication(application),
      placement,
      enquiry: enquiry ? formatEnquiry(enquiry) : null,
      offers: resolvedOffers.map(formatOffer),
    };
  }

  async listOffers(
    tenantId: string,
    applicationId?: string,
    page: ListPage = { limit: MAX_LIST_PAGE_SIZE, offset: 0 },
  ) {
    const offers = await this.store.listOffers(tenantId, applicationId, page);
    const result = toPageResult(offers, page);
    const data = await Promise.all(
      result.data.map(async (row) => formatOffer(await this.expireIfNeeded(row))),
    );
    return { ...result, data };
  }

  /**
   * Parent/guardian family view — only offers whose application guardianEmail
   * matches the JWT email (case-insensitive). Draft/declined/expired are hidden;
   * sent (open) and accepted remain visible.
   */
  async listGuardianOffers(tenantId: string, guardianEmail: string) {
    const email = normalizeEmail(guardianEmail);
    if (!email) return [];
    const offers = await this.store.listOffers(tenantId);
    const rows: Array<
      ReturnType<typeof formatOffer> & {
        applicantFirstName: string;
        applicantLastName: string;
        guardianEmail: string | null;
      }
    > = [];
    for (const offer of offers) {
      const effective = await this.expireIfNeeded(offer);
      if (effective.status !== 'sent' && effective.status !== 'accepted') continue;
      const application = await this.applications.findById(effective.applicationId, tenantId);
      if (!application || application.tenantId !== tenantId) continue;
      if (normalizeEmail(application.guardianEmail) !== email) continue;
      rows.push({
        ...formatOffer(effective),
        applicantFirstName: application.firstName,
        applicantLastName: application.lastName,
        guardianEmail: application.guardianEmail,
      });
    }
    return rows;
  }

  /**
   * Accept + enrol for a guardian email match only. Mismatched or missing email → 404.
   */
  async acceptOfferForGuardian(
    tenantId: string,
    offerId: string,
    guardianEmail: string,
    input: AcceptOfferDto,
  ) {
    const email = normalizeEmail(guardianEmail);
    if (!email) {
      throw new NotFoundError(`Offer '${offerId}' not found`);
    }
    const offer = await this.requireOffer(tenantId, offerId);
    const application = await this.requireApplication(tenantId, offer.applicationId);
    if (normalizeEmail(application.guardianEmail) !== email) {
      throw new NotFoundError(`Offer '${offerId}' not found`);
    }
    const accepted = await this.acceptOffer(tenantId, offerId, input);
    return {
      ...accepted,
      applicantFirstName: application.firstName,
      applicantLastName: application.lastName,
      guardianEmail: application.guardianEmail,
    };
  }

  private async expireIfNeeded(offer: OfferRecord): Promise<OfferRecord> {
    if (
      offer.expiresAt &&
      offer.expiresAt.getTime() < Date.now() &&
      (offer.status === 'draft' || offer.status === 'sent')
    ) {
      const expired: OfferRecord = { ...offer, status: 'expired', updatedAt: new Date() };
      await this.reconcileOfferResources?.({
        tenantId: offer.tenantId,
        applicationId: offer.applicationId,
        invoiceId: offer.offerFeeInvoiceId,
        status: 'expired',
      });
      return this.store.updateOffer(expired);
    }
    return offer;
  }

  private async assertSeatAvailable(
    tenantId: string,
    key: { institutionId: string; academicPeriodId: string; gradeId: string; quota: string },
  ): Promise<void> {
    const seat = await this.store.findSeat(tenantId, key);
    if (!seat) {
      throw new BusinessRuleError('No seat matrix row configured for this class quota');
    }
    const filled = await this.store.countAcceptedSeats(tenantId, key);
    if (filled >= seat.seats) {
      throw new ConflictError('No seats remaining for this class quota');
    }
  }

  private async withAvailability(
    tenantId: string,
    seat: SeatMatrixRecord,
  ): Promise<SeatAvailability> {
    const filled = await this.store.countAcceptedSeats(tenantId, seat);
    return {
      ...seat,
      filled,
      available: Math.max(0, seat.seats - filled),
      createdAt: seat.createdAt,
      updatedAt: seat.updatedAt,
    };
  }

  private formatMerit(
    list: MeritListRecord,
    entries: MeritListEntryRecord[],
    placements: ApplicationPlacement[],
  ) {
    const names = new Map(placements.map((row) => [row.applicationId, row]));
    return {
      ...list,
      generatedAt: list.generatedAt.toISOString(),
      entries: [...entries]
        .sort((a, b) => a.rank - b.rank)
        .map((entry) => ({
          ...entry,
          firstName: names.get(entry.applicationId)?.firstName ?? null,
          lastName: names.get(entry.applicationId)?.lastName ?? null,
        })),
    };
  }

  private formatApplication(application: RegistrationEntity) {
    return {
      id: application.id,
      tenantId: application.tenantId,
      trackingNumber: application.trackingNumber,
      institutionId: application.institutionId,
      institutionName: application.institutionName,
      status: application.status,
      firstName: application.firstName,
      lastName: application.lastName,
      dateOfBirth: application.dateOfBirth,
      gender: application.gender,
      guardianName: application.guardianName,
      guardianPhone: application.guardianPhone,
      guardianEmail: application.guardianEmail,
      submittedAt: application.submittedAt.toISOString(),
      updatedAt: application.updatedAt.toISOString(),
      remarks: application.remarks,
    };
  }

  private async requireEnquiry(tenantId: string, id: string): Promise<EnquiryRecord> {
    const row = await this.store.findEnquiry(tenantId, id);
    if (!row) throw new NotFoundError(`Enquiry '${id}' not found`);
    return row;
  }

  private async requireOffer(tenantId: string, id: string): Promise<OfferRecord> {
    const row = await this.store.findOffer(tenantId, id);
    if (!row) throw new NotFoundError(`Offer '${id}' not found`);
    return row;
  }

  private async requireApplication(tenantId: string, id: string): Promise<RegistrationEntity> {
    const row = await this.applications.findById(id, tenantId);
    if (!row || row.tenantId !== tenantId) {
      throw new NotFoundError(`Application '${id}' not found`);
    }
    return row;
  }
}
