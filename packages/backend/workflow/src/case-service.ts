/**
 * Case Management Service
 *
 * Business logic for managing cases (disciplinary, counselling, complaints)
 * with status tracking, attachments, and resolution recording.
 *
 * Requirements:
 * - 13.5: THE Workflow_Engine SHALL manage cases (disciplinary, counselling, complaints)
 *         with status tracking, attachments, and resolution recording
 */
import { NotFoundError, BusinessRuleError } from '@proctira/common';
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type {
  CaseRepository,
  CaseEntity,
  CaseFilter,
} from './case-repository.js';
import type {
  CreateCaseInput,
  UpdateCaseInput,
  AddAttachmentInput,
  ResolveCaseInput,
  CaseStatus,
  CaseAttachmentInput,
} from './case-schemas.js';

// ─── Valid Status Transitions ────────────────────────────────────────────────

/**
 * Defines valid status transitions for cases.
 * Cases follow a lifecycle: open → in_progress → pending_review → resolved → closed
 * Escalation can happen from open or in_progress states.
 */
const VALID_STATUS_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  open: ['in_progress', 'escalated', 'closed'],
  in_progress: ['pending_review', 'escalated', 'closed'],
  pending_review: ['resolved', 'in_progress', 'escalated'],
  resolved: ['closed', 'in_progress'],
  closed: [],
  escalated: ['in_progress', 'closed'],
};

// ─── Case Service ────────────────────────────────────────────────────────────

/**
 * Service handling case management business logic.
 */
export class CaseService {
  constructor(private readonly repository: CaseRepository) {}

  /**
   * Create a new case.
   *
   * Cases start with 'open' status.
   */
  async createCase(tenantId: string, input: CreateCaseInput): Promise<CaseEntity> {
    const caseEntity: Omit<CaseEntity, 'createdAt' | 'updatedAt'> = {
      id: uuidv4(),
      tenantId,
      type: input.type,
      title: input.title,
      description: input.description,
      status: 'open',
      entityType: input.entityType,
      entityId: input.entityId,
      institutionId: input.institutionId ?? null,
      areaId: input.areaId ?? null,
      assignedTo: input.assignedTo ?? null,
      priority: input.priority ?? 'medium',
      workflowInstanceId: input.workflowInstanceId ?? null,
      attachments: input.attachments ?? [],
      resolution: null,
      metadata: input.metadata ?? null,
    };

    return this.repository.createCase(caseEntity);
  }

  /**
   * Get a case by ID.
   *
   * @throws NotFoundError if case not found
   */
  async getCase(tenantId: string, caseId: string): Promise<CaseEntity> {
    const caseEntity = await this.repository.findCaseById(caseId, tenantId);
    if (!caseEntity) {
      throw new NotFoundError(`Case with id '${caseId}' not found`);
    }
    return caseEntity;
  }

  /**
   * Update a case.
   *
   * Validates status transitions if status is being changed.
   *
   * @throws NotFoundError if case not found
   * @throws BusinessRuleError if status transition is invalid or case is closed
   */
  async updateCase(tenantId: string, caseId: string, input: UpdateCaseInput): Promise<CaseEntity> {
    const existing = await this.repository.findCaseById(caseId, tenantId);
    if (!existing) {
      throw new NotFoundError(`Case with id '${caseId}' not found`);
    }

    if (existing.status === 'closed' && input.status !== 'closed') {
      throw new BusinessRuleError('Cannot modify a closed case');
    }

    // Validate status transition if status is being changed
    if (input.status && input.status !== existing.status) {
      const validTransitions = VALID_STATUS_TRANSITIONS[existing.status];
      if (!validTransitions.includes(input.status)) {
        throw new BusinessRuleError(
          `Cannot transition case from '${existing.status}' to '${input.status}'. ` +
          `Valid transitions: ${validTransitions.join(', ')}`,
        );
      }
    }

    const updateData: Partial<CaseEntity> = {};
    if (input.title !== undefined) updateData.title = input.title;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.status !== undefined) updateData.status = input.status;
    if (input.assignedTo !== undefined) updateData.assignedTo = input.assignedTo;
    if (input.priority !== undefined) updateData.priority = input.priority;
    if (input.metadata !== undefined) updateData.metadata = input.metadata;

    const updated = await this.repository.updateCase(caseId, tenantId, updateData);
    if (!updated) {
      throw new NotFoundError(`Case with id '${caseId}' not found`);
    }

    return updated;
  }

  /**
   * Add an attachment to a case.
   *
   * @throws NotFoundError if case not found
   * @throws BusinessRuleError if case is closed
   */
  async addAttachment(
    tenantId: string,
    caseId: string,
    input: AddAttachmentInput,
  ): Promise<CaseEntity> {
    const existing = await this.repository.findCaseById(caseId, tenantId);
    if (!existing) {
      throw new NotFoundError(`Case with id '${caseId}' not found`);
    }

    if (existing.status === 'closed') {
      throw new BusinessRuleError('Cannot add attachments to a closed case');
    }

    const attachment: CaseAttachmentInput = {
      id: uuidv4(),
      fileName: input.fileName,
      fileType: input.fileType,
      fileSize: input.fileSize,
      storagePath: input.storagePath,
      uploadedBy: input.uploadedBy,
      uploadedAt: new Date().toISOString(),
    };

    const updatedAttachments = [...existing.attachments, attachment];

    const updated = await this.repository.updateCase(caseId, tenantId, {
      attachments: updatedAttachments,
    });

    if (!updated) {
      throw new NotFoundError(`Case with id '${caseId}' not found`);
    }

    return updated;
  }

  /**
   * Resolve a case with outcome and notes.
   *
   * Transitions the case to 'resolved' status and records the resolution.
   *
   * @throws NotFoundError if case not found
   * @throws BusinessRuleError if case is already resolved/closed or cannot be resolved from current status
   */
  async resolveCase(
    tenantId: string,
    caseId: string,
    input: ResolveCaseInput,
  ): Promise<CaseEntity> {
    const existing = await this.repository.findCaseById(caseId, tenantId);
    if (!existing) {
      throw new NotFoundError(`Case with id '${caseId}' not found`);
    }

    if (existing.status === 'closed') {
      throw new BusinessRuleError('Cannot resolve a closed case');
    }

    if (existing.status === 'resolved') {
      throw new BusinessRuleError('Case is already resolved');
    }

    // Validate that resolution is allowed from current status
    const validTransitions = VALID_STATUS_TRANSITIONS[existing.status];
    if (!validTransitions.includes('resolved')) {
      throw new BusinessRuleError(
        `Cannot resolve case from '${existing.status}' status. ` +
        `Case must be in 'pending_review' status to be resolved.`,
      );
    }

    const resolution = {
      outcome: input.outcome,
      resolvedBy: input.resolvedBy,
      resolvedAt: new Date().toISOString(),
      notes: input.notes,
      followUpRequired: input.followUpRequired,
      followUpDate: input.followUpDate,
    };

    const updated = await this.repository.updateCase(caseId, tenantId, {
      status: 'resolved',
      resolution,
    });

    if (!updated) {
      throw new NotFoundError(`Case with id '${caseId}' not found`);
    }

    return updated;
  }

  /**
   * List cases with pagination and filtering.
   */
  async listCases(
    tenantId: string,
    filter: CaseFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<CaseEntity>> {
    return this.repository.listCases(tenantId, filter, pagination);
  }

  /**
   * Get valid status transitions for a case's current status.
   */
  getValidTransitions(currentStatus: CaseStatus): CaseStatus[] {
    return VALID_STATUS_TRANSITIONS[currentStatus] ?? [];
  }
}
