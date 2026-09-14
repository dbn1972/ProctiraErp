/**
 * Privacy lifecycle service (W1-SEC-06 complete slice).
 *
 * - Legal hold fail-closed for erase/anonymize/offboard
 * - Correction path with audit
 * - Durable anonymization + tenant offboard job orchestration
 */
import { BusinessRuleError, NotFoundError, ValidationError } from '@proctira/common';
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

const CORRECTION_TRANSITIONS: Record<CorrectionStatus, readonly CorrectionStatus[]> = {
  requested: ['under_review', 'rejected', 'cancelled'],
  under_review: ['approved', 'rejected', 'cancelled'],
  approved: ['applied', 'cancelled'],
  applied: [],
  rejected: [],
  cancelled: [],
};

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

  constructor(
    private readonly repository: PrivacyRepository,
    options: PrivacyServiceOptions = {},
  ) {
    this.audit = options.audit ?? new NoopPrivacyAuditPort();
    this.anonymizer = options.anonymizer ?? new RecordingSubjectAnonymizer();
    this.tenantWipeExecutor = options.tenantWipeExecutor ?? new ResidualTenantWipeExecutor();
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
    logger.info({ holdId: hold.id, tenantId: hold.tenantId, scope: hold.scope }, 'Legal hold placed');
    return hold;
  }

  async releaseLegalHold(holdId: string, releasedBy: string): Promise<LegalHoldEntity> {
    const existing = await this.repository.findLegalHoldById(holdId);
    if (!existing) throw new NotFoundError(`Legal hold '${holdId}' not found`);
    if (!existing.active) throw new BusinessRuleError('Legal hold is already released');
    const updated = await this.repository.updateLegalHold(holdId, {
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

  async listActiveLegalHolds(tenantId: string): Promise<LegalHoldEntity[]> {
    return this.repository.listActiveLegalHolds(tenantId);
  }

  async isOnLegalHold(
    tenantId: string,
    subjectType?: string,
    subjectId?: string,
  ): Promise<boolean> {
    const active = await this.listActiveLegalHolds(tenantId);
    if (active.some((h) => h.scope === 'tenant')) return true;
    if (subjectType && subjectId) {
      return active.some(
        (h) =>
          h.scope === 'subject' && h.subjectType === subjectType && h.subjectId === subjectId,
      );
    }
    return false;
  }

  async assertDestructiveDeleteAllowed(tenantId: string, subjectId?: string): Promise<void> {
    const active = await this.repository.listActiveLegalHolds(tenantId);
    const tenantHold = active.find((h) => h.scope === 'tenant');
    if (tenantHold) {
      throw new BusinessRuleError(
        `Destructive delete blocked: tenant '${tenantId}' is under legal hold (${tenantHold.id})`,
      );
    }
    if (subjectId) {
      const subjectHold = active.find((h) => h.scope === 'subject' && h.subjectId === subjectId);
      if (subjectHold) {
        throw new BusinessRuleError(
          `Destructive delete blocked: subject '${subjectId}' is under legal hold (${subjectHold.id})`,
        );
      }
    }
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
    toStatus: ErasureStatus,
    actorId: string,
    statusReason?: string,
  ): Promise<ErasureRequestEntity> {
    const existing = await this.repository.findErasureRequestById(requestId);
    if (!existing) throw new NotFoundError(`Erasure request '${requestId}' not found`);
    if (!ERASURE_TRANSITIONS[existing.status].includes(toStatus)) {
      throw new BusinessRuleError(`Invalid erasure transition: ${existing.status} → ${toStatus}`);
    }
    if (toStatus === 'in_progress') {
      if (
        await this.isOnLegalHold(existing.tenantId, existing.subjectType, existing.subjectId)
      ) {
        await this.repository.updateErasureRequest(requestId, {
          status: 'blocked_legal_hold',
          reviewedBy: actorId,
          statusReason: 'Active legal hold blocks erasure/anonymization (fail-closed)',
        });
        throw new BusinessRuleError(
          `Erasure blocked: subject under legal hold (request ${requestId})`,
        );
      }
    }
    return (await this.repository.updateErasureRequest(requestId, {
      status: toStatus,
      reviewedBy: actorId,
      statusReason: statusReason ?? null,
      completedAt: toStatus === 'completed' ? new Date() : existing.completedAt,
    }))!;
  }

  /**
   * Approve → start execution. Fail-closed under legal hold.
   * When a durable publisher is wired, enqueues a job and leaves erasure
   * `in_progress` until the worker completes. Otherwise processes inline.
   */
  async executeErasure(requestId: string, actorId: string): Promise<ErasureRequestEntity> {
    const existing = await this.repository.findErasureRequestById(requestId);
    if (!existing) throw new NotFoundError(`Erasure request '${requestId}' not found`);
    if (existing.status !== 'approved') {
      throw new BusinessRuleError(
        `Erasure execute requires approved status; current=${existing.status}`,
      );
    }
    if (await this.isOnLegalHold(existing.tenantId, existing.subjectType, existing.subjectId)) {
      await this.repository.updateErasureRequest(requestId, {
        status: 'blocked_legal_hold',
        reviewedBy: actorId,
        statusReason: 'Active legal hold blocks erasure/anonymization (fail-closed)',
      });
      throw new BusinessRuleError(`Erasure blocked: subject under legal hold (request ${requestId})`);
    }

    await this.repository.updateErasureRequest(requestId, {
      status: 'in_progress',
      reviewedBy: actorId,
      statusReason: 'Erasure execution started',
    });

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
      return (await this.repository.findErasureRequestById(requestId))!;
    }

    // No durable publisher — process inline (same worker code path).
    await this.processAnonymizationJob(job.id);
    return (await this.repository.findErasureRequestById(requestId))!;
  }

  async processAnonymizationJob(jobId: string): Promise<AnonymizationJobEntity> {
    const job = await this.repository.findAnonymizationJobById(jobId);
    if (!job) throw new NotFoundError(`Anonymization job '${jobId}' not found`);
    if (job.status === 'completed') return job;

    if (await this.isOnLegalHold(job.tenantId, job.subjectType, job.subjectId)) {
      await this.repository.updateAnonymizationJob(jobId, {
        status: 'blocked_legal_hold',
        statusReason: 'Active legal hold blocks anonymization (fail-closed)',
        completedAt: new Date(),
      });
      await this.repository.updateErasureRequest(job.erasureRequestId, {
        status: 'blocked_legal_hold',
        statusReason: 'Active legal hold blocks erasure/anonymization (fail-closed)',
      });
      throw new BusinessRuleError(
        `Anonymization blocked: subject under legal hold (job ${jobId})`,
      );
    }

    await this.repository.updateAnonymizationJob(jobId, {
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

      const completed = await this.repository.updateAnonymizationJob(jobId, {
        status: 'completed',
        fieldsTouched: result.fieldsTouched,
        residualNote: result.residualNote ?? null,
        statusReason: 'Anonymization worker completed',
        completedAt: new Date(),
      });

      await this.repository.updateErasureRequest(job.erasureRequestId, {
        status: 'completed',
        statusReason: result.residualNote
          ?? 'Anonymization completed via durable worker',
        completedAt: new Date(),
      });

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
          status: 'completed',
          jobId,
          fieldsTouched: result.fieldsTouched,
          residualNote: result.residualNote ?? null,
        },
        metadata: { requestType: job.requestType, subjectType: job.subjectType },
      });

      logger.info(
        { jobId, requestId: job.erasureRequestId, tenantId: job.tenantId },
        'Anonymization job completed',
      );
      return completed!;
    } catch (error) {
      if (error instanceof BusinessRuleError) throw error;
      await this.repository.updateAnonymizationJob(jobId, {
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
    toStatus: CorrectionStatus,
    actorId: string,
    statusReason?: string,
  ): Promise<CorrectionRequestEntity> {
    const existing = await this.repository.findCorrectionRequestById(requestId);
    if (!existing) throw new NotFoundError(`Correction request '${requestId}' not found`);
    if (!CORRECTION_TRANSITIONS[existing.status].includes(toStatus)) {
      throw new BusinessRuleError(
        `Invalid correction transition: ${existing.status} → ${toStatus}`,
      );
    }
    if (toStatus === 'applied') {
      return this.applyCorrection(requestId, actorId, statusReason);
    }
    return (await this.repository.updateCorrectionRequest(requestId, {
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
    actorId: string,
    statusReason?: string,
  ): Promise<CorrectionRequestEntity> {
    const existing = await this.repository.findCorrectionRequestById(requestId);
    if (!existing) throw new NotFoundError(`Correction request '${requestId}' not found`);
    if (existing.status !== 'approved') {
      throw new BusinessRuleError(
        `Correction apply requires approved status; current=${existing.status}`,
      );
    }

    const applied = await this.repository.updateCorrectionRequest(requestId, {
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

  getCorrectionRequest(requestId: string) {
    return this.repository.findCorrectionRequestById(requestId);
  }

  listCorrectionRequests(tenantId: string) {
    return this.repository.listCorrectionRequests(tenantId);
  }

  // ─── Tenant offboard wipe ────────────────────────────────────────────────

  async requestTenantOffboardWipe(
    input: RequestTenantOffboardInput,
  ): Promise<TenantOffboardJobEntity> {
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

    return this.processTenantOffboardJob(job.id);
  }

  async processTenantOffboardJob(jobId: string): Promise<TenantOffboardJobEntity> {
    const job = await this.repository.findTenantOffboardJobById(jobId);
    if (!job) throw new NotFoundError(`Tenant offboard job '${jobId}' not found`);
    if (job.status === 'completed') return job;

    if (await this.isOnLegalHold(job.tenantId)) {
      await this.repository.updateTenantOffboardJob(jobId, {
        status: 'blocked_legal_hold',
        statusReason: 'Active legal hold blocks tenant offboard wipe (fail-closed)',
        completedAt: new Date(),
      });
      throw new BusinessRuleError(
        `Tenant offboard wipe blocked: tenant '${job.tenantId}' is under legal hold (job ${jobId})`,
      );
    }

    await this.repository.updateTenantOffboardJob(jobId, {
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
      status: d.status === 'completed' ? 'completed' : d.status === 'skipped' ? 'skipped' : 'residual',
      note: d.note,
    }));

    const residualNote =
      checklist.some((c) => c.status === 'residual')
        ? 'Scoped residual: full cascade tenant data destruction not claimed; checklist recorded after hold checks.'
        : null;

    const completed = await this.repository.updateTenantOffboardJob(jobId, {
      status: 'completed',
      checklist,
      residualNote,
      statusReason: 'Offboard wipe checklist completed',
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
      afterValues: { status: 'completed', checklist, residualNote },
    });

    logger.info({ jobId, tenantId: job.tenantId }, 'Tenant offboard job completed');
    return completed!;
  }

  getTenantOffboardJob(jobId: string) {
    return this.repository.findTenantOffboardJobById(jobId);
  }

  listTenantOffboardJobs(tenantId: string) {
    return this.repository.listTenantOffboardJobs(tenantId);
  }

  getErasureRequest(requestId: string) {
    return this.repository.findErasureRequestById(requestId);
  }

  listErasureRequests(tenantId: string) {
    return this.repository.listErasureRequests(tenantId);
  }

  getAnonymizationJob(jobId: string) {
    return this.repository.findAnonymizationJobById(jobId);
  }
}
