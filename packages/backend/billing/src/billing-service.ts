/**
 * Billing Service
 *
 * Business logic for plan management, subscription lifecycle,
 * entitlement checking, and usage tracking.
 *
 * Key invariants:
 * - A tenant can have at most one active/trial subscription
 * - Plan upgrades/downgrades never silently lose data
 * - Entitlements are derived from the active subscription's plan
 * - Usage is tracked per metric per billing period
 *
 * Charter: Section 10 (Subscription, Entitlements, Feature Control)
 */
import {
  ConflictError,
  NotFoundError,
  BusinessRuleError,
} from '@proctira/common';
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type {
  PlanEntity,
  SubscriptionEntity,
  EntitlementEntity,
  UsageEntity,
  PlanFilter,
  BillingRepository,
} from './billing-repository.js';
import type {
  CreatePlanInput,
  UpdatePlanInput,
  CreateSubscriptionInput,
  ChangePlanInput,
  EntitlementResponse,
  QuotaResult,
  UsageResponse,
  DowngradeResult,
} from './schemas.js';

/**
 * Service handling billing business logic.
 */
export class BillingService {
  constructor(private readonly repository: BillingRepository) {}

  // ─── Plan Management ─────────────────────────────────────────────────────

  /**
   * Create a new billing plan.
   *
   * Validates:
   * - Plan name is unique
   * - Features and quotas are well-formed
   *
   * @throws ConflictError if name already exists
   */
  async createPlan(input: CreatePlanInput): Promise<PlanEntity> {
    const existingByName = await this.repository.findPlanByName(input.name);
    if (existingByName) {
      throw new ConflictError(`Plan with name '${input.name}' already exists`);
    }

    const plan: Omit<PlanEntity, 'createdAt' | 'updatedAt'> = {
      id: uuidv4(),
      name: input.name,
      description: input.description ?? null,
      tier: input.tier,
      status: 'draft',
      features: input.features,
      quotas: input.quotas,
      priceMonthly: input.priceMonthly ?? null,
      priceYearly: input.priceYearly ?? null,
      trialDays: input.trialDays ?? 0,
      sortOrder: input.sortOrder ?? 0,
    };

    return this.repository.createPlan(plan);
  }

  /**
   * Update an existing plan.
   *
   * @throws NotFoundError if plan not found
   * @throws ConflictError if name conflicts with another plan
   * @throws BusinessRuleError if trying to modify an archived plan
   */
  async updatePlan(id: string, input: UpdatePlanInput): Promise<PlanEntity> {
    const existing = await this.repository.findPlanById(id);
    if (!existing) {
      throw new NotFoundError(`Plan with id '${id}' not found`);
    }

    if (existing.status === 'archived') {
      throw new BusinessRuleError('Cannot modify an archived plan');
    }

    if (input.name && input.name !== existing.name) {
      const existingByName = await this.repository.findPlanByName(input.name);
      if (existingByName && existingByName.id !== id) {
        throw new ConflictError(`Plan with name '${input.name}' already exists`);
      }
    }

    const updateData: Partial<PlanEntity> = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.features !== undefined) updateData.features = input.features;
    if (input.quotas !== undefined) updateData.quotas = input.quotas;
    if (input.priceMonthly !== undefined) updateData.priceMonthly = input.priceMonthly;
    if (input.priceYearly !== undefined) updateData.priceYearly = input.priceYearly;
    if (input.trialDays !== undefined) updateData.trialDays = input.trialDays;
    if (input.sortOrder !== undefined) updateData.sortOrder = input.sortOrder;
    if (input.status !== undefined) updateData.status = input.status;

    const updated = await this.repository.updatePlan(id, updateData);
    if (!updated) {
      throw new NotFoundError(`Plan with id '${id}' not found`);
    }

    return updated;
  }

  /**
   * Get a single plan by ID.
   *
   * @throws NotFoundError if plan not found
   */
  async getPlanById(id: string): Promise<PlanEntity> {
    const plan = await this.repository.findPlanById(id);
    if (!plan) {
      throw new NotFoundError(`Plan with id '${id}' not found`);
    }
    return plan;
  }

  /**
   * List plans with pagination and filtering.
   */
  async listPlans(
    filter: PlanFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<PlanEntity>> {
    return this.repository.listPlans(filter, pagination);
  }

  // ─── Subscription Lifecycle ──────────────────────────────────────────────

  /**
   * Subscribe a tenant to a plan.
   *
   * If the plan has trial days and startTrial is true, the subscription
   * starts in 'trial' status. Otherwise it starts as 'active'.
   *
   * @throws NotFoundError if plan not found
   * @throws BusinessRuleError if plan is not active
   * @throws ConflictError if tenant already has an active subscription
   */
  async subscribeTenant(input: CreateSubscriptionInput): Promise<SubscriptionEntity> {
    const plan = await this.repository.findPlanById(input.planId);
    if (!plan) {
      throw new NotFoundError(`Plan with id '${input.planId}' not found`);
    }

    if (plan.status !== 'active') {
      throw new BusinessRuleError('Can only subscribe to active plans');
    }

    const existingSubscription = await this.repository.findActiveSubscription(input.tenantId);
    if (existingSubscription) {
      throw new ConflictError('Tenant already has an active subscription. Use upgrade/downgrade to change plans.');
    }

    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    const startTrial = input.startTrial && plan.trialDays > 0;
    let trialEndsAt: Date | null = null;
    if (startTrial) {
      trialEndsAt = new Date(now);
      trialEndsAt.setDate(trialEndsAt.getDate() + plan.trialDays);
    }

    const subscription = await this.repository.createSubscription({
      id: uuidv4(),
      tenantId: input.tenantId,
      planId: input.planId,
      status: startTrial ? 'trial' : 'active',
      trialEndsAt,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      cancelledAt: null,
      previousPlanId: null,
    });

    // Provision entitlements from the plan
    await this.provisionEntitlements(input.tenantId, subscription.id, plan);

    return subscription;
  }

  /**
   * Activate a subscription (e.g., after trial ends and payment confirmed).
   *
   * @throws NotFoundError if subscription not found
   * @throws BusinessRuleError if subscription is not in trial status
   */
  async activateSubscription(subscriptionId: string): Promise<SubscriptionEntity> {
    const subscription = await this.repository.findSubscriptionById(subscriptionId);
    if (!subscription) {
      throw new NotFoundError(`Subscription with id '${subscriptionId}' not found`);
    }

    if (subscription.status !== 'trial') {
      throw new BusinessRuleError('Only trial subscriptions can be activated');
    }

    const updated = await this.repository.updateSubscription(subscriptionId, {
      status: 'active',
      trialEndsAt: null,
    });

    return updated!;
  }

  /**
   * Suspend a subscription (e.g., for non-payment).
   *
   * @throws NotFoundError if subscription not found
   * @throws BusinessRuleError if subscription is not active or trial
   */
  async suspendSubscription(subscriptionId: string): Promise<SubscriptionEntity> {
    const subscription = await this.repository.findSubscriptionById(subscriptionId);
    if (!subscription) {
      throw new NotFoundError(`Subscription with id '${subscriptionId}' not found`);
    }

    if (subscription.status !== 'active' && subscription.status !== 'trial') {
      throw new BusinessRuleError('Only active or trial subscriptions can be suspended');
    }

    const updated = await this.repository.updateSubscription(subscriptionId, {
      status: 'suspended',
    });

    return updated!;
  }

  /**
   * Cancel a subscription.
   *
   * @throws NotFoundError if subscription not found
   * @throws BusinessRuleError if subscription is already cancelled
   */
  async cancelSubscription(subscriptionId: string): Promise<SubscriptionEntity> {
    const subscription = await this.repository.findSubscriptionById(subscriptionId);
    if (!subscription) {
      throw new NotFoundError(`Subscription with id '${subscriptionId}' not found`);
    }

    if (subscription.status === 'cancelled') {
      throw new BusinessRuleError('Subscription is already cancelled');
    }

    const updated = await this.repository.updateSubscription(subscriptionId, {
      status: 'cancelled',
      cancelledAt: new Date(),
    });

    return updated!;
  }

  /**
   * Reactivate a suspended subscription.
   *
   * @throws NotFoundError if subscription not found
   * @throws BusinessRuleError if subscription is not suspended
   */
  async reactivateSubscription(subscriptionId: string): Promise<SubscriptionEntity> {
    const subscription = await this.repository.findSubscriptionById(subscriptionId);
    if (!subscription) {
      throw new NotFoundError(`Subscription with id '${subscriptionId}' not found`);
    }

    if (subscription.status !== 'suspended') {
      throw new BusinessRuleError('Only suspended subscriptions can be reactivated');
    }

    const updated = await this.repository.updateSubscription(subscriptionId, {
      status: 'active',
    });

    return updated!;
  }

  /**
   * Get a subscription by ID.
   *
   * @throws NotFoundError if subscription not found
   */
  async getSubscription(subscriptionId: string): Promise<SubscriptionEntity> {
    const subscription = await this.repository.findSubscriptionById(subscriptionId);
    if (!subscription) {
      throw new NotFoundError(`Subscription with id '${subscriptionId}' not found`);
    }
    return subscription;
  }

  /**
   * Get the active subscription for a tenant.
   *
   * @throws NotFoundError if no active subscription found
   */
  async getActiveSubscription(tenantId: string): Promise<SubscriptionEntity> {
    const subscription = await this.repository.findActiveSubscription(tenantId);
    if (!subscription) {
      throw new NotFoundError(`No active subscription found for tenant '${tenantId}'`);
    }
    return subscription;
  }

  // ─── Plan Changes (Upgrade/Downgrade) ────────────────────────────────────

  /**
   * Upgrade a tenant's plan.
   *
   * Upgrades are immediate. Entitlements are re-provisioned from the new plan.
   *
   * @throws NotFoundError if tenant has no active subscription or plan not found
   * @throws BusinessRuleError if new plan is not a higher tier
   */
  async upgradePlan(tenantId: string, input: ChangePlanInput): Promise<SubscriptionEntity> {
    const subscription = await this.repository.findActiveSubscription(tenantId);
    if (!subscription) {
      throw new NotFoundError(`No active subscription found for tenant '${tenantId}'`);
    }

    const currentPlan = await this.repository.findPlanById(subscription.planId);
    const newPlan = await this.repository.findPlanById(input.newPlanId);

    if (!newPlan) {
      throw new NotFoundError(`Plan with id '${input.newPlanId}' not found`);
    }

    if (newPlan.status !== 'active') {
      throw new BusinessRuleError('Can only upgrade to active plans');
    }

    if (currentPlan && this.getTierRank(newPlan.tier) <= this.getTierRank(currentPlan.tier)) {
      throw new BusinessRuleError('Upgrade requires a higher tier plan. Use downgrade for lower tier plans.');
    }

    const previousPlanId = subscription.planId;

    const updated = await this.repository.updateSubscription(subscription.id, {
      planId: input.newPlanId,
      previousPlanId,
    });

    // Re-provision entitlements from the new plan
    await this.repository.deleteEntitlementsBySubscription(subscription.id);
    await this.provisionEntitlements(tenantId, subscription.id, newPlan);

    return updated!;
  }

  /**
   * Downgrade a tenant's plan.
   *
   * Downgrades include warnings about data that may exceed new plan limits.
   * Data is NEVER silently lost — warnings are returned to the caller.
   *
   * @throws NotFoundError if tenant has no active subscription or plan not found
   * @throws BusinessRuleError if new plan is not a lower tier
   */
  async downgradePlan(tenantId: string, input: ChangePlanInput): Promise<DowngradeResult> {
    const subscription = await this.repository.findActiveSubscription(tenantId);
    if (!subscription) {
      throw new NotFoundError(`No active subscription found for tenant '${tenantId}'`);
    }

    const currentPlan = await this.repository.findPlanById(subscription.planId);
    const newPlan = await this.repository.findPlanById(input.newPlanId);

    if (!newPlan) {
      throw new NotFoundError(`Plan with id '${input.newPlanId}' not found`);
    }

    if (newPlan.status !== 'active') {
      throw new BusinessRuleError('Can only downgrade to active plans');
    }

    if (currentPlan && this.getTierRank(newPlan.tier) >= this.getTierRank(currentPlan.tier)) {
      throw new BusinessRuleError('Downgrade requires a lower tier plan. Use upgrade for higher tier plans.');
    }

    // Check for data that would exceed new plan limits
    const warnings: DowngradeResult['warnings'] = [];
    const usageRecords = await this.repository.getUsageByTenant(
      tenantId,
      subscription.currentPeriodStart,
      subscription.currentPeriodEnd,
    );

    for (const newQuota of newPlan.quotas) {
      if (newQuota.limit === -1) continue; // Unlimited, no concern

      const usageRecord = usageRecords.find((u) => u.metric === newQuota.metric);
      if (usageRecord && usageRecord.used > newQuota.limit) {
        warnings.push({
          metric: newQuota.metric,
          currentUsage: usageRecord.used,
          newLimit: newQuota.limit,
          message: `Current usage (${usageRecord.used}) exceeds new plan limit (${newQuota.limit}) for '${newQuota.metric}'. Existing data will be preserved but new additions may be blocked.`,
        });
      }
    }

    const previousPlanId = subscription.planId;

    const updated = await this.repository.updateSubscription(subscription.id, {
      planId: input.newPlanId,
      previousPlanId,
    });

    // Re-provision entitlements from the new plan
    await this.repository.deleteEntitlementsBySubscription(subscription.id);
    await this.provisionEntitlements(tenantId, subscription.id, newPlan);

    return {
      subscription: this.formatSubscriptionResponse(updated!, newPlan.name),
      warnings,
    };
  }

  // ─── Entitlement Checking ────────────────────────────────────────────────

  /**
   * Check if a tenant is entitled to a feature.
   *
   * Checks both feature flags and quota-based entitlements.
   */
  async checkEntitlement(tenantId: string, feature: string): Promise<EntitlementResponse> {
    const subscription = await this.repository.findActiveSubscription(tenantId);
    if (!subscription) {
      return {
        allowed: false,
        reason: 'No active subscription',
      };
    }

    // Check if subscription is suspended
    if (subscription.status === 'suspended') {
      return {
        allowed: false,
        reason: 'Subscription is suspended',
      };
    }

    const entitlement = await this.repository.findEntitlement(tenantId, feature);
    if (!entitlement) {
      return {
        allowed: false,
        reason: `Feature '${feature}' is not included in the current plan`,
      };
    }

    if (!entitlement.enabled) {
      return {
        allowed: false,
        reason: `Feature '${feature}' is disabled in the current plan`,
        featureFlag: false,
      };
    }

    // If it's a quota-based entitlement, check usage
    if (entitlement.quotaLimit !== null) {
      const usage = await this.repository.getUsage(
        tenantId,
        feature,
        subscription.currentPeriodStart,
        subscription.currentPeriodEnd,
      );

      const used = usage?.used ?? 0;
      const limit = entitlement.quotaLimit;

      if (limit !== -1 && used >= limit) {
        return {
          allowed: false,
          reason: `Quota exceeded for '${feature}' (${used}/${limit})`,
          quota: { used, limit },
        };
      }

      return {
        allowed: true,
        quota: { used, limit },
      };
    }

    return {
      allowed: true,
      featureFlag: true,
    };
  }

  // ─── Usage Tracking ──────────────────────────────────────────────────────

  /**
   * Record usage for a metric and enforce quota.
   *
   * @throws NotFoundError if tenant has no active subscription
   * @returns QuotaResult indicating whether the increment was allowed
   */
  async enforceQuota(tenantId: string, metric: string, increment: number): Promise<QuotaResult> {
    const subscription = await this.repository.findActiveSubscription(tenantId);
    if (!subscription) {
      return {
        allowed: false,
        used: 0,
        limit: 0,
        remaining: 0,
        reason: 'No active subscription',
      };
    }

    // Find the quota limit for this metric
    const entitlement = await this.repository.findEntitlement(tenantId, metric);
    const limit = entitlement?.quotaLimit ?? 0;

    // Get or create usage record for current period
    const usage = await this.repository.getOrCreateUsage(
      tenantId,
      subscription.id,
      metric,
      subscription.currentPeriodStart,
      subscription.currentPeriodEnd,
    );

    // Unlimited quota
    if (limit === -1) {
      const updated = await this.repository.incrementUsage(usage.id, increment);
      return {
        allowed: true,
        used: updated.used,
        limit: -1,
        remaining: -1,
      };
    }

    // Check if increment would exceed quota
    if (usage.used + increment > limit) {
      return {
        allowed: false,
        used: usage.used,
        limit,
        remaining: Math.max(0, limit - usage.used),
        reason: `Quota would be exceeded: ${usage.used + increment} > ${limit}`,
      };
    }

    const updated = await this.repository.incrementUsage(usage.id, increment);
    return {
      allowed: true,
      used: updated.used,
      limit,
      remaining: Math.max(0, limit - updated.used),
    };
  }

  /**
   * Get usage for a tenant and metric.
   */
  async getUsage(tenantId: string, metric: string, periodStart?: Date, periodEnd?: Date): Promise<UsageResponse> {
    const subscription = await this.repository.findActiveSubscription(tenantId);
    if (!subscription) {
      throw new NotFoundError(`No active subscription found for tenant '${tenantId}'`);
    }

    const start = periodStart ?? subscription.currentPeriodStart;
    const end = periodEnd ?? subscription.currentPeriodEnd;

    const usage = await this.repository.getUsage(tenantId, metric, start, end);
    const entitlement = await this.repository.findEntitlement(tenantId, metric);

    return {
      tenantId,
      metric,
      used: usage?.used ?? 0,
      limit: entitlement?.quotaLimit ?? 0,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
    };
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  /**
   * Provision entitlements for a tenant based on a plan's features and quotas.
   */
  private async provisionEntitlements(
    tenantId: string,
    subscriptionId: string,
    plan: PlanEntity,
  ): Promise<void> {
    const entitlements: Omit<EntitlementEntity, 'createdAt' | 'updatedAt'>[] = [];

    // Add feature flag entitlements
    for (const feature of plan.features) {
      entitlements.push({
        id: uuidv4(),
        tenantId,
        subscriptionId,
        featureKey: feature.featureKey,
        enabled: feature.enabled,
        quotaLimit: null,
      });
    }

    // Add quota entitlements
    for (const quota of plan.quotas) {
      entitlements.push({
        id: uuidv4(),
        tenantId,
        subscriptionId,
        featureKey: quota.metric,
        enabled: true,
        quotaLimit: quota.limit,
      });
    }

    await this.repository.upsertEntitlements(entitlements);
  }

  /**
   * Get numeric rank for a pricing tier (for upgrade/downgrade comparison).
   */
  private getTierRank(tier: string): number {
    const ranks: Record<string, number> = {
      free: 0,
      starter: 1,
      professional: 2,
      enterprise: 3,
      custom: 4,
    };
    return ranks[tier] ?? 0;
  }

  /**
   * Format a subscription entity for API response.
   */
  formatSubscriptionResponse(entity: SubscriptionEntity, planName: string) {
    return {
      id: entity.id,
      tenantId: entity.tenantId,
      planId: entity.planId,
      planName,
      status: entity.status,
      trialEndsAt: entity.trialEndsAt?.toISOString() ?? null,
      currentPeriodStart: entity.currentPeriodStart.toISOString(),
      currentPeriodEnd: entity.currentPeriodEnd.toISOString(),
      cancelledAt: entity.cancelledAt?.toISOString() ?? null,
      previousPlanId: entity.previousPlanId,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }
}
