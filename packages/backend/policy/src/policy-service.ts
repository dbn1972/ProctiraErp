/**
 * Policy Service
 *
 * Business logic for policy CRUD operations, versioning, and evaluation.
 * Handles validation, uniqueness enforcement, activation/deactivation,
 * and policy versioning with effective dates.
 *
 * Charter: Section 27 (Security and Compliance)
 */
import { ConflictError, NotFoundError, BusinessRuleError } from '@proctira/common';
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type {
  PolicyEntity,
  PolicyVersionEntity,
  PolicyAssignmentEntity,
  PolicyFilter,
  PolicyRepository,
} from './policy-repository.js';
import type {
  CreatePolicyInput,
  UpdatePolicyInput,
  PolicyType,
  PolicyEvaluationResponse,
  CreatePolicyAssignmentInput,
} from './schemas.js';
import {
  PolicyEvaluationEngine,
  type PolicyEvaluationContext,
} from './policy-evaluation-engine.js';

/**
 * Service handling policy business logic.
 */
export class PolicyService {
  private readonly evaluationEngine: PolicyEvaluationEngine;

  constructor(private readonly repository: PolicyRepository) {
    this.evaluationEngine = new PolicyEvaluationEngine(repository);
  }

  // ─── Policy CRUD ─────────────────────────────────────────────────────────

  /**
   * Create a new policy.
   *
   * Validates:
   * - Policy name is unique within the tenant
   * - Rules are valid for the policy type
   *
   * Creates initial version (v1) automatically.
   *
   * @throws ConflictError if name already exists
   */
  async create(tenantId: string, input: CreatePolicyInput): Promise<PolicyEntity> {
    // Check name uniqueness within tenant
    const existingByName = await this.repository.findByName(input.name, tenantId);
    if (existingByName) {
      throw new ConflictError(`Policy with name '${input.name}' already exists`);
    }

    const policyId = uuidv4();
    const policy: Omit<PolicyEntity, 'createdAt' | 'updatedAt'> = {
      id: policyId,
      tenantId,
      name: input.name,
      description: input.description ?? null,
      type: input.type,
      scope: input.scope,
      status: 'draft',
      rules: input.rules as Record<string, unknown>,
      version: 1,
      effectiveFrom: input.effectiveFrom ? new Date(input.effectiveFrom) : null,
      effectiveUntil: input.effectiveUntil ? new Date(input.effectiveUntil) : null,
      priority: input.priority ?? 100,
    };

    const created = await this.repository.create(policy);

    // Create initial version
    await this.repository.createVersion({
      id: uuidv4(),
      policyId,
      version: 1,
      rules: input.rules as Record<string, unknown>,
      effectiveFrom: created.effectiveFrom,
      effectiveUntil: created.effectiveUntil,
      createdBy: null,
    });

    return created;
  }

  /**
   * Update an existing policy.
   *
   * Creates a new version when rules are changed.
   *
   * @throws NotFoundError if policy not found
   * @throws ConflictError if name conflicts with another policy
   */
  async update(tenantId: string, id: string, input: UpdatePolicyInput): Promise<PolicyEntity> {
    const existing = await this.repository.findById(id, tenantId);
    if (!existing) {
      throw new NotFoundError(`Policy with id '${id}' not found`);
    }

    // Check name uniqueness if name is being changed
    if (input.name && input.name !== existing.name) {
      const existingByName = await this.repository.findByName(input.name, tenantId);
      if (existingByName && existingByName.id !== id) {
        throw new ConflictError(`Policy with name '${input.name}' already exists`);
      }
    }

    const updateData: Partial<PolicyEntity> = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.effectiveFrom !== undefined) updateData.effectiveFrom = new Date(input.effectiveFrom);
    if (input.effectiveUntil !== undefined)
      updateData.effectiveUntil = new Date(input.effectiveUntil);
    if (input.priority !== undefined) updateData.priority = input.priority;

    // If rules are changed, bump version
    if (input.rules !== undefined) {
      const newVersion = existing.version + 1;
      updateData.rules = input.rules as Record<string, unknown>;
      updateData.version = newVersion;

      // Create new version record
      await this.repository.createVersion({
        id: uuidv4(),
        policyId: id,
        version: newVersion,
        rules: input.rules as Record<string, unknown>,
        effectiveFrom: input.effectiveFrom ? new Date(input.effectiveFrom) : existing.effectiveFrom,
        effectiveUntil: input.effectiveUntil
          ? new Date(input.effectiveUntil)
          : existing.effectiveUntil,
        createdBy: null,
      });
    }

    const updated = await this.repository.update(id, tenantId, updateData);
    if (!updated) {
      throw new NotFoundError(`Policy with id '${id}' not found`);
    }

    return updated;
  }

  /**
   * Activate a policy.
   *
   * @throws NotFoundError if policy not found
   * @throws BusinessRuleError if policy is already active
   */
  async activate(tenantId: string, id: string): Promise<PolicyEntity> {
    const existing = await this.repository.findById(id, tenantId);
    if (!existing) {
      throw new NotFoundError(`Policy with id '${id}' not found`);
    }

    if (existing.status === 'active') {
      throw new BusinessRuleError('Policy is already active');
    }

    const updated = await this.repository.update(id, tenantId, { status: 'active' });
    if (!updated) {
      throw new NotFoundError(`Policy with id '${id}' not found`);
    }

    return updated;
  }

  /**
   * Deactivate a policy.
   *
   * @throws NotFoundError if policy not found
   * @throws BusinessRuleError if policy is already inactive
   */
  async deactivate(tenantId: string, id: string): Promise<PolicyEntity> {
    const existing = await this.repository.findById(id, tenantId);
    if (!existing) {
      throw new NotFoundError(`Policy with id '${id}' not found`);
    }

    if (existing.status === 'inactive') {
      throw new BusinessRuleError('Policy is already inactive');
    }

    const updated = await this.repository.update(id, tenantId, { status: 'inactive' });
    if (!updated) {
      throw new NotFoundError(`Policy with id '${id}' not found`);
    }

    return updated;
  }

  /**
   * Get a single policy by ID.
   *
   * @throws NotFoundError if policy not found
   */
  async getById(tenantId: string, id: string): Promise<PolicyEntity> {
    const policy = await this.repository.findById(id, tenantId);
    if (!policy) {
      throw new NotFoundError(`Policy with id '${id}' not found`);
    }
    return policy;
  }

  /**
   * List policies with pagination and filtering.
   */
  async list(
    tenantId: string,
    filter: PolicyFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<PolicyEntity>> {
    return this.repository.list(tenantId, filter, pagination);
  }

  // ─── Policy Versioning ───────────────────────────────────────────────────

  /**
   * Get all versions of a policy.
   *
   * @throws NotFoundError if policy not found
   */
  async getVersions(tenantId: string, policyId: string): Promise<PolicyVersionEntity[]> {
    const policy = await this.repository.findById(policyId, tenantId);
    if (!policy) {
      throw new NotFoundError(`Policy with id '${policyId}' not found`);
    }

    return this.repository.getVersions(policyId);
  }

  /**
   * Get a specific version of a policy.
   *
   * @throws NotFoundError if policy or version not found
   */
  async getVersion(
    tenantId: string,
    policyId: string,
    version: number,
  ): Promise<PolicyVersionEntity> {
    const policy = await this.repository.findById(policyId, tenantId);
    if (!policy) {
      throw new NotFoundError(`Policy with id '${policyId}' not found`);
    }

    const versionEntity = await this.repository.getVersion(policyId, version);
    if (!versionEntity) {
      throw new NotFoundError(`Version ${version} not found for policy '${policyId}'`);
    }

    return versionEntity;
  }

  // ─── Policy Assignments ──────────────────────────────────────────────────

  /**
   * Assign a policy to a target scope.
   *
   * @throws NotFoundError if policy not found
   * @throws BusinessRuleError if policy is not active
   */
  async assignPolicy(
    tenantId: string,
    input: CreatePolicyAssignmentInput,
  ): Promise<PolicyAssignmentEntity> {
    const policy = await this.repository.findById(input.policyId, tenantId);
    if (!policy) {
      throw new NotFoundError(`Policy with id '${input.policyId}' not found`);
    }

    if (policy.status !== 'active') {
      throw new BusinessRuleError('Only active policies can be assigned');
    }

    return this.repository.createAssignment({
      id: uuidv4(),
      policyId: input.policyId,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      tenantId,
    });
  }

  /**
   * Remove a policy assignment.
   *
   * @throws NotFoundError if assignment not found
   */
  async removeAssignment(tenantId: string, assignmentId: string): Promise<void> {
    const removed = await this.repository.removeAssignment(assignmentId, tenantId);
    if (!removed) {
      throw new NotFoundError(`Assignment with id '${assignmentId}' not found`);
    }
  }

  /**
   * Get all assignments for a policy.
   *
   * @throws NotFoundError if policy not found
   */
  async getAssignments(tenantId: string, policyId: string): Promise<PolicyAssignmentEntity[]> {
    const policy = await this.repository.findById(policyId, tenantId);
    if (!policy) {
      throw new NotFoundError(`Policy with id '${policyId}' not found`);
    }

    return this.repository.findAssignmentsByPolicy(policyId, tenantId);
  }

  // ─── Policy Evaluation ───────────────────────────────────────────────────

  /**
   * Evaluate the effective policy for a given context.
   * Uses the inheritance chain: platform → tenant → institution.
   */
  async evaluate(context: PolicyEvaluationContext): Promise<PolicyEvaluationResponse> {
    return this.evaluationEngine.evaluate(context);
  }
}
