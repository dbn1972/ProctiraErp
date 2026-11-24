/**
 * Policy Evaluation Engine
 *
 * Evaluates applicable policies for a given context using inheritance:
 *   platform → tenant → institution
 *
 * The engine resolves the effective policy by:
 * 1. Collecting policies at each scope level (platform, tenant, institution)
 * 2. Filtering by effective dates
 * 3. Resolving conflicts using priority (higher priority wins)
 * 4. Merging rules from all applicable levels: higher priority wins, then the
 *    more specific scope (PRC-M630); nested objects merge key by key
 *
 * Charter: Section 27 (Security and Compliance)
 */
import type { PolicyEntity, PolicyRepository } from './policy-repository.js';
import type { PolicyType, PolicyEvaluationResponse } from './schemas.js';

/**
 * Context for policy evaluation.
 */
export interface PolicyEvaluationContext {
  /** The type of policy to evaluate */
  type: PolicyType;
  /** Tenant ID (required for tenant and institution scope) */
  tenantId: string;
  /** Institution ID (required for institution scope) */
  institutionId?: string;
  /** Evaluation timestamp (defaults to now) */
  evaluationDate?: Date;
}

/**
 * Policy Evaluation Engine.
 *
 * Implements the inheritance chain: platform → tenant → institution.
 * More specific scopes override less specific ones.
 * Within the same scope, higher priority wins.
 */
export class PolicyEvaluationEngine {
  constructor(private readonly repository: PolicyRepository) {}

  /**
   * Evaluate the effective policy for a given context.
   *
   * Inheritance chain: platform → tenant → institution
   * - Platform policies apply to all tenants
   * - Tenant policies override platform policies
   * - Institution policies override tenant policies
   *
   * Within each level, the policy with the highest priority wins.
   * Rules are merged from all levels, with more specific scopes overriding.
   */
  async evaluate(context: PolicyEvaluationContext): Promise<PolicyEvaluationResponse> {
    const evaluationDate = context.evaluationDate ?? new Date();

    // Collect policies at each scope level
    const platformPolicy = await this.getPolicyAtScope(
      'platform',
      null,
      context.tenantId,
      context.type,
      evaluationDate,
    );

    const tenantPolicy = await this.getPolicyAtScope(
      'tenant',
      context.tenantId,
      context.tenantId,
      context.type,
      evaluationDate,
    );

    const institutionPolicy = context.institutionId
      ? await this.getPolicyAtScope(
          'institution',
          context.institutionId,
          context.tenantId,
          context.type,
          evaluationDate,
        )
      : null;

    // Build inheritance chain
    const inheritanceChain: PolicyEvaluationResponse['inheritanceChain'] = [
      {
        scope: 'platform' as const,
        policyId: platformPolicy?.id ?? null,
        policyName: platformPolicy?.name ?? null,
      },
      {
        scope: 'tenant' as const,
        policyId: tenantPolicy?.id ?? null,
        policyName: tenantPolicy?.name ?? null,
      },
      {
        scope: 'institution' as const,
        policyId: institutionPolicy?.id ?? null,
        policyName: institutionPolicy?.name ?? null,
      },
    ];

    // Merge rules: platform → tenant → institution (more specific overrides)
    const mergedRules = this.mergeRules([platformPolicy, tenantPolicy, institutionPolicy]);

    // Determine the effective policy (most specific non-null)
    const effectivePolicy = institutionPolicy ?? tenantPolicy ?? platformPolicy;

    return {
      effectivePolicy: effectivePolicy ? this.formatPolicyResponse(effectivePolicy) : null,
      inheritanceChain,
      mergedRules,
    };
  }

  /**
   * Get the highest-priority active policy at a specific scope level.
   */
  private async getPolicyAtScope(
    targetType: 'platform' | 'tenant' | 'institution',
    targetId: string | null,
    tenantId: string,
    policyType: PolicyType,
    evaluationDate: Date,
  ): Promise<PolicyEntity | null> {
    // Find assignments at this scope level
    const assignments = await this.repository.findAssignmentsByTarget(
      targetType,
      targetId,
      tenantId,
      policyType,
    );

    if (assignments.length === 0) return null;

    // Load the policies for these assignments
    const policies: PolicyEntity[] = [];
    for (const assignment of assignments) {
      const policy = await this.repository.findById(assignment.policyId, tenantId);
      if (policy && this.isPolicyEffective(policy, evaluationDate)) {
        policies.push(policy);
      }
    }

    if (policies.length === 0) return null;

    // Return the highest priority policy
    policies.sort((a, b) => b.priority - a.priority);
    return policies[0] ?? null;
  }

  /**
   * Check if a policy is currently effective based on dates and status.
   */
  private isPolicyEffective(policy: PolicyEntity, evaluationDate: Date): boolean {
    if (policy.status !== 'active') return false;

    if (policy.effectiveFrom && evaluationDate < policy.effectiveFrom) {
      return false;
    }

    if (policy.effectiveUntil && evaluationDate > policy.effectiveUntil) {
      return false;
    }

    return true;
  }

  /**
   * Merge rules from the inheritance chain (given in specificity order:
   * platform, tenant, institution). Null policies are skipped.
   *
   * PRC-M630: policies are applied in ascending priority, so a value from a
   * higher-priority policy is never overwritten by a lower-priority one at a
   * more specific scope; at equal priority the more specific scope wins. Nested
   * objects are merged key by key instead of being replaced wholesale.
   */
  private mergeRules(policies: (PolicyEntity | null)[]): Record<string, unknown> {
    const ordered = policies
      .map((policy, specificity) => ({ policy, specificity }))
      .filter((entry): entry is { policy: PolicyEntity; specificity: number } =>
        Boolean(entry.policy?.rules),
      )
      .sort((a, b) => a.policy.priority - b.policy.priority || a.specificity - b.specificity);

    let merged: Record<string, unknown> = {};
    for (const { policy } of ordered) {
      merged = deepMergeRules(merged, policy.rules);
    }
    return merged;
  }

  /**
   * Format a policy entity to the response shape.
   */
  private formatPolicyResponse(entity: PolicyEntity) {
    return {
      id: entity.id,
      name: entity.name,
      description: entity.description,
      type: entity.type,
      scope: entity.scope,
      status: entity.status,
      rules: entity.rules,
      version: entity.version,
      effectiveFrom: entity.effectiveFrom?.toISOString() ?? null,
      effectiveUntil: entity.effectiveUntil?.toISOString() ?? null,
      priority: entity.priority,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/** Deep-merge `override` onto `base` (arrays and scalars replace). Inputs are not mutated. */
function deepMergeRules(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (UNSAFE_KEYS.has(key)) continue;
    const current = result[key];
    result[key] =
      isPlainObject(current) && isPlainObject(value) ? deepMergeRules(current, value) : value;
  }
  return result;
}
