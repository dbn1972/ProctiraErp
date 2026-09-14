/**
 * Privacy lifecycle service (W1-SEC-06 vertical slice).
 */
import { BusinessRuleError, NotFoundError, ValidationError } from '@proctira/common';
import { createLogger } from '@proctira/logging';
import { v4 as uuidv4 } from 'uuid';
import type { ErasureRequestEntity, LegalHoldEntity, PrivacyRepository } from './privacy-repository.js';
import type { CreateErasureRequestInput, ErasureStatus, PlaceLegalHoldInput } from './schemas.js';

const logger = createLogger({ name: 'privacy-service' });
const ERASURE_TRANSITIONS: Record<ErasureStatus, readonly ErasureStatus[]> = {
  requested: ['under_review', 'rejected', 'cancelled'],
  under_review: ['approved', 'rejected', 'cancelled'],
  approved: ['in_progress', 'blocked_legal_hold', 'cancelled'],
  in_progress: ['completed', 'blocked_legal_hold'],
  blocked_legal_hold: ['approved', 'cancelled'],
  completed: [], rejected: [], cancelled: [],
};

export interface DestructiveDeleteGuard {
  assertDestructiveDeleteAllowed(tenantId: string, subjectId?: string): Promise<void>;
}

export class PrivacyService implements DestructiveDeleteGuard {
  constructor(private readonly repository: PrivacyRepository) {}

  async placeLegalHold(input: PlaceLegalHoldInput): Promise<LegalHoldEntity> {
    if (input.scope === 'subject') {
      if (!input.subjectType?.trim() || !input.subjectId?.trim()) {
        throw new ValidationError('subjectType and subjectId are required for subject-scope holds');
      }
    } else if (input.subjectType || input.subjectId) {
      throw new ValidationError('tenant-scope holds must not include subjectType/subjectId');
    }
    const hold = await this.repository.createLegalHold({
      id: uuidv4(), tenantId: input.tenantId, scope: input.scope,
      subjectType: input.scope === 'subject' ? input.subjectType! : null,
      subjectId: input.scope === 'subject' ? input.subjectId! : null,
      reason: input.reason, placedBy: input.placedBy, placedAt: new Date(),
      releasedBy: null, releasedAt: null, active: true,
    });
    logger.info({ holdId: hold.id, tenantId: hold.tenantId, scope: hold.scope }, 'Legal hold placed');
    return hold;
  }

  async releaseLegalHold(holdId: string, releasedBy: string): Promise<LegalHoldEntity> {
    const existing = await this.repository.findLegalHoldById(holdId);
    if (!existing) throw new NotFoundError(`Legal hold '${holdId}' not found`);
    if (!existing.active) throw new BusinessRuleError('Legal hold is already released');
    const updated = await this.repository.updateLegalHold(holdId, { active: false, releasedBy, releasedAt: new Date() });
    logger.info({ holdId, tenantId: existing.tenantId }, 'Legal hold released');
    return updated!;
  }

  async listActiveLegalHolds(tenantId: string): Promise<LegalHoldEntity[]> {
    return this.repository.listActiveLegalHolds(tenantId);
  }

  async isOnLegalHold(tenantId: string, subjectType?: string, subjectId?: string): Promise<boolean> {
    const active = await this.listActiveLegalHolds(tenantId);
    if (active.some((h) => h.scope === 'tenant')) return true;
    if (subjectType && subjectId) {
      return active.some((h) => h.scope === 'subject' && h.subjectType === subjectType && h.subjectId === subjectId);
    }
    return false;
  }

  async assertDestructiveDeleteAllowed(tenantId: string, subjectId?: string): Promise<void> {
    const active = await this.repository.listActiveLegalHolds(tenantId);
    const tenantHold = active.find((h) => h.scope === 'tenant');
    if (tenantHold) {
      throw new BusinessRuleError(`Destructive delete blocked: tenant '${tenantId}' is under legal hold (${tenantHold.id})`);
    }
    if (subjectId) {
      const subjectHold = active.find((h) => h.scope === 'subject' && h.subjectId === subjectId);
      if (subjectHold) {
        throw new BusinessRuleError(`Destructive delete blocked: subject '${subjectId}' is under legal hold (${subjectHold.id})`);
      }
    }
  }

  async createErasureRequest(input: CreateErasureRequestInput): Promise<ErasureRequestEntity> {
    return this.repository.createErasureRequest({
      id: uuidv4(), tenantId: input.tenantId, subjectType: input.subjectType, subjectId: input.subjectId,
      status: 'requested', requestType: input.requestType ?? 'erasure', reason: input.reason ?? null,
      requestedBy: input.requestedBy, reviewedBy: null, statusReason: null, completedAt: null,
    });
  }

  async transitionErasureRequest(requestId: string, toStatus: ErasureStatus, actorId: string, statusReason?: string): Promise<ErasureRequestEntity> {
    const existing = await this.repository.findErasureRequestById(requestId);
    if (!existing) throw new NotFoundError(`Erasure request '${requestId}' not found`);
    if (!ERASURE_TRANSITIONS[existing.status].includes(toStatus)) {
      throw new BusinessRuleError(`Invalid erasure transition: ${existing.status} → ${toStatus}`);
    }
    return (await this.repository.updateErasureRequest(requestId, {
      status: toStatus, reviewedBy: actorId, statusReason: statusReason ?? null,
      completedAt: toStatus === 'completed' ? new Date() : existing.completedAt,
    }))!;
  }

  async executeErasure(requestId: string, actorId: string): Promise<ErasureRequestEntity> {
    const existing = await this.repository.findErasureRequestById(requestId);
    if (!existing) throw new NotFoundError(`Erasure request '${requestId}' not found`);
    if (existing.status !== 'approved') {
      throw new BusinessRuleError(`Erasure execute requires approved status; current=${existing.status}`);
    }
    if (await this.isOnLegalHold(existing.tenantId, existing.subjectType, existing.subjectId)) {
      await this.repository.updateErasureRequest(requestId, {
        status: 'blocked_legal_hold', reviewedBy: actorId,
        statusReason: 'Active legal hold blocks erasure/anonymization (fail-closed)',
      });
      throw new BusinessRuleError(`Erasure blocked: subject under legal hold (request ${requestId})`);
    }
    await this.repository.updateErasureRequest(requestId, {
      status: 'in_progress', reviewedBy: actorId, statusReason: 'Erasure execution started (stub anonymization)',
    });
    const completed = await this.repository.updateErasureRequest(requestId, {
      status: 'completed', reviewedBy: actorId,
      statusReason: 'Stub completion — domain anonymization workers not yet wired (W1-SEC-06 residual)',
      completedAt: new Date(),
    });
    logger.info({ requestId, tenantId: existing.tenantId, subjectId: existing.subjectId }, 'Erasure request completed (stub)');
    return completed!;
  }

  getErasureRequest(requestId: string) { return this.repository.findErasureRequestById(requestId); }
  listErasureRequests(tenantId: string) { return this.repository.listErasureRequests(tenantId); }
}
