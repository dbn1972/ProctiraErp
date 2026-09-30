/**
 * Scholarship Service
 *
 * Business logic for scholarship program management, application processing,
 * disbursement tracking, compliance monitoring, and utilization reporting.
 *
 * Requirements:
 * - 11.1: Define scholarship programs with eligibility criteria, application periods, and available slots
 * - 11.2: Accept and track applications with required documents, academic records, and financial information
 * - 11.3: Route applications through configurable approval Workflow_Engine
 * - 11.4: Track disbursement schedules, payment status, and recipient compliance
 * - 11.5: Generate reports on scholarship utilization by program, area, gender, and institution
 */
import {
  AppError,
  ErrorCode,
  ConflictError,
  NotFoundError,
  BusinessRuleError,
  ValidationError,
  majorUnitsToCents,
  majorUnitsNumberFromCents,
  assertMajorMatchesCents,
} from '@proctira/common';
import type { PaginationOptions, PaginatedResult, FieldError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type {
  CreateScholarshipProgramInput,
  UpdateScholarshipProgramInput,
  CreateApplicationInput,
  CreateDisbursementInput,
  UpdateDisbursementInput,
  RecipientComplianceInput,
  UtilizationReportQuery,
  FinancialInfo,
  EligibilityCriteria,
} from './schemas.js';
import type {
  ScholarshipProgramEntity,
  ScholarshipApplicationEntity,
  DisbursementEntity,
  ComplianceRecordEntity,
  ProgramFilter,
  ApplicationFilter,
  DisbursementFilter,
  UtilizationReportFilter,
  UtilizationReportData,
  ScholarshipRepository,
  ApplicationStatus,
  DisbursementFrequency,
  PaymentStatus,
} from './scholarship-repository.js';

/** Evaluator ids are stored in a uuid column; non-UUID subjects are recorded as null. */
const EVALUATOR_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * PRC-H085: allowed disbursement payment-status transitions.
 * `cancelled` is terminal. `paid` may only move to `cancelled` (the explicit
 * reversal that un-nets the fee invoice); it can never go back to
 * scheduled/processing/failed.
 */
export const DISBURSEMENT_TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  scheduled: ['processing', 'paid', 'cancelled'],
  processing: ['paid', 'failed', 'cancelled'],
  failed: ['scheduled', 'cancelled'],
  paid: ['cancelled'],
  cancelled: [],
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** PRC-H085: max instalments of `amountPerRecipient` per award, by frequency. */
export const INSTALMENTS_PER_FREQUENCY: Readonly<Record<DisbursementFrequency, number>> = {
  one_time: 1,
  annual: 1,
  semester: 2,
  quarterly: 4,
  monthly: 12,
};

/**
 * Interface for Workflow Engine integration.
 * Requirement 11.3: Route applications through configurable approval workflow.
 */
export interface WorkflowEngineClient {
  /**
   * Create a workflow instance for a scholarship application.
   * Returns the workflow instance ID.
   */
  createInstance(
    tenantId: string,
    workflowId: string,
    entityType: string,
    entityId: string,
  ): Promise<string>;
}

/**
 * Reviewer context attached to an approve / reject decision (G-911).
 */
export interface ApplicationDecision {
  /** JWT `sub` of the deciding user; null / omitted for system decisions. */
  reviewerId?: string | null;
  /** Free-text note for the school coordinator (trimmed; blank → null). */
  notes?: string | null;
  /** Approve only: queue the first instalment for today at the program amount. */
  scheduleFirstDisbursement?: boolean;
}

function normaliseNotes(notes: string | null | undefined): string | null {
  const trimmed = notes?.trim();
  return trimmed ? trimmed : null;
}

/** Resolve major + optional cents into reconciled pair (W1-DATA-09). */
function resolveMoneyPair(
  major: number,
  centsHint: number | undefined,
  field: string,
): { amount: number; amountCents: number } {
  const amountCents = centsHint !== undefined ? centsHint : majorUnitsToCents(major);
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new BusinessRuleError(`${field} cents must be a non-negative integer`);
  }
  assertMajorMatchesCents(major, amountCents);
  return { amount: majorUnitsNumberFromCents(amountCents), amountCents };
}

/** Reject non-cent-representable money nested in application / eligibility JSON. */
function assertCentRepresentableMoney(
  financialInfo: FinancialInfo,
  eligibility?: EligibilityCriteria,
): void {
  if (financialInfo.familyIncome !== undefined) {
    majorUnitsToCents(financialInfo.familyIncome);
  }
  for (const other of financialInfo.otherScholarships ?? []) {
    majorUnitsToCents(other.amount);
  }
  if (eligibility?.maxFamilyIncome !== undefined) {
    majorUnitsToCents(eligibility.maxFamilyIncome);
  }
}

/**
 * Options for the ScholarshipService.
 */
export interface ScholarshipServiceOptions {
  /** Default workflow ID for scholarship application approval */
  defaultWorkflowId?: string;
  /**
   * G-1 / W2-FIN-08: when a disbursement becomes `paid`, net integer cents onto student fees.
   * amountCents is reconciled from major units via majorUnitsToCents (no float Math.round).
   */
  onDisbursementPaid?: (input: {
    tenantId: string;
    disbursementId: string;
    applicationId: string;
    applicantId: string;
    amount: number;
    amountCents: number;
    currency: string;
  }) => Promise<void>;
  /**
   * W2-FIN-08: when a paid disbursement is cancelled/failed, reverse the fee netting.
   */
  onDisbursementReversed?: (input: {
    tenantId: string;
    disbursementId: string;
    applicationId: string;
    applicantId: string;
    amountCents: number;
    currency: string;
  }) => Promise<void>;
}

/**
 * Service handling scholarship business logic.
 */
export class ScholarshipService {
  private readonly defaultWorkflowId: string;
  private readonly onDisbursementPaid?: ScholarshipServiceOptions['onDisbursementPaid'];
  private readonly onDisbursementReversed?: ScholarshipServiceOptions['onDisbursementReversed'];

  constructor(
    private readonly repository: ScholarshipRepository,
    private readonly workflowEngine?: WorkflowEngineClient,
    options?: ScholarshipServiceOptions,
  ) {
    this.defaultWorkflowId = options?.defaultWorkflowId ?? 'scholarship_approval';
    this.onDisbursementPaid = options?.onDisbursementPaid;
    this.onDisbursementReversed = options?.onDisbursementReversed;
  }

  // ─── Program Operations ──────────────────────────────────────────────────

  /**
   * Create a new scholarship program.
   * Requirement 11.1: Define scholarship programs with eligibility criteria, application periods, and available slots.
   *
   * @throws ValidationError if application dates are invalid
   */
  async createProgram(
    tenantId: string,
    input: CreateScholarshipProgramInput,
  ): Promise<ScholarshipProgramEntity> {
    // Validate date range
    if (input.applicationStartDate >= input.applicationEndDate) {
      throw new ValidationError('Application start date must be before end date', [
        {
          field: 'applicationEndDate',
          rule: 'dateRange',
          message: 'End date must be after start date',
        },
      ]);
    }

    const money = resolveMoneyPair(
      input.amountPerRecipient,
      input.amountPerRecipientCents,
      'amountPerRecipient',
    );
    assertCentRepresentableMoney({}, input.eligibility);

    const program: Omit<ScholarshipProgramEntity, 'createdAt' | 'updatedAt'> = {
      id: uuidv4(),
      tenantId,
      name: input.name,
      description: input.description ?? null,
      applicationStartDate: input.applicationStartDate,
      applicationEndDate: input.applicationEndDate,
      totalSlots: input.totalSlots,
      usedSlots: 0,
      amountPerRecipient: money.amount,
      amountPerRecipientCents: money.amountCents,
      currency: input.currency ?? 'USD',
      disbursementFrequency: (input.disbursementFrequency as DisbursementFrequency) ?? 'one_time',
      eligibility: input.eligibility,
      status: 'draft',
      academicPeriodId: input.academicPeriodId ?? null,
      fundingSourceId: input.fundingSourceId ?? null,
    };

    return this.repository.createProgram(program);
  }

  /**
   * Update an existing scholarship program.
   *
   * @throws NotFoundError if program not found
   * @throws BusinessRuleError if program is archived
   * @throws ValidationError if date range is invalid
   */
  async updateProgram(
    tenantId: string,
    id: string,
    input: UpdateScholarshipProgramInput,
  ): Promise<ScholarshipProgramEntity> {
    const existing = await this.repository.findProgramById(id, tenantId);
    if (!existing) {
      throw new NotFoundError(`Scholarship program with id '${id}' not found`);
    }

    if (existing.status === 'archived') {
      throw new BusinessRuleError('Cannot update an archived scholarship program');
    }

    // Validate date range if dates are being changed
    const startDate = input.applicationStartDate ?? existing.applicationStartDate;
    const endDate = input.applicationEndDate ?? existing.applicationEndDate;
    if (startDate >= endDate) {
      throw new ValidationError('Application start date must be before end date', [
        {
          field: 'applicationEndDate',
          rule: 'dateRange',
          message: 'End date must be after start date',
        },
      ]);
    }

    const updateData: Partial<ScholarshipProgramEntity> = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.applicationStartDate !== undefined)
      updateData.applicationStartDate = input.applicationStartDate;
    if (input.applicationEndDate !== undefined)
      updateData.applicationEndDate = input.applicationEndDate;
    if (input.totalSlots !== undefined) updateData.totalSlots = input.totalSlots;
    if (input.amountPerRecipient !== undefined || input.amountPerRecipientCents !== undefined) {
      const major = input.amountPerRecipient ?? existing.amountPerRecipient;
      const money = resolveMoneyPair(major, input.amountPerRecipientCents, 'amountPerRecipient');
      updateData.amountPerRecipient = money.amount;
      updateData.amountPerRecipientCents = money.amountCents;
    }
    if (input.currency !== undefined) updateData.currency = input.currency;
    if (input.disbursementFrequency !== undefined)
      updateData.disbursementFrequency =
        input.disbursementFrequency as ScholarshipProgramEntity['disbursementFrequency'];
    if (input.eligibility !== undefined) {
      assertCentRepresentableMoney({}, input.eligibility);
      updateData.eligibility = input.eligibility;
    }
    if (input.status !== undefined)
      updateData.status = input.status as ScholarshipProgramEntity['status'];
    if (input.academicPeriodId !== undefined) updateData.academicPeriodId = input.academicPeriodId;
    if (input.fundingSourceId !== undefined) updateData.fundingSourceId = input.fundingSourceId;

    const updated = await this.repository.updateProgram(id, tenantId, updateData);
    if (!updated) {
      throw new NotFoundError(`Scholarship program with id '${id}' not found`);
    }

    return updated;
  }

  /**
   * Get a scholarship program by ID.
   *
   * @throws NotFoundError if program not found
   */
  async getProgramById(tenantId: string, id: string): Promise<ScholarshipProgramEntity> {
    const program = await this.repository.findProgramById(id, tenantId);
    if (!program) {
      throw new NotFoundError(`Scholarship program with id '${id}' not found`);
    }
    return program;
  }

  /**
   * List scholarship programs with pagination and filtering.
   */
  async listPrograms(
    tenantId: string,
    filter: ProgramFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<ScholarshipProgramEntity>> {
    return this.repository.listPrograms(tenantId, filter, pagination);
  }

  /**
   * Delete a scholarship program.
   *
   * @throws NotFoundError if program not found
   * @throws BusinessRuleError if program has active applications
   */
  async deleteProgram(tenantId: string, id: string): Promise<void> {
    const existing = await this.repository.findProgramById(id, tenantId);
    if (!existing) {
      throw new NotFoundError(`Scholarship program with id '${id}' not found`);
    }

    const applicationCount = await this.repository.countApplicationsByProgram(id, tenantId);
    if (applicationCount > 0) {
      throw new BusinessRuleError(
        'Cannot delete a scholarship program with existing applications. Archive it instead.',
      );
    }

    await this.repository.deleteProgram(id, tenantId);
  }

  // ─── Application Operations ──────────────────────────────────────────────

  /**
   * Submit a scholarship application.
   * Requirement 11.2: Accept and track applications with required documents, academic records, and financial information.
   * Requirement 11.3: Route applications through configurable approval Workflow_Engine.
   *
   * @throws NotFoundError if program not found
   * @throws BusinessRuleError if program is not accepting applications
   * @throws BusinessRuleError if no slots available
   * @throws ConflictError if applicant already applied to this program
   * @throws ValidationError if required documents are missing
   */
  async submitApplication(
    tenantId: string,
    input: CreateApplicationInput,
  ): Promise<ScholarshipApplicationEntity> {
    // Validate program exists and is open
    const program = await this.repository.findProgramById(input.programId, tenantId);
    if (!program) {
      throw new NotFoundError(`Scholarship program with id '${input.programId}' not found`);
    }

    if (program.status !== 'open') {
      throw new BusinessRuleError('Scholarship program is not currently accepting applications');
    }

    // Check application period
    const today = new Date().toISOString().split('T')[0]!;
    if (today < program.applicationStartDate || today > program.applicationEndDate) {
      throw new BusinessRuleError('Application period is not currently active');
    }

    // Check available slots
    if (program.usedSlots >= program.totalSlots) {
      throw new BusinessRuleError('No available slots remaining for this scholarship program');
    }

    // Check for duplicate application
    const existingApp = await this.repository.findApplicationByApplicantAndProgram(
      input.applicantId,
      input.programId,
      tenantId,
    );
    if (existingApp) {
      throw new ConflictError('Applicant has already submitted an application for this program');
    }

    if (!input.asDraft) {
      this.assertRequiredDocuments(
        program,
        input.documents.map((d) => d.documentType),
      );
    }

    assertCentRepresentableMoney(input.financialInfo);

    // Create application
    const application: Omit<ScholarshipApplicationEntity, 'createdAt' | 'updatedAt'> = {
      id: uuidv4(),
      tenantId,
      programId: input.programId,
      applicantId: input.applicantId,
      institutionId: input.institutionId,
      status: input.asDraft ? 'draft' : 'submitted',
      academicRecords: input.academicRecords,
      financialInfo: input.financialInfo,
      documents: input.documents,
      personalStatement: input.personalStatement ?? null,
      areaId: input.areaId ?? null,
      gender: input.gender ?? null,
      workflowInstanceId: null,
      submittedAt: new Date(),
      reviewedAt: null,
      reviewerId: null,
      reviewNotes: null,
    };

    const created = await this.repository.createApplication(application);

    // Drafts stay out of the approval workflow until POST …/applications/:id/submit.
    if (!input.asDraft && this.workflowEngine) {
      try {
        const workflowInstanceId = await this.workflowEngine.createInstance(
          tenantId,
          this.defaultWorkflowId,
          'scholarship_application',
          created.id,
        );
        await this.repository.updateApplication(created.id, tenantId, {
          workflowInstanceId,
          status: 'under_review',
        });
        created.workflowInstanceId = workflowInstanceId;
        created.status = 'under_review';
      } catch {
        // If workflow creation fails, application remains in 'submitted' status
        // It can be manually routed later
      }
    }

    return created;
  }

  /**
   * Move a draft to submitted once every scheme-required document is on file.
   * Uploaded file types (not rejected, not deleted) count. Legacy JSON
   * `documents` entries still count so older clients keep working.
   */
  async finalizeDraft(
    tenantId: string,
    id: string,
    uploadedTypes: string[],
    uploadedDocuments: CreateApplicationInput['documents'] = [],
  ): Promise<ScholarshipApplicationEntity> {
    const application = await this.repository.findApplicationById(id, tenantId);
    if (!application) {
      throw new NotFoundError(`Scholarship application with id '${id}' not found`);
    }
    if (application.status !== 'draft') {
      throw new BusinessRuleError(
        `Cannot submit application in '${application.status}' status. Save a draft, upload the required documents, then submit.`,
      );
    }
    const program = await this.repository.findProgramById(application.programId, tenantId);
    if (!program) {
      throw new NotFoundError(`Scholarship program with id '${application.programId}' not found`);
    }
    if (program.status !== 'open') {
      throw new BusinessRuleError('Scholarship program is not currently accepting applications');
    }
    const today = new Date().toISOString().split('T')[0]!;
    if (today < program.applicationStartDate || today > program.applicationEndDate) {
      throw new BusinessRuleError('Application period is not currently active');
    }
    if (program.usedSlots >= program.totalSlots) {
      throw new BusinessRuleError('No available slots remaining for this scholarship program');
    }

    const knownTypes = [...application.documents.map((doc) => doc.documentType), ...uploadedTypes];
    this.assertRequiredDocuments(program, knownTypes);

    const mergedDocuments = [...application.documents];
    for (const doc of uploadedDocuments) {
      if (
        !mergedDocuments.some(
          (existing) =>
            existing.fileName === doc.fileName && existing.documentType === doc.documentType,
        )
      ) {
        mergedDocuments.push(doc);
      }
    }

    const updated = await this.repository.updateApplication(id, tenantId, {
      status: 'submitted',
      documents: mergedDocuments,
      submittedAt: new Date(),
    });
    if (!updated) {
      throw new NotFoundError(`Scholarship application with id '${id}' not found`);
    }

    if (this.workflowEngine) {
      try {
        const workflowInstanceId = await this.workflowEngine.createInstance(
          tenantId,
          this.defaultWorkflowId,
          'scholarship_application',
          updated.id,
        );
        await this.repository.updateApplication(updated.id, tenantId, {
          workflowInstanceId,
          status: 'under_review',
        });
        updated.workflowInstanceId = workflowInstanceId;
        updated.status = 'under_review';
      } catch {
        // Application remains submitted when workflow routing is unavailable.
      }
    }
    return updated;
  }

  private assertRequiredDocuments(
    program: { eligibility: { requiredDocuments?: string[] } },
    submittedTypes: string[],
  ): void {
    const required = program.eligibility.requiredDocuments ?? [];
    if (required.length === 0) return;
    const submitted = new Set(submittedTypes);
    const missingDocs = required.filter((docType) => !submitted.has(docType));
    if (missingDocs.length === 0) return;
    const errors: FieldError[] = missingDocs.map((docType) => ({
      field: 'documents',
      rule: 'required',
      message: `Required document '${docType}' is missing. Upload it before submitting.`,
    }));
    throw new ValidationError(
      `Missing required documents: ${missingDocs.join(', ')}. Upload each file before submitting.`,
      errors,
    );
  }

  /**
   * Get an application by ID.
   *
   * @throws NotFoundError if application not found
   */
  async getApplicationById(tenantId: string, id: string): Promise<ScholarshipApplicationEntity> {
    const application = await this.repository.findApplicationById(id, tenantId);
    if (!application) {
      throw new NotFoundError(`Scholarship application with id '${id}' not found`);
    }
    return application;
  }

  /**
   * List applications with pagination and filtering.
   */
  async listApplications(
    tenantId: string,
    filter: ApplicationFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<ScholarshipApplicationEntity>> {
    return this.repository.listApplications(tenantId, filter, pagination);
  }

  /**
   * Approve an application.
   *
   * With `scheduleFirstDisbursement` the first instalment (program amount per
   * recipient, due today) is queued in the same call so the approval → payout
   * chain is one decision rather than two screens (G-911).
   *
   * @throws NotFoundError if application not found
   * @throws BusinessRuleError if application is not in a reviewable state
   * @throws BusinessRuleError if no slots available
   */
  async approveApplication(
    tenantId: string,
    id: string,
    decision: ApplicationDecision = {},
  ): Promise<ScholarshipApplicationEntity> {
    const application = await this.repository.findApplicationById(id, tenantId);
    if (!application) {
      throw new NotFoundError(`Scholarship application with id '${id}' not found`);
    }

    if (application.status !== 'submitted' && application.status !== 'under_review') {
      throw new BusinessRuleError(
        `Cannot approve application in '${application.status}' status. Must be 'submitted' or 'under_review'.`,
      );
    }

    // PRC-H083: status guard, slot claim, status flip and first instalment are
    // one atomic repository unit — the reads above are only for friendly errors.
    const outcome = await this.repository.approveApplicationAtomic(id, tenantId, {
      reviewedAt: new Date(),
      reviewerId: decision.reviewerId ?? null,
      reviewNotes: normaliseNotes(decision.notes),
      firstDisbursement: decision.scheduleFirstDisbursement
        ? {
            id: uuidv4(),
            scheduledDate: new Date().toISOString().slice(0, 10),
            notes: 'Scheduled on approval',
          }
        : null,
    });

    switch (outcome.kind) {
      case 'approved':
        if (outcome.disbursement) {
          assertMajorMatchesCents(outcome.disbursement.amount, outcome.disbursement.amountCents);
        }
        return outcome.application;
      case 'application_not_found':
        throw new NotFoundError(`Scholarship application with id '${id}' not found`);
      case 'program_not_found':
        throw new NotFoundError(`Scholarship program with id '${application.programId}' not found`);
      case 'invalid_status':
        // Status was reviewable when read, so another decision won the race.
        throw new ConflictError(
          `Application was already decided (now '${outcome.status}'); refresh and retry.`,
        );
      case 'no_slots':
        throw new BusinessRuleError('No available slots remaining for this scholarship program');
    }
  }

  /**
   * Reject an application.
   *
   * @throws NotFoundError if application not found
   * @throws BusinessRuleError if application is not in a reviewable state
   */
  async rejectApplication(
    tenantId: string,
    id: string,
    decision: ApplicationDecision = {},
  ): Promise<ScholarshipApplicationEntity> {
    const application = await this.repository.findApplicationById(id, tenantId);
    if (!application) {
      throw new NotFoundError(`Scholarship application with id '${id}' not found`);
    }

    if (application.status !== 'submitted' && application.status !== 'under_review') {
      throw new BusinessRuleError(
        `Cannot reject application in '${application.status}' status. Must be 'submitted' or 'under_review'.`,
      );
    }

    const updated = await this.repository.updateApplication(id, tenantId, {
      status: 'rejected' as ApplicationStatus,
      reviewedAt: new Date(),
      reviewerId: decision.reviewerId ?? null,
      reviewNotes: normaliseNotes(decision.notes),
    });

    return updated!;
  }

  // ─── Disbursement Operations ─────────────────────────────────────────────

  /**
   * Create a disbursement record for an approved application.
   * Requirement 11.4: Track disbursement schedules, payment status, and recipient compliance.
   *
   * @throws NotFoundError if application not found
   * @throws BusinessRuleError if application is not approved
   */
  async createDisbursement(
    tenantId: string,
    input: CreateDisbursementInput,
  ): Promise<DisbursementEntity> {
    const application = await this.repository.findApplicationById(input.applicationId, tenantId);
    if (!application) {
      throw new NotFoundError(`Scholarship application with id '${input.applicationId}' not found`);
    }

    if (application.status !== 'approved') {
      throw new BusinessRuleError('Disbursements can only be created for approved applications');
    }

    const money = resolveMoneyPair(input.amount, input.amountCents, 'amount');

    // PRC-H085: total non-cancelled disbursements may not exceed the award
    // (amount per recipient × instalments allowed by the programme frequency).
    const program = await this.repository.findProgramById(application.programId, tenantId);
    if (!program) {
      throw new NotFoundError(`Scholarship program with id '${application.programId}' not found`);
    }
    const instalments = INSTALMENTS_PER_FREQUENCY[program.disbursementFrequency] ?? 1;
    const awardCapCents = program.amountPerRecipientCents * instalments;
    const existing = await this.repository.listDisbursementsByApplication(
      input.applicationId,
      tenantId,
    );
    const committedCents = existing
      .filter((d) => d.paymentStatus !== 'cancelled')
      .reduce((sum, d) => sum + d.amountCents, 0);
    if (committedCents + money.amountCents > awardCapCents) {
      throw new BusinessRuleError(
        `Disbursement would exceed the scholarship award: ${committedCents + money.amountCents} cents > cap ${awardCapCents} cents`,
      );
    }

    const disbursement: Omit<DisbursementEntity, 'createdAt' | 'updatedAt'> = {
      id: uuidv4(),
      tenantId,
      applicationId: input.applicationId,
      amount: money.amount,
      amountCents: money.amountCents,
      scheduledDate: input.scheduledDate,
      paidDate: null,
      paymentStatus: 'scheduled',
      paymentMethod: (input.paymentMethod as DisbursementEntity['paymentMethod']) ?? null,
      transactionReference: null,
      notes: input.notes ?? null,
    };

    return this.repository.createDisbursement(disbursement);
  }

  /**
   * Update disbursement payment status.
   *
   * @throws NotFoundError if disbursement not found
   */
  async updateDisbursement(
    tenantId: string,
    id: string,
    input: UpdateDisbursementInput,
  ): Promise<DisbursementEntity> {
    const existing = await this.repository.findDisbursementById(id, tenantId);
    if (!existing) {
      throw new NotFoundError(`Disbursement with id '${id}' not found`);
    }

    // PRC-H085: enforce the payment-status state machine.
    const nextStatus = input.paymentStatus as PaymentStatus;
    const allowed = DISBURSEMENT_TRANSITIONS[existing.paymentStatus] ?? [];
    if (!allowed.includes(nextStatus)) {
      throw new ConflictError(
        `Cannot change disbursement status from '${existing.paymentStatus}' to '${nextStatus}'`,
      );
    }
    if (nextStatus === 'paid') {
      const missing: FieldError[] = [];
      if (!input.paidDate) {
        missing.push({ field: 'paidDate', rule: 'required', message: 'Required when paid' });
      }
      if (!input.transactionReference?.trim()) {
        missing.push({
          field: 'transactionReference',
          rule: 'required',
          message: 'Required when paid',
        });
      }
      if (missing.length > 0) {
        throw new ValidationError(
          'paidDate and transactionReference are required to mark a disbursement paid',
          missing,
        );
      }
    }

    const updateData: Partial<DisbursementEntity> = {
      paymentStatus: nextStatus,
    };
    if (input.paidDate !== undefined) updateData.paidDate = input.paidDate;
    if (input.transactionReference !== undefined)
      updateData.transactionReference = input.transactionReference;
    if (input.notes !== undefined) updateData.notes = input.notes;

    const updated = await this.repository.updateDisbursement(id, tenantId, updateData);
    if (!updated) {
      throw new NotFoundError(`Disbursement with id '${id}' not found`);
    }

    assertMajorMatchesCents(updated.amount, updated.amountCents);

    // PRC-H084: fee netting / un-netting hooks run after the status write. If a
    // hook fails, restore the previous status so the caller sees an error and a
    // retry re-fires the (disbursementId-idempotent) hook instead of skipping it.
    try {
      if (
        this.onDisbursementPaid &&
        updated.paymentStatus === 'paid' &&
        existing.paymentStatus !== 'paid'
      ) {
        const application = await this.repository.findApplicationById(
          updated.applicationId,
          tenantId,
        );
        const program = application
          ? await this.repository.findProgramById(application.programId, tenantId)
          : null;
        if (application) {
          await this.onDisbursementPaid({
            tenantId,
            disbursementId: updated.id,
            applicationId: application.id,
            applicantId: application.applicantId,
            amount: updated.amount,
            amountCents: updated.amountCents,
            currency: program?.currency ?? 'INR',
          });
        }
      }

      if (
        this.onDisbursementReversed &&
        existing.paymentStatus === 'paid' &&
        updated.paymentStatus !== 'paid'
      ) {
        const application = await this.repository.findApplicationById(
          updated.applicationId,
          tenantId,
        );
        const program = application
          ? await this.repository.findProgramById(application.programId, tenantId)
          : null;
        if (application) {
          await this.onDisbursementReversed({
            tenantId,
            disbursementId: updated.id,
            applicationId: application.id,
            applicantId: application.applicantId,
            amountCents: updated.amountCents,
            currency: program?.currency ?? 'INR',
          });
        }
      }
    } catch (hookError: unknown) {
      try {
        await this.repository.updateDisbursement(id, tenantId, {
          paymentStatus: existing.paymentStatus,
          paidDate: existing.paidDate,
          transactionReference: existing.transactionReference,
          notes: existing.notes,
        });
      } catch (compensationError: unknown) {
        throw new AppError(
          `Fee ledger sync failed and disbursement '${id}' could not be restored to '${existing.paymentStatus}': ${errorMessage(compensationError)} (hook: ${errorMessage(hookError)})`,
          ErrorCode.INTERNAL_ERROR,
          500,
        );
      }
      throw new AppError(
        `Fee ledger sync failed; disbursement status left at '${existing.paymentStatus}'. Retry the update. (${errorMessage(hookError)})`,
        ErrorCode.SERVICE_UNAVAILABLE,
        503,
      );
    }

    return updated;
  }

  /**
   * List disbursements for an application.
   */
  async listDisbursementsByApplication(
    tenantId: string,
    applicationId: string,
  ): Promise<DisbursementEntity[]> {
    return this.repository.listDisbursementsByApplication(applicationId, tenantId);
  }

  /**
   * List disbursements with pagination and filtering.
   */
  async listDisbursements(
    tenantId: string,
    filter: DisbursementFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<DisbursementEntity>> {
    return this.repository.listDisbursements(tenantId, filter, pagination);
  }

  // ─── Compliance Operations ───────────────────────────────────────────────

  /**
   * Record recipient compliance status.
   * Requirement 11.4: Track recipient compliance.
   *
   * @throws NotFoundError if application not found
   * @throws BusinessRuleError if application is not approved
   */
  async recordCompliance(
    tenantId: string,
    input: RecipientComplianceInput,
    /** Authenticated evaluator (JWT sub). Body evaluatorId is ignored (PRC-L345). */
    evaluatorId: string | null = null,
  ): Promise<ComplianceRecordEntity> {
    const application = await this.repository.findApplicationById(input.applicationId, tenantId);
    if (!application) {
      throw new NotFoundError(`Scholarship application with id '${input.applicationId}' not found`);
    }

    if (application.status !== 'approved') {
      throw new BusinessRuleError('Compliance can only be recorded for approved applications');
    }

    const record: Omit<ComplianceRecordEntity, 'createdAt' | 'updatedAt'> = {
      id: uuidv4(),
      tenantId,
      applicationId: input.applicationId,
      complianceType: input.complianceType as ComplianceRecordEntity['complianceType'],
      status: input.status as ComplianceRecordEntity['status'],
      evaluationDate: input.evaluationDate,
      details: input.details ?? null,
      evaluatorId: evaluatorId && EVALUATOR_UUID.test(evaluatorId) ? evaluatorId : null,
    };

    return this.repository.createComplianceRecord(record);
  }

  /**
   * Get compliance records for an application.
   */
  async getComplianceRecords(
    tenantId: string,
    applicationId: string,
  ): Promise<ComplianceRecordEntity[]> {
    return this.repository.listComplianceRecords(applicationId, tenantId);
  }

  // ─── Report Operations ───────────────────────────────────────────────────

  /**
   * Generate utilization report.
   * Requirement 11.5: Generate reports on scholarship utilization by program, area, gender, and institution.
   */
  async getUtilizationReport(
    tenantId: string,
    query: UtilizationReportQuery,
  ): Promise<UtilizationReportData> {
    const filter: UtilizationReportFilter = {
      programId: query.programId,
      areaId: query.areaId,
      gender: query.gender,
      institutionId: query.institutionId,
      startDate: query.startDate,
      endDate: query.endDate,
      groupBy: query.groupBy as UtilizationReportFilter['groupBy'],
    };

    return this.repository.getUtilizationReport(tenantId, filter);
  }
}
