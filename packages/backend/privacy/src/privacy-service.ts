/**
 * Privacy lifecycle service (W1-SEC-06 complete slice).
 *
 * - Legal hold fail-closed for erase/anonymize/offboard
 * - Correction path with audit
 * - Durable anonymization + tenant offboard job orchestration
 * - Residuals → job status `failed` (never claim `completed` wipe)
 * - Every id op is tenant-bound (IDOR fail-closed)
 */
import {
  AppError,
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@proctira/common';
import { createLogger } from '@proctira/logging';
import { v4 as uuidv4 } from 'uuid';

import type { PrivacyAuditPort } from './privacy-audit.js';
import { NoopPrivacyAuditPort } from './privacy-audit.js';
import type {
  AnonymizationJobEntity,
  CorrectionRequestEntity,
  ErasureRequestEntity,
  LegalHoldEntity,
  OffboardChecklistItem,
  ListPage,
  PrivacyRepository,
  TenantOffboardJobEntity,
} from './privacy-repository.js';
import type {
  PrivacyAnonymizationPublisher,
  PrivacyOffboardPublisher,
} from './queue-privacy-publisher.js';
import type {
  CorrectionStatus,
  CreateCorrectionRequestInput,
  CreateErasureRequestInput,
  ErasureStatus,
  PlaceLegalHoldInput,
  RequestTenantOffboardInput,
} from './schemas.js';
import {
  RecordingSubjectAnonymizer,
  ResidualTenantWipeExecutor,
  type SubjectAnonymizer,
  type TenantWipeExecutor,
} from './subject-anonymizer.js';

const logger = createLogger({ name: 'privacy-service' });

const ERASURE_TRANSITIONS: Record<ErasureStatus, readonly ErasureStatus[]> = {
  requested: ['under_review', 'rejected', 'cancelled'],
  under_review: ['approved', 'rejected', 'cancelled'],
  approved: ['in_progress', 'blocked_legal_hold', 'cancelled'],
  in_progress: ['completed', 'blocked_legal_hold'],
  blocked_legal_hold: ['approved', 'cancelled'],
  completed: [],
  rejected: [],
  cancelled: [],
};

/**
 * Statuses a caller may request via the manual /transition endpoint (PRC-H076).
 * `in_progress`, `completed` and `blocked_legal_hold` are written only by
 * executeErasure / processAnonymizationJob, so an erasure can never be marked
 * completed without an anonymization job that finished with zero residual.
 */
const MANUAL_ERASURE_TARGETS: readonly ErasureStatus[] = [
  'under_review',
  'approved',
  'rejected',
  'cancelled',
];

const CORRECTION_TRANSITIONS: Record<CorrectionStatus, readonly CorrectionStatus[]> = {
  requested: ['under_review', 'rejected', 'cancelled'],
  under_review: ['approved', 'rejected', 'cancelled'],
  approved: ['applied', 'cancelled'],
  applied: [],
  rejected: [],
  cancelled: [],
};

/**
 * Raised when a destructive privacy operation is requested but no real domain
 * executor is configured (PRC-H077). Surfaced as HTTP 501 so callers see
 * "not implemented" instead of a 201 job that can only end failed/stuck.
 */
export class PrivacyExecutorNotConfiguredError extends AppError {
  constructor(message: string) {
    super(message, 'NOT_IMPLEMENTED', 501);
  }
}

export interface DestructiveDeleteGuard {
  assertDestructiveDeleteAllowed(tenantId: string, subjectId?: string): Promise<void>;
}

export interface PrivacyServiceOptions {
  audit?: PrivacyAuditPort;
  anonymizer?: SubjectAnonymizer;
  tenantWipeExecutor?: TenantWipeExecutor;
  anonymizationPublisher?: PrivacyAnonymizationPublisher;
  offboardPublisher?: PrivacyOffboardPublisher;
}

export class PrivacyService implements DestructiveDeleteGuard {
  private readonly audit: PrivacyAuditPort;
  private readonly anonymizer: SubjectAnonymizer;
  private readonly tenantWipeExecutor: TenantWipeExecutor;
  private readonly anonymizationPublisher?: PrivacyAnonymizationPublisher;
  private readonly offboardPublisher?: PrivacyOffboardPublisher;
  /** False when only the residual-recording default anonymizer is present. */
  readonly erasureExecutionAvailable: boolean;
  /** False when only the residual checklist wipe executor is present. */
  readonly tenantWipeAvailable: boolean;

  constructor(
    private readonly repository: PrivacyRepository,
    options: PrivacyServiceOptions = {},
  ) {
    this.audit = options.audit ?? new NoopPrivacyAuditPort();
    this.anonymizer = options.anonymizer ?? new RecordingSubjectAnonymizer();
    this.tenantWipeExecutor = options.tenantWipeExecutor ?? new ResidualTenantWipeExecutor();
    this.erasureExecutionAvailable = options.anonymizer !== undefined;
    this.tenantWipeAvailable = options.tenantWipeExecutor !== undefined;
    this.anonymizationPublisher = options.anonymizationPublisher;
    this.offboardPublisher = options.offboardPublisher;
  }

  async placeLegalHold(input: PlaceLegalHoldInput): Promise<LegalHoldEntity> {
    if (input.scope === 'subject') {
      if (!input.subjectType?.trim() || !input.subjectId?.trim()) {
        throw new ValidationError('subjectType and subjectId are required for subject-scope holds');
      }
    } else if (input.subjectType || input.subjectId) {
      throw new ValidationError('tenant-scope holds must not include subjectType/subjectId');
    }
    const hold = await this.repository.createLegalHold({
      id: uuidv4(),
      tenantId: input.tenantId,
      scope: input.scope,
      subjectType: input.scope === 'subject' ? input.subjectType! : null,
      subjectId: input.scope === 'subject' ? input.subjectId! : null,
      reason: input.reason,
      placedBy: input.placedBy,
      placedAt: new Date(),
      releasedBy: null,
      releasedAt: null,
      active: true,
    });
    await this.audit.record({
      tenantId: hold.tenantId,
      entityType: 'privacy_legal_hold',
      entityId: hold.id,
      operation: 'CREATE',
      userId: input.placedBy,
      userName: input.placedBy,
      ipAddress: '0.0.0.0',
      beforeValues: null,
      afterValues: {
        scope: hold.scope,
        subjectType: hold.subjectType,
        subjectId: hold.subjectId,
        reason: hold.reason,
        active: true,
      },
    });
    logger.info(
      { holdId: hold.id, tenantId: hold.tenantId, scope: hold.scope },
      'Legal hold placed',
    );
    return hold;
  }

  async releaseLegalHold(
    holdId: string,
    tenantId: string,
    releasedBy: string,
  ): Promise<LegalHoldEntity> {
    const existing = await this.repository.findLegalHoldById(holdId, tenantId);
    if (!existing) throw new NotFoundError(`Legal hold '${holdId}' not found`);
    if (!existing.active) throw new BusinessRuleError('Legal hold is already released');
    const updated = await this.repository.updateLegalHold(holdId, tenantId, {
      active: false,
      releasedBy,
      releasedAt: new Date(),
    });
    await this.audit.record({
      tenantId: existing.tenantId,
      entityType: 'privacy_legal_hold',
      entityId: holdId,
      operation: 'UPDATE',
      userId: releasedBy,
      userName: releasedBy,
      ipAddress: '0.0.0.0',
      beforeValues: { active: true },
      afterValues: { active: false, releasedBy },
    });
    logger.info({ holdId, tenantId: existing.tenantId }, 'Legal hold released');
    return updated!;
  }

  async listActiveLegalHolds(tenantId: string, page?: ListPage): Promise<LegalHoldEntity[]> {
    return this.repository.listActiveLegalHolds(tenantId, page);
  }

  async isOnLegalHold(
    tenantId: string,
    subjectType?: string,
    subjectId?: string,
  ): Promise<boolean> {
    // PRC-L138: single indexed query instead of listing every active hold.
    const hold = await this.repository.findActiveHold(
      tenantId,
      subjectType && subjectId ? { subjectType, subjectId } : undefined,
    );
    return hold !== null;
  }

  async assertDestructiveDeleteAllowed(tenantId: string, subjectId?: string): Promise<void> {
    // PRC-L138: one indexed query per gate call.
    const hold = await this.repository.findActiveHold(
      tenantId,
      subjectId ? { subjectId } : undefined,
    );
    if (!hold) return;
    if (hold.scope === 'tenant') {
      throw new BusinessRuleError(
        `Destructive delete blocked: tenant '${tenantId}' is under legal hold (${hold.id})`,
      );
    }
    throw new BusinessRuleError(
      `Destructive delete blocked: subject '${subjectId ?? 'unknown'}' is under legal hold (${hold.id})`,
    );
  }

  async createErasureRequest(input: CreateErasureRequestInput): Promise<ErasureRequestEntity> {
    return this.repository.createErasureRequest({
      id: uuidv4(),
      tenantId: input.tenantId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      status: 'requested',
      requestType: input.requestType ?? 'erasure',
      reason: input.reason ?? null,
      requestedBy: input.requestedBy,
      reviewedBy: null,
      statusReason: null,
      completedAt: null,
    });
  }

  async transitionErasureRequest(
    requestId: string,
    tenantId: string,
    toStatus: ErasureStatus,
    actorId: string,
    statusReason?: string,
  ): Promise<ErasureRequestEntity> {
    const existing = await this.repository.findErasureRequestById(requestId, tenantId);
    if (!existing) throw new NotFoundError(`Erasure request '${requestId}' not found`);
    if (!MANUAL_ERASURE_TARGETS.includes(toStatus)) {
      throw new BusinessRuleError(
        `Erasure status '${toStatus}' is set only by erasure execution, not by manual transition`,
      );
    }
    if (!ERASURE_TRANSITIONS[existing.status].includes(toStatus)) {
      throw new BusinessRuleError(`Invalid erasure transition: ${existing.status} → ${toStatus}`);
    }
    const updated = await this.repository.updateErasureRequest(
      requestId,
      tenantId,
      {
        status: toStatus,
        reviewedBy: actorId,
        statusReason: statusReason ?? null,
      },
      { expectedStatus: existing.status },
    );
    if (!updated) {
      throw new ConflictError(
        `Erasure request '${requestId}' changed concurrently; reload and retry`,
      );
    }
    return updated;
  }

  /**
   * Approve → start execution. Fail-closed under legal hold.
   * When a durable publisher is wired, enqueues a job and leaves erasure
   * `in_progress` until the worker completes. Otherwise processes inline.
   */
  async executeErasure(
    requestId: string,
    tenantId: string,
    actorId: string,
  ): Promise<ErasureRequestEntity> {
    const existing = await this.repository.findErasureRequestById(requestId, tenantId);
    if (!existing) throw new NotFoundError(`Erasure request '${requestId}' not found`);
    if (existing.status !== 'approved') {
      throw new BusinessRuleError(
        `Erasure execute requires approved status; current=${existing.status}`,
      );
    }
    if (!this.erasureExecutionAvailable) {
      // PRC-H077: without injected domain anonymizers the default records a
      // residual and the job can only fail. Refuse up front and leave the
      // request `approved` rather than creating a job that can never complete.
      throw new PrivacyExecutorNotConfiguredError(
        'Erasure execution is not available: no domain anonymizer is configured',
      );
    }
    if (await this.isOnLegalHold(existing.tenantId, existing.subjectType, existing.subjectId)) {
      await this.repository.updateErasureRequest(requestId, tenantId, {
        status: 'blocked_legal_hold',
        reviewedBy: actorId,
        statusReason: 'Active legal hold blocks erasure/anonymization (fail-closed)',
      });
      throw new BusinessRuleError(
        `Erasure blocked: subject under legal hold (request ${requestId})`,
      );
    }

    const started = await this.repository.updateErasureRequest(
      requestId,
      tenantId,
      {
        status: 'in_progress',
        reviewedBy: actorId,
        statusReason: 'Erasure execution started',
      },
      { expectedStatus: 'approved' },
    );
    if (!started) {
      throw new ConflictError(`Erasure request '${requestId}' is already being executed`);
    }

    const job = await this.repository.createAnonymizationJob({
      id: uuidv4(),
      tenantId: existing.tenantId,
      erasureRequestId: requestId,
      subjectType: existing.subjectType,
      subjectId: existing.subjectId,
      requestType: existing.requestType,
      status: 'queued',
      actorId,
      statusReason: 'Queued for durable anonymization worker',
      fieldsTouched: [],
      residualNote: null,
      startedAt: null,
      completedAt: null,
    });

    if (this.anonymizationPublisher) {
      await this.anonymizationPublisher.enqueueAnonymization({
        jobId: job.id,
        tenantId: existing.tenantId,
        erasureRequestId: requestId,
      });
      logger.info(
        { requestId, jobId: job.id, tenantId: existing.tenantId },
        'Erasure anonymization job enqueued',
      );
      return (await this.repository.findErasureRequestById(requestId, tenantId))!;
    }

    // No durable publisher — process inline (same worker code path).
    await this.processAnonymizationJob(job.id, existing.tenantId);
    return (await this.repository.findErasureRequestById(requestId, tenantId))!;
  }

  async processAnonymizationJob(jobId: string, tenantId: string): Promise<AnonymizationJobEntity> {
    const job = await this.repository.findAnonymizationJobById(jobId, tenantId);
    if (!job) throw new NotFoundError(`Anonymization job '${jobId}' not found`);
    if (job.status === 'completed' || job.status === 'failed') return job;

    if (await this.isOnLegalHold(job.tenantId, job.subjectType, job.subjectId)) {
      await this.repository.updateAnonymizationJob(jobId, tenantId, {
        status: 'blocked_legal_hold',
        statusReason: 'Active legal hold blocks anonymization (fail-closed)',
        completedAt: new Date(),
      });
      await this.repository.updateErasureRequest(job.erasureRequestId, tenantId, {
        status: 'blocked_legal_hold',
        statusReason: 'Active legal hold blocks erasure/anonymization (fail-closed)',
      });
      throw new BusinessRuleError(`Anonymization blocked: subject under legal hold (job ${jobId})`);
    }

    await this.repository.updateAnonymizationJob(jobId, tenantId, {
      status: 'in_progress',
      startedAt: new Date(),
      statusReason: 'Anonymization worker started',
    });

    try {
      const result = await this.anonymizer.anonymize({
        tenantId: job.tenantId,
        subjectType: job.subjectType,
        subjectId: job.subjectId,
        requestType: job.requestType,
        jobId: job.id,
      });

      const residualNote = result.residualNote?.trim() ? result.residualNote : null;
      const hasResidual = residualNote != null;
      // Fail closed: residuals must never be marked completed.
      const jobStatus = hasResidual ? 'failed' : 'completed';

      const updated = await this.repository.updateAnonymizationJob(jobId, tenantId, {
        status: jobStatus,
        fieldsTouched: result.fieldsTouched,
        residualNote,
        statusReason: hasResidual
          ? 'Anonymization left residuals (fail-closed; not marked completed)'
          : 'Anonymization worker completed',
        completedAt: new Date(),
      });

      if (hasResidual) {
        await this.repository.updateErasureRequest(job.erasureRequestId, tenantId, {
          statusReason: residualNote,
          // Keep erasure in_progress — do not claim completed wipe.
        });
      } else {
        await this.repository.updateErasureRequest(job.erasureRequestId, tenantId, {
          status: 'completed',
          statusReason: 'Anonymization completed via durable worker',
          completedAt: new Date(),
        });
      }

      await this.audit.record({
        tenantId: job.tenantId,
        entityType: 'privacy_erasure',
        entityId: job.erasureRequestId,
        operation: 'UPDATE',
        userId: job.actorId,
        userName: job.actorId,
        ipAddress: '0.0.0.0',
        beforeValues: { status: 'in_progress' },
        afterValues: {
          status: jobStatus,
          jobId,
          fieldsTouched: result.fieldsTouched,
          residualNote,
        },
        metadata: { requestType: job.requestType, subjectType: job.subjectType },
      });

      logger.info(
        { jobId, requestId: job.erasureRequestId, tenantId: job.tenantId, jobStatus },
        hasResidual ? 'Anonymization job failed closed on residual' : 'Anonymization job completed',
      );
      return updated!;
    } catch (error) {
      if (error instanceof BusinessRuleError) throw error;
      await this.repository.updateAnonymizationJob(jobId, tenantId, {
        status: 'failed',
        statusReason: error instanceof Error ? error.message : 'Anonymization failed',
        completedAt: new Date(),
      });
      throw error;
    }
  }

  // ─── Correction (rectification) ──────────────────────────────────────────

  async createCorrectionRequest(
    input: CreateCorrectionRequestInput,
  ): Promise<CorrectionRequestEntity> {
    const row = await this.repository.createCorrectionRequest({
      id: uuidv4(),
      tenantId: input.tenantId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      fieldPath: input.fieldPath,
      currentValue: input.currentValue ?? null,
      requestedValue: input.requestedValue,
      reason: input.reason ?? null,
      status: 'requested',
      requestedBy: input.requestedBy,
      reviewedBy: null,
      statusReason: null,
      appliedAt: null,
    });
    await this.audit.record({
      tenantId: row.tenantId,
      entityType: 'privacy_correction',
      entityId: row.id,
      operation: 'CREATE',
      userId: input.requestedBy,
      userName: input.requestedBy,
      ipAddress: '0.0.0.0',
      beforeValues: null,
      afterValues: {
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        fieldPath: row.fieldPath,
        requestedValue: row.requestedValue,
        status: row.status,
      },
    });
    return row;
  }

  async transitionCorrectionRequest(
    requestId: string,
    tenantId: string,
    toStatus: CorrectionStatus,
    actorId: string,
    statusReason?: string,
  ): Promise<CorrectionRequestEntity> {
    const existing = await this.repository.findCorrectionRequestById(requestId, tenantId);
    if (!existing) throw new NotFoundError(`Correction request '${requestId}' not found`);
    if (!CORRECTION_TRANSITIONS[existing.status].includes(toStatus)) {
      throw new BusinessRuleError(
        `Invalid correction transition: ${existing.status} → ${toStatus}`,
      );
    }
    if (toStatus === 'applied') {
      return this.applyCorrection(requestId, tenantId, actorId, statusReason);
    }
    return (await this.repository.updateCorrectionRequest(requestId, tenantId, {
      status: toStatus,
      reviewedBy: actorId,
      statusReason: statusReason ?? null,
    }))!;
  }

  /**
   * Apply an approved correction and emit an audit event with before/after values.
   * Domain field mutation is caller/residual — this records the rectification decision.
   */
  async applyCorrection(
    requestId: string,
    tenantId: string,
    actorId: string,
    statusReason?: string,
  ): Promise<CorrectionRequestEntity> {
    const existing = await this.repository.findCorrectionRequestById(requestId, tenantId);
    if (!existing) throw new NotFoundError(`Correction request '${requestId}' not found`);
    if (existing.status !== 'approved') {
      throw new BusinessRuleError(
        `Correction apply requires approved status; current=${existing.status}`,
      );
    }

    const applied = await this.repository.updateCorrectionRequest(requestId, tenantId, {
      status: 'applied',
      reviewedBy: actorId,
      statusReason: statusReason ?? 'Correction applied',
      appliedAt: new Date(),
    });

    await this.audit.record({
      tenantId: existing.tenantId,
      entityType: 'privacy_correction',
      entityId: requestId,
      operation: 'UPDATE',
      userId: actorId,
      userName: actorId,
      ipAddress: '0.0.0.0',
      beforeValues: {
        fieldPath: existing.fieldPath,
        value: existing.currentValue,
        status: existing.status,
      },
      afterValues: {
        fieldPath: existing.fieldPath,
        value: existing.requestedValue,
        status: 'applied',
      },
      metadata: {
        subjectType: existing.subjectType,
        subjectId: existing.subjectId,
        reason: existing.reason,
      },
    });

    logger.info(
      { requestId, tenantId: existing.tenantId, fieldPath: existing.fieldPath },
      'Correction applied with audit',
    );
    return applied!;
  }

  getCorrectionRequest(requestId: string, tenantId: string) {
    return this.repository.findCorrectionRequestById(requestId, tenantId);
  }

  listCorrectionRequests(tenantId: string, page?: ListPage) {
    return this.repository.listCorrectionRequests(tenantId, page);
  }

  // ─── Tenant offboard wipe ────────────────────────────────────────────────

  async requestTenantOffboardWipe(
    input: RequestTenantOffboardInput,
  ): Promise<TenantOffboardJobEntity> {
    if (!this.tenantWipeAvailable) {
      // PRC-H077: no real TenantWipeExecutor -> tenant offboard is disabled.
      throw new PrivacyExecutorNotConfiguredError(
        'Tenant offboard wipe is not available: no tenant wipe executor is configured',
      );
    }
    if (await this.isOnLegalHold(input.tenantId)) {
      throw new BusinessRuleError(
        `Tenant offboard wipe blocked: tenant '${input.tenantId}' is under legal hold (fail-closed)`,
      );
    }

    const job = await this.repository.createTenantOffboardJob({
      id: uuidv4(),
      tenantId: input.tenantId,
      status: 'queued',
      reason: input.reason,
      requestedBy: input.requestedBy,
      statusReason: 'Queued for durable offboard worker',
      checklist: [],
      residualNote: null,
      startedAt: null,
      completedAt: null,
    });

    await this.audit.record({
      tenantId: input.tenantId,
      entityType: 'privacy_offboard',
      entityId: job.id,
      operation: 'CREATE',
      userId: input.requestedBy,
      userName: input.requestedBy,
      ipAddress: '0.0.0.0',
      beforeValues: null,
      afterValues: { status: 'queued', reason: input.reason },
    });

    if (this.offboardPublisher) {
      await this.offboardPublisher.enqueueOffboard({
        jobId: job.id,
        tenantId: input.tenantId,
      });
      return job;
    }

    return this.processTenantOffboardJob(job.id, input.tenantId);
  }

  async processTenantOffboardJob(
    jobId: string,
    tenantId: string,
  ): Promise<TenantOffboardJobEntity> {
    const job = await this.repository.findTenantOffboardJobById(jobId, tenantId);
    if (!job) throw new NotFoundError(`Tenant offboard job '${jobId}' not found`);
    if (job.status === 'completed' || job.status === 'failed') return job;

    if (await this.isOnLegalHold(job.tenantId)) {
      await this.repository.updateTenantOffboardJob(jobId, tenantId, {
        status: 'blocked_legal_hold',
        statusReason: 'Active legal hold blocks tenant offboard wipe (fail-closed)',
        completedAt: new Date(),
      });
      throw new BusinessRuleError(
        `Tenant offboard wipe blocked: tenant '${job.tenantId}' is under legal hold (job ${jobId})`,
      );
    }

    await this.repository.updateTenantOffboardJob(jobId, tenantId, {
      status: 'in_progress',
      startedAt: new Date(),
      statusReason: 'Offboard wipe worker started',
    });

    const domainResults = await this.tenantWipeExecutor.wipe({
      tenantId: job.tenantId,
      jobId: job.id,
      reason: job.reason,
    });

    const checklist: OffboardChecklistItem[] = domainResults.map((d) => ({
      domain: d.domain,
      status:
        d.status === 'completed' ? 'completed' : d.status === 'skipped' ? 'skipped' : 'residual',
      note: d.note,
    }));

    const hasResidual =
      checklist.some((c) => c.status === 'residual') ||
      domainResults.some((d) => Boolean(d.note && d.status === 'residual'));

    const residualNote = hasResidual
      ? 'Scoped residual: full cascade tenant data destruction not claimed; checklist recorded after hold checks.'
      : null;

    // Fail closed: residual checklist items → failed, never completed.
    const jobStatus = hasResidual ? 'failed' : 'completed';

    const updated = await this.repository.updateTenantOffboardJob(jobId, tenantId, {
      status: jobStatus,
      checklist,
      residualNote,
      statusReason: hasResidual
        ? 'Offboard wipe left residuals (fail-closed; not marked completed)'
        : 'Offboard wipe checklist completed',
      completedAt: new Date(),
    });

    await this.audit.record({
      tenantId: job.tenantId,
      entityType: 'privacy_offboard',
      entityId: jobId,
      operation: 'UPDATE',
      userId: job.requestedBy,
      userName: job.requestedBy,
      ipAddress: '0.0.0.0',
      beforeValues: { status: 'in_progress' },
      afterValues: { status: jobStatus, checklist, residualNote },
    });

    logger.info(
      { jobId, tenantId: job.tenantId, jobStatus },
      hasResidual
        ? 'Tenant offboard job failed closed on residual'
        : 'Tenant offboard job completed',
    );
    return updated!;
  }

  getTenantOffboardJob(jobId: string, tenantId: string) {
    return this.repository.findTenantOffboardJobById(jobId, tenantId);
  }

  listTenantOffboardJobs(tenantId: string, page?: ListPage) {
    return this.repository.listTenantOffboardJobs(tenantId, page);
  }

  getErasureRequest(requestId: string, tenantId: string) {
    return this.repository.findErasureRequestById(requestId, tenantId);
  }

  listErasureRequests(tenantId: string, page?: ListPage) {
    return this.repository.listErasureRequests(tenantId, page);
  }

  getAnonymizationJob(jobId: string, tenantId: string) {
    return this.repository.findAnonymizationJobById(jobId, tenantId);
  }

  listAnonymizationJobs(tenantId: string) {
    return this.repository.listAnonymizationJobs(tenantId);
  }
}
