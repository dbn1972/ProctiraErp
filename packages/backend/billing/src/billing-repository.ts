/**
 * Billing Repository Interface
 *
 * Defines the data access contract for billing operations.
 * Implementations can use Prisma, in-memory stores, or other backends.
 *
 * Tables: billing_plans, billing_subscriptions, billing_entitlements, billing_usage
 * Charter: Section 10 (Subscription, Entitlements, Feature Control)
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import type {
  PlanStatus,
  PricingTier,
  SubscriptionStatus,
  PlanFeature,
  PlanQuota,
} from './schemas.js';

// ─── Entity Types ────────────────────────────────────────────────────────────

/**
 * Plan entity as stored in the billing_plans table.
 */
export interface PlanEntity {
  id: string;
  name: string;
  description: string | null;
  tier: PricingTier;
  status: PlanStatus;
  features: PlanFeature[];
  quotas: PlanQuota[];
  priceMonthly: number | null;
  priceYearly: number | null;
  trialDays: number;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Subscription entity as stored in the billing_subscriptions table.
 */
export interface SubscriptionEntity {
  id: string;
  tenantId: string;
  planId: string;
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelledAt: Date | null;
  previousPlanId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Entitlement entity as stored in the billing_entitlements table.
 * Represents a resolved entitlement for a tenant based on their subscription.
 */
export interface EntitlementEntity {
  id: string;
  tenantId: string;
  subscriptionId: string;
  featureKey: string;
  enabled: boolean;
  quotaLimit: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Usage entity as stored in the billing_usage table.
 */
export interface UsageEntity {
  id: string;
  tenantId: string;
  subscriptionId: string;
  metric: string;
  used: number;
  periodStart: Date;
  periodEnd: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Filter Types ────────────────────────────────────────────────────────────

/**
 * Filter options for listing plans.
 */
export interface PlanFilter {
  tier?: PricingTier;
  status?: PlanStatus;
  search?: string;
}

// ─── Repository Interface ────────────────────────────────────────────────────

/**
 * Repository interface for billing data access.
 */
export interface BillingRepository {
  // ─── Plan CRUD ───────────────────────────────────────────────────────────

  /** Create a new plan */
  createPlan(data: Omit<PlanEntity, 'createdAt' | 'updatedAt'>): Promise<PlanEntity>;

  /** Update an existing plan */
  updatePlan(id: string, data: Partial<PlanEntity>): Promise<PlanEntity | null>;

  /** Find a plan by ID */
  findPlanById(id: string): Promise<PlanEntity | null>;

  /** Find a plan by name (for uniqueness check) */
  findPlanByName(name: string): Promise<PlanEntity | null>;

  /** List plans with pagination and filtering */
  listPlans(
    filter: PlanFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<PlanEntity>>;

  /** Delete a plan */
  deletePlan(id: string): Promise<boolean>;

  // ─── Subscription CRUD ───────────────────────────────────────────────────

  /** Create a new subscription */
  createSubscription(data: Omit<SubscriptionEntity, 'createdAt' | 'updatedAt'>): Promise<SubscriptionEntity>;

  /** Update an existing subscription */
  updateSubscription(id: string, data: Partial<SubscriptionEntity>): Promise<SubscriptionEntity | null>;

  /** Find a subscription by ID */
  findSubscriptionById(id: string): Promise<SubscriptionEntity | null>;

  /** Find active subscription for a tenant */
  findActiveSubscription(tenantId: string): Promise<SubscriptionEntity | null>;

  /** Find all subscriptions for a tenant */
  findSubscriptionsByTenant(tenantId: string): Promise<SubscriptionEntity[]>;

  // ─── Entitlements ────────────────────────────────────────────────────────

  /** Create or update entitlements for a subscription */
  upsertEntitlements(entitlements: Omit<EntitlementEntity, 'createdAt' | 'updatedAt'>[]): Promise<EntitlementEntity[]>;

  /** Find entitlements for a tenant */
  findEntitlementsByTenant(tenantId: string): Promise<EntitlementEntity[]>;

  /** Find a specific entitlement by tenant and feature key */
  findEntitlement(tenantId: string, featureKey: string): Promise<EntitlementEntity | null>;

  /** Delete entitlements for a subscription */
  deleteEntitlementsBySubscription(subscriptionId: string): Promise<void>;

  // ─── Usage Tracking ──────────────────────────────────────────────────────

  /** Get or create a usage record for the current period */
  getOrCreateUsage(
    tenantId: string,
    subscriptionId: string,
    metric: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<UsageEntity>;

  /** Increment usage for a metric */
  incrementUsage(id: string, increment: number): Promise<UsageEntity>;

  /** Get usage for a tenant and metric in a period */
  getUsage(tenantId: string, metric: string, periodStart: Date, periodEnd: Date): Promise<UsageEntity | null>;

  /** Get all usage records for a tenant in a period */
  getUsageByTenant(tenantId: string, periodStart: Date, periodEnd: Date): Promise<UsageEntity[]>;
}
