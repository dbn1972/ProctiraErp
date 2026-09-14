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
  ConflictError,
  NotFoundError,
  BusinessRuleError,
  ValidationError,
  majorUnitsToCents,
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
} from './scholarship-repository.js';

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

    const program: Omit<ScholarshipProgramEntity, 'createdAt' | 'updatedAt'> = {
      id: uuidv4(),
      tenantId,
      name: input.name,
      description: input.description ?? null,
      applicationStartDate: input.applicationStartDate,
      applicationEndDate: input.applicationEndDate,
      totalSlots: input.totalSlots,
      usedSlots: 0,
      amountPerRecipient: input.amountPerRecipient,
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
    if (input.amountPerRecipient !== undefined)
      updateData.amountPerRecipient = input.amountPerRecipient;
    if (input.currency !== undefined) updateData.currency = input.currency;
    if (input.disbursementFrequency !== undefined)
      updateData.disbursementFrequency =
        input.disbursementFrequency as ScholarshipProgramEntity['disbursementFrequency'];
    if (input.eligibility !== undefined) updateData.eligibility = input.eligibility;
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

    // Validate required documents
    if (program.eligibility.requiredDocuments && program.eligibility.requiredDocuments.length > 0) {
      const submittedDocTypes = new Set(input.documents.map((d) => d.documentType));
      const missingDocs = program.eligibility.requiredDocuments.filter(
        (docType) => !submittedDocTypes.has(docType),
      );
      if (missingDocs.length > 0) {
        const errors: FieldError[] = missingDocs.map((docType) => ({
          field: 'documents',
          rule: 'required',
          message: `Required document '${docType}' is missing`,
        }));
        throw new ValidationError('Missing required documents', errors);
      }
    }

    // Create application
    const application: Omit<ScholarshipApplicationEntity, 'createdAt' | 'updatedAt'> = {
      id: uuidv4(),
      tenantId,
      programId: input.programId,
      applicantId: input.applicantId,
      institutionId: input.institutionId,
      status: 'submitted',
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

    // Integrate with Workflow Engine for approval routing (Requirement 11.3)
    if (this.workflowEngine) {
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

    // Check slots
    const program = await this.repository.findProgramById(application.programId, tenantId);
    if (!program) {
      throw new NotFoundError(`Scholarship program with id '${application.programId}' not found`);
    }

    if (program.usedSlots >= program.totalSlots) {
      throw new BusinessRuleError('No available slots remaining for this scholarship program');
    }

    // Update application status
    const updated = await this.repository.updateApplication(id, tenantId, {
      status: 'approved' as ApplicationStatus,
      reviewedAt: new Date(),
      reviewerId: decision.reviewerId ?? null,
      reviewNotes: normaliseNotes(decision.notes),
    });

    // Increment used slots
    await this.repository.updateProgram(application.programId, tenantId, {
      usedSlots: program.usedSlots + 1,
    });

    if (decision.scheduleFirstDisbursement) {
      const amountCents = majorUnitsToCents(program.amountPerRecipient);
      assertMajorMatchesCents(program.amountPerRecipient, amountCents);
      await this.repository.createDisbursement({
        id: uuidv4(),
        tenantId,
        applicationId: id,
        amount: program.amountPerRecipient,
        amountCents,
        scheduledDate: new Date().toISOString().slice(0, 10),
        paidDate: null,
        paymentStatus: 'scheduled',
        paymentMethod: null,
        transactionReference: null,
        notes: 'Scheduled on approval',
      });
    }

    return updated!;
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

    const amountCents = majorUnitsToCents(input.amount);
    assertMajorMatchesCents(input.amount, amountCents);
    const disbursement: Omit<DisbursementEntity, 'createdAt' | 'updatedAt'> = {
      id: uuidv4(),
      tenantId,
      applicationId: input.applicationId,
      amount: input.amount,
      amountCents,
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

    const updateData: Partial<DisbursementEntity> = {
      paymentStatus: input.paymentStatus as DisbursementEntity['paymentStatus'],
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
      evaluatorId: input.evaluatorId ?? null,
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
