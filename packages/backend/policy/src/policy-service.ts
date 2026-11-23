/**
 * Policy Service
 *
 * Business logic for policy CRUD operations, versioning, and evaluation.
 * Handles validation, uniqueness enforcement, activation/deactivation,
 * and policy versioning with effective dates.
 *
 * Charter: Section 27 (Security and Compliance)
 */
import { ConflictError, NotFoundError, BusinessRuleError, ValidationError } from '@proctira/common';
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { validate } from '@proctira/validation';
import { Type, type TSchema } from '@sinclair/typebox';
import { v4 as uuidv4 } from 'uuid';

import type { PolicyAuditEvent, PolicyAuditPort } from './audit-port.js';
import {
  PolicyEvaluationEngine,
  type PolicyEvaluationContext,
} from './policy-evaluation-engine.js';
import type {
  PolicyEntity,
  PolicyVersionEntity,
  PolicyAssignmentEntity,
  PolicyFilter,
  PolicyRepository,
} from './policy-repository.js';
import {
  DataRetentionRulesSchema,
  PasswordComplexityRulesSchema,
  RateLimitingRulesSchema,
  SessionTimeoutRulesSchema,
  type CreatePolicyInput,
  type UpdatePolicyInput,
  type PolicyEvaluationResponse,
  type CreatePolicyAssignmentInput,
  type PolicyType,
} from './schemas.js';

/**
 * PRC-M609: per-type rule schemas. A policy at a more specific scope may set
 * only the keys it overrides (rules are merged down the inheritance chain), so
 * every key is optional, but each key must belong to the policy type and hold
 * a value of the declared type and range.
 */
const RULE_SCHEMAS: Record<PolicyType, TSchema> = {
  data_retention: Type.Partial(DataRetentionRulesSchema, { additionalProperties: false }),
  password_complexity: Type.Partial(PasswordComplexityRulesSchema, {
    additionalProperties: false,
  }),
  session_timeout: Type.Partial(SessionTimeoutRulesSchema, { additionalProperties: false }),
  rate_limiting: Type.Partial(RateLimitingRulesSchema, { additionalProperties: false }),
};

function assertRulesMatchType(type: PolicyType, rules: unknown): void {
  const result = validate(RULE_SCHEMAS[type], rules);
  if (!result.success) {
    throw new ValidationError(`Policy rules are not valid for type '${type}'`, result.errors);
  }
}

/**
 * Service handling policy business logic.
 */
export class PolicyService {
  private readonly evaluationEngine: PolicyEvaluationEngine;

  constructor(
    private readonly repository: PolicyRepository,
    /**
     * PRC-M608: injected audit sink carrying the real actor and tenant. When
     * provided, every policy lifecycle mutation (create/update/activate/
     * deactivate/assign/removeAssignment) is recorded through it (durable,
     * tenant-aware). When omitted, the service does not emit, so a parked
     * package never writes a `'system'`-attributed or tenant-less audit row.
     */
    private readonly auditPort?: PolicyAuditPort,
  ) {
    this.evaluationEngine = new PolicyEvaluationEngine(repository);
  }

  /**
   * PRC-M608: record a policy audit event through the injected port when one is
   * configured. The caller always supplies the real `actor` and `tenantId`;
   * this method never substitutes a `'system'` actor. When no port and/or no
   * actor is provided, nothing is emitted (behaviour-preserving for callers
   * that have not wired an audit sink, e.g. the parked package's own tests).
   */
  private async audit(event: PolicyAuditEvent | undefined): Promise<void> {
    if (!event || !this.auditPort) return;
    await this.auditPort.record(event);
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
  async create(tenantId: string, input: CreatePolicyInput, actor?: string): Promise<PolicyEntity> {
    assertRulesMatchType(input.type, input.rules);

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
      // PRC-M608: the version records who authored it.
      createdBy: actor ?? null,
    });

    if (actor) {
      await this.audit({ action: 'create', actor, tenantId, policyId });
    }
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
  async update(
    tenantId: string,
    id: string,
    input: UpdatePolicyInput,
    actor?: string,
  ): Promise<PolicyEntity> {
    // Read, name check, version record and write happen as one repository
    // step so concurrent edits cannot mint duplicate versions or names (PRC-L478).
    const result = await this.repository.updateAtomically(id, tenantId, (existing) =>
      this.buildUpdate(id, existing, input, actor),
    );
    if (result.status === 'not_found') {
      throw new NotFoundError(`Policy with id '${id}' not found`);
    }
    if (result.status === 'name_conflict') {
      throw new ConflictError(`Policy with name '${input.name ?? ''}' already exists`);
    }
    if (actor) {
      await this.audit({ action: 'update', actor, tenantId, policyId: id });
    }
    return result.entity;
  }

  private buildUpdate(
    id: string,
    existing: PolicyEntity,
    input: UpdatePolicyInput,
    actor?: string,
  ): { data: Partial<PolicyEntity>; version?: Omit<PolicyVersionEntity, 'createdAt'> } {
    const updateData: Partial<PolicyEntity> = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.effectiveFrom !== undefined) updateData.effectiveFrom = new Date(input.effectiveFrom);
    if (input.effectiveUntil !== undefined)
      updateData.effectiveUntil = new Date(input.effectiveUntil);
    if (input.priority !== undefined) updateData.priority = input.priority;

    // If rules are changed, bump version and record the new version row
    if (input.rules !== undefined) {
      // PRC-M609: new rules must match the stored policy's type (type is immutable).
      assertRulesMatchType(existing.type, input.rules);
      const newVersion = existing.version + 1;
      updateData.rules = input.rules as Record<string, unknown>;
      updateData.version = newVersion;

      return {
        data: updateData,
        version: {
          id: uuidv4(),
          policyId: id,
          version: newVersion,
          rules: input.rules as Record<string, unknown>,
          effectiveFrom: input.effectiveFrom
            ? new Date(input.effectiveFrom)
            : existing.effectiveFrom,
          effectiveUntil: input.effectiveUntil
            ? new Date(input.effectiveUntil)
            : existing.effectiveUntil,
          createdBy: actor ?? null,
        },
      };
    }

    return { data: updateData };
  }

  /**
   * Activate a policy.
   *
   * @throws NotFoundError if policy not found
   * @throws BusinessRuleError if policy is already active
   */
  async activate(tenantId: string, id: string, actor?: string): Promise<PolicyEntity> {
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

    if (actor) {
      await this.audit({ action: 'activate', actor, tenantId, policyId: id });
    }
    return updated;
  }

  /**
   * Deactivate a policy.
   *
   * @throws NotFoundError if policy not found
   * @throws BusinessRuleError if policy is already inactive
   */
  async deactivate(tenantId: string, id: string, actor?: string): Promise<PolicyEntity> {
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

    if (actor) {
      await this.audit({ action: 'deactivate', actor, tenantId, policyId: id });
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
    actor?: string,
  ): Promise<PolicyAssignmentEntity> {
    const policy = await this.repository.findById(input.policyId, tenantId);
    if (!policy) {
      throw new NotFoundError(`Policy with id '${input.policyId}' not found`);
    }

    if (policy.status !== 'active') {
      throw new BusinessRuleError('Only active policies can be assigned');
    }

    // PRC-M609: the assignment target must match the policy scope, and the
    // target id must fit that scope (the evaluator looks tenant assignments up
    // by the tenant id and institution assignments by the institution id).
    if (input.targetType !== policy.scope) {
      throw new BusinessRuleError(
        `A ${policy.scope}-scope policy cannot be assigned to a ${input.targetType} target`,
      );
    }
    if (input.targetType === 'platform' && input.targetId) {
      throw new BusinessRuleError('A platform assignment takes no targetId');
    }
    if (input.targetType === 'tenant' && input.targetId !== tenantId) {
      throw new BusinessRuleError('A tenant assignment must target the current tenant');
    }
    if (input.targetType === 'institution' && !input.targetId) {
      throw new BusinessRuleError('An institution assignment needs a targetId');
    }

    const assignment = await this.repository.createAssignment({
      id: uuidv4(),
      policyId: input.policyId,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      tenantId,
    });

    if (actor) {
      await this.audit({
        action: 'assign',
        actor,
        tenantId,
        policyId: input.policyId,
        assignmentId: assignment.id,
      });
    }
    return assignment;
  }

  /**
   * Remove a policy assignment.
   *
   * @throws NotFoundError if assignment not found
   */
  async removeAssignment(
    tenantId: string,
    policyId: string,
    assignmentId: string,
    actor?: string,
  ): Promise<void> {
    // PRC-L487: the assignment must belong to the policy named in the URL path,
    // so a caller cannot delete an assignment of a different policy by guessing
    // an assignment id under an unrelated :id.
    const assignments = await this.repository.findAssignmentsByPolicy(policyId, tenantId);
    if (!assignments.some((a: PolicyAssignmentEntity) => a.id === assignmentId)) {
      throw new NotFoundError(
        `Assignment with id '${assignmentId}' not found for policy '${policyId}'`,
      );
    }
    const removed = await this.repository.removeAssignment(assignmentId, tenantId);
    if (!removed) {
      throw new NotFoundError(`Assignment with id '${assignmentId}' not found`);
    }

    if (actor) {
      await this.audit({ action: 'remove_assignment', actor, tenantId, policyId, assignmentId });
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
