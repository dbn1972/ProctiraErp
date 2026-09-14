import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type { AdmissionsCrmStore } from '../admissions-crm-store.js';
import type { RegistrationEntity, RegistrationRepository } from '../registration-repository.js';
import { generateTrackingNumber } from '../registration-service.js';

import { buildOfferDocument } from './offer-letter.js';
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
  academicPeriodId: string;
}

export type EnrolOnAccept = (
  input: EnrolOnAcceptInput,
) => Promise<{ studentId: string; enrollmentId: string }>;

export interface SeatAvailability extends SeatMatrixRecord {
  filled: number;
  available: number;
}

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
}) => Promise<{ invoiceId: string }>;

export type AssertOfferFeePaid = (input: {
  tenantId: string;
  invoiceId: string;
  paymentRef?: string | null;
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
  ) {}

  async createEnquiry(tenantId: string, input: CreateEnquiryDto) {
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

  async listEnquiries(tenantId: string) {
    const rows = await this.store.listEnquiries(tenantId);
    return rows.map(formatEnquiry);
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
    const application = await this.requireApplication(tenantId, input.applicationId);
    const placement = await this.store.getPlacement(tenantId, application.id);
    if (!placement) {
      throw new BusinessRuleError(
        'Application is missing grade / period / quota placement required for an offer',
      );
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
      feeAmount: input.feeAmount ?? 0,
      feeCurrency: input.feeCurrency ?? 'INR',
      issuedAt: now.toISOString(),
    });
    let offerFeeInvoiceId = input.offerFeeInvoiceId ?? null;
    const feeAmount = input.feeAmount ?? 0;
    const feeCurrency = input.feeCurrency ?? 'INR';
    if (!offerFeeInvoiceId && feeAmount > 0 && this.createOfferFeeInvoice) {
      const invoice = await this.createOfferFeeInvoice({
        tenantId,
        applicationId: application.id,
        offerId: document.offerId,
        feeAmount,
        feeCurrency,
        firstName: application.firstName,
        lastName: application.lastName,
      });
      offerFeeInvoiceId = invoice.invoiceId;
    }
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
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      offerDocument: document as unknown as Record<string, unknown>,
      createdAt: now,
      updatedAt: now,
    };
    return formatOffer(await this.store.createOffer(record));
  }

  async sendOffer(tenantId: string, offerId: string) {
    const offer = await this.requireOffer(tenantId, offerId);
    if (offer.status !== 'draft') {
      throw new BusinessRuleError(`Cannot send an offer in '${offer.status}' status`);
    }
    await this.assertSeatAvailable(tenantId, offer);
    let offerFeeInvoiceId = offer.offerFeeInvoiceId;
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
    const offer = await this.requireOffer(tenantId, offerId);
    if (offer.status === 'accepted') {
      return formatOffer(offer);
    }
    const effective = this.expireIfNeeded(offer);
    if (effective.status === 'expired') {
      await this.store.updateOffer(effective);
      throw new BusinessRuleError('Offer has expired');
    }
    if (effective.status !== 'sent' && effective.status !== 'draft') {
      throw new BusinessRuleError(`Cannot accept an offer in '${effective.status}' status`);
    }
    await this.assertSeatAvailable(tenantId, effective);
    const application = await this.requireApplication(tenantId, effective.applicationId);

    if (effective.offerFeeInvoiceId && this.assertOfferFeePaid) {
      await this.assertOfferFeePaid({
        tenantId,
        invoiceId: effective.offerFeeInvoiceId,
        paymentRef: input.paymentRef ?? null,
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
        academicPeriodId: effective.academicPeriodId,
      });
      enrolledStudentId = enrolled.studentId;
    }

    const next: OfferRecord = {
      ...effective,
      status: 'accepted',
      paymentRef: input.paymentRef,
      offerFeeInvoiceId: input.offerFeeInvoiceId ?? effective.offerFeeInvoiceId,
      enrolledStudentId,
      updatedAt: new Date(),
    };
    return formatOffer(await this.store.updateOffer(next));
  }

  async declineOffer(tenantId: string, offerId: string) {
    const offer = await this.requireOffer(tenantId, offerId);
    if (offer.status === 'accepted') {
      throw new BusinessRuleError('Cannot decline an accepted offer');
    }
    if (offer.status === 'declined') {
      return { ...formatOffer(offer), promotedOffer: null as ReturnType<typeof formatOffer> | null };
    }
    const next: OfferRecord = { ...offer, status: 'declined', updatedAt: new Date() };
    const declined = formatOffer(await this.store.updateOffer(next));
    const promotedOffer = await this.promoteNextWaitlisted(tenantId, offer);
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
    const head = await this.crm.dequeueWaitlistHead(tenantId, released.institutionId);
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
      return await this.createOffer(tenantId, { applicationId: head.applicationId });
    } catch {
      // If promotion fails (e.g. seat already refilled), leave the dequeue durable —
      // staff can re-offer manually. Decline still succeeds.
      return null;
    }
  }

  async getApplicationBundle(tenantId: string, applicationId: string) {
    const application = await this.requireApplication(tenantId, applicationId);
    const [placement, offers, enquiries] = await Promise.all([
      this.store.getPlacement(tenantId, applicationId),
      this.store.listOffers(tenantId, applicationId),
      this.store.listEnquiries(tenantId),
    ]);
    const enquiry = enquiries.find((row) => row.applicationId === applicationId) ?? null;
    return {
      application: this.formatApplication(application),
      placement,
      enquiry: enquiry ? formatEnquiry(enquiry) : null,
      offers: offers.map((row) => formatOffer(this.expireIfNeeded(row))),
    };
  }

  async listOffers(tenantId: string, applicationId?: string) {
    return (await this.store.listOffers(tenantId, applicationId)).map((row) =>
      formatOffer(this.expireIfNeeded(row)),
    );
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
      const effective = this.expireIfNeeded(offer);
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

  private expireIfNeeded(offer: OfferRecord): OfferRecord {
    if (
      offer.expiresAt &&
      offer.expiresAt.getTime() < Date.now() &&
      (offer.status === 'draft' || offer.status === 'sent')
    ) {
      return { ...offer, status: 'expired', updatedAt: new Date() };
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
