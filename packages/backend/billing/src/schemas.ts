/**
 * Typebox schemas for Billing Service request/response validation.
 *
 * Defines schemas for:
 * - Plan management (create, update, list)
 * - Subscription lifecycle (subscribe, upgrade, downgrade, cancel)
 * - Entitlement checking (feature flags, quotas)
 * - Usage tracking and quota enforcement
 *
 * Charter: Section 10 (Subscription, Entitlements, Feature Control)
 */
import { Type, type Static } from '@sinclair/typebox';

// ─── Plan Types ──────────────────────────────────────────────────────────────

/**
 * Subscription status values.
 */
export const SubscriptionStatusEnum = Type.Union([
  Type.Literal('trial'),
  Type.Literal('active'),
  Type.Literal('suspended'),
  Type.Literal('cancelled'),
]);

export type SubscriptionStatus = Static<typeof SubscriptionStatusEnum>;

/**
 * Plan status values.
 */
export const PlanStatusEnum = Type.Union([
  Type.Literal('draft'),
  Type.Literal('active'),
  Type.Literal('deprecated'),
  Type.Literal('archived'),
]);

export type PlanStatus = Static<typeof PlanStatusEnum>;

/**
 * Pricing tier model.
 */
export const PricingTierEnum = Type.Union([
  Type.Literal('free'),
  Type.Literal('starter'),
  Type.Literal('professional'),
  Type.Literal('enterprise'),
  Type.Literal('custom'),
]);

export type PricingTier = Static<typeof PricingTierEnum>;

/**
 * Entitlement type (feature flag or quota).
 */
export const EntitlementTypeEnum = Type.Union([
  Type.Literal('feature_flag'),
  Type.Literal('quota'),
]);

export type EntitlementType = Static<typeof EntitlementTypeEnum>;

// ─── Feature Definition Schema ───────────────────────────────────────────────

/**
 * A feature included in a plan.
 */
export const PlanFeatureSchema = Type.Object({
  featureKey: Type.String({ minLength: 1, maxLength: 100, description: 'Unique feature identifier (e.g., "custom_fields", "bulk_import")' }),
  enabled: Type.Boolean({ description: 'Whether this feature is enabled in the plan' }),
  description: Type.Optional(Type.String({ maxLength: 500, description: 'Human-readable feature description' })),
});

export type PlanFeature = Static<typeof PlanFeatureSchema>;

/**
 * A quota limit included in a plan.
 */
export const PlanQuotaSchema = Type.Object({
  metric: Type.String({ minLength: 1, maxLength: 100, description: 'Quota metric key (e.g., "students", "institutions", "api_calls_per_day")' }),
  limit: Type.Number({ minimum: 0, description: 'Maximum allowed value (-1 for unlimited)' }),
  description: Type.Optional(Type.String({ maxLength: 500, description: 'Human-readable quota description' })),
});

export type PlanQuota = Static<typeof PlanQuotaSchema>;

// ─── Plan CRUD Schemas ───────────────────────────────────────────────────────

/**
 * Schema for creating a new plan.
 */
export const CreatePlanSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255, description: 'Plan name' }),
  description: Type.Optional(Type.String({ maxLength: 1000, description: 'Plan description' })),
  tier: PricingTierEnum,
  features: Type.Array(PlanFeatureSchema, { description: 'Features included in this plan' }),
  quotas: Type.Array(PlanQuotaSchema, { description: 'Quota limits for this plan' }),
  priceMonthly: Type.Optional(Type.Number({ minimum: 0, description: 'Monthly price in cents' })),
  priceYearly: Type.Optional(Type.Number({ minimum: 0, description: 'Yearly price in cents' })),
  trialDays: Type.Optional(Type.Number({ minimum: 0, maximum: 365, default: 0, description: 'Number of trial days' })),
  sortOrder: Type.Optional(Type.Number({ minimum: 0, default: 0, description: 'Display sort order' })),
});

export type CreatePlanInput = Static<typeof CreatePlanSchema>;

/**
 * Schema for updating an existing plan.
 */
export const UpdatePlanSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 255, description: 'Plan name' })),
  description: Type.Optional(Type.String({ maxLength: 1000, description: 'Plan description' })),
  features: Type.Optional(Type.Array(PlanFeatureSchema, { description: 'Features included in this plan' })),
  quotas: Type.Optional(Type.Array(PlanQuotaSchema, { description: 'Quota limits for this plan' })),
  priceMonthly: Type.Optional(Type.Number({ minimum: 0, description: 'Monthly price in cents' })),
  priceYearly: Type.Optional(Type.Number({ minimum: 0, description: 'Yearly price in cents' })),
  trialDays: Type.Optional(Type.Number({ minimum: 0, maximum: 365, description: 'Number of trial days' })),
  sortOrder: Type.Optional(Type.Number({ minimum: 0, description: 'Display sort order' })),
  status: Type.Optional(PlanStatusEnum),
});

export type UpdatePlanInput = Static<typeof UpdatePlanSchema>;

/**
 * Schema for plan ID path parameter.
 */
export const PlanParamsSchema = Type.Object({
  id: Type.String({
    pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    description: 'Plan UUID',
  }),
});

export type PlanParams = Static<typeof PlanParamsSchema>;

/**
 * Schema for plan list query parameters.
 */
export const PlanListQuerySchema = Type.Object({
  page: Type.Optional(Type.Number({ minimum: 1, default: 1, description: 'Page number (1-based)' })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20, description: 'Items per page' })),
  tier: Type.Optional(PricingTierEnum),
  status: Type.Optional(PlanStatusEnum),
  search: Type.Optional(Type.String({ description: 'Search by name or description' })),
  sortBy: Type.Optional(Type.String({ enum: ['name', 'tier', 'createdAt', 'sortOrder'], default: 'sortOrder', description: 'Sort field' })),
  sortOrder: Type.Optional(Type.String({ enum: ['asc', 'desc'], default: 'asc', description: 'Sort direction' })),
});

export type PlanListQuery = Static<typeof PlanListQuerySchema>;

// ─── Subscription Schemas ────────────────────────────────────────────────────

/**
 * Schema for subscribing a tenant to a plan.
 */
export const CreateSubscriptionSchema = Type.Object({
  tenantId: Type.String({
    pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    description: 'Tenant UUID',
  }),
  planId: Type.String({
    pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    description: 'Plan UUID',
  }),
  startTrial: Type.Optional(Type.Boolean({ default: false, description: 'Whether to start with a trial period' })),
});

export type CreateSubscriptionInput = Static<typeof CreateSubscriptionSchema>;

/**
 * Schema for subscription ID path parameter.
 */
export const SubscriptionParamsSchema = Type.Object({
  id: Type.String({
    pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    description: 'Subscription UUID',
  }),
});

export type SubscriptionParams = Static<typeof SubscriptionParamsSchema>;

/**
 * Schema for plan change (upgrade/downgrade).
 */
export const ChangePlanSchema = Type.Object({
  newPlanId: Type.String({
    pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    description: 'New plan UUID to switch to',
  }),
});

export type ChangePlanInput = Static<typeof ChangePlanSchema>;

// ─── Entitlement Schemas ─────────────────────────────────────────────────────

/**
 * Schema for checking entitlement.
 */
export const CheckEntitlementSchema = Type.Object({
  tenantId: Type.String({
    pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    description: 'Tenant UUID',
  }),
  feature: Type.String({ minLength: 1, maxLength: 100, description: 'Feature key to check' }),
});

export type CheckEntitlementInput = Static<typeof CheckEntitlementSchema>;

/**
 * Schema for recording usage.
 */
export const RecordUsageSchema = Type.Object({
  tenantId: Type.String({
    pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    description: 'Tenant UUID',
  }),
  metric: Type.String({ minLength: 1, maxLength: 100, description: 'Usage metric key' }),
  increment: Type.Number({ minimum: 1, description: 'Amount to increment usage by' }),
});

export type RecordUsageInput = Static<typeof RecordUsageSchema>;

/**
 * Schema for getting usage.
 */
export const GetUsageSchema = Type.Object({
  tenantId: Type.String({
    pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    description: 'Tenant UUID',
  }),
  metric: Type.String({ minLength: 1, maxLength: 100, description: 'Usage metric key' }),
  periodStart: Type.Optional(Type.String({ format: 'date-time', description: 'Period start (ISO 8601)' })),
  periodEnd: Type.Optional(Type.String({ format: 'date-time', description: 'Period end (ISO 8601)' })),
});

export type GetUsageInput = Static<typeof GetUsageSchema>;

// ─── Response Schemas ────────────────────────────────────────────────────────

/**
 * Schema for plan response object.
 */
export const PlanResponseSchema = Type.Object({
  id: Type.String({ description: 'Plan UUID' }),
  name: Type.String({ description: 'Plan name' }),
  description: Type.Union([Type.String(), Type.Null()], { description: 'Plan description' }),
  tier: PricingTierEnum,
  status: PlanStatusEnum,
  features: Type.Array(PlanFeatureSchema, { description: 'Features included' }),
  quotas: Type.Array(PlanQuotaSchema, { description: 'Quota limits' }),
  priceMonthly: Type.Union([Type.Number(), Type.Null()], { description: 'Monthly price in cents' }),
  priceYearly: Type.Union([Type.Number(), Type.Null()], { description: 'Yearly price in cents' }),
  trialDays: Type.Number({ description: 'Trial period in days' }),
  sortOrder: Type.Number({ description: 'Display sort order' }),
  createdAt: Type.String({ description: 'Creation timestamp (ISO 8601)' }),
  updatedAt: Type.String({ description: 'Last update timestamp (ISO 8601)' }),
});

export type PlanResponse = Static<typeof PlanResponseSchema>;

/**
 * Schema for paginated plan list response.
 */
export const PlanListResponseSchema = Type.Object({
  data: Type.Array(PlanResponseSchema),
  meta: Type.Object({
    page: Type.Number({ description: 'Current page number' }),
    pageSize: Type.Number({ description: 'Items per page' }),
    totalItems: Type.Number({ description: 'Total number of items' }),
    totalPages: Type.Number({ description: 'Total number of pages' }),
  }),
});

export type PlanListResponse = Static<typeof PlanListResponseSchema>;

/**
 * Schema for subscription response object.
 */
export const SubscriptionResponseSchema = Type.Object({
  id: Type.String({ description: 'Subscription UUID' }),
  tenantId: Type.String({ description: 'Tenant UUID' }),
  planId: Type.String({ description: 'Plan UUID' }),
  planName: Type.String({ description: 'Plan name' }),
  status: SubscriptionStatusEnum,
  trialEndsAt: Type.Union([Type.String(), Type.Null()], { description: 'Trial end date (ISO 8601)' }),
  currentPeriodStart: Type.String({ description: 'Current billing period start (ISO 8601)' }),
  currentPeriodEnd: Type.String({ description: 'Current billing period end (ISO 8601)' }),
  cancelledAt: Type.Union([Type.String(), Type.Null()], { description: 'Cancellation date (ISO 8601)' }),
  previousPlanId: Type.Union([Type.String(), Type.Null()], { description: 'Previous plan UUID (for upgrades/downgrades)' }),
  createdAt: Type.String({ description: 'Creation timestamp (ISO 8601)' }),
  updatedAt: Type.String({ description: 'Last update timestamp (ISO 8601)' }),
});

export type SubscriptionResponse = Static<typeof SubscriptionResponseSchema>;

/**
 * Schema for entitlement check response.
 */
export const EntitlementResponseSchema = Type.Object({
  allowed: Type.Boolean({ description: 'Whether the feature/quota is allowed' }),
  reason: Type.Optional(Type.String({ description: 'Reason for denial' })),
  quota: Type.Optional(Type.Object({
    used: Type.Number({ description: 'Current usage' }),
    limit: Type.Number({ description: 'Maximum allowed (-1 for unlimited)' }),
  })),
  featureFlag: Type.Optional(Type.Boolean({ description: 'Feature flag value' })),
});

export type EntitlementResponse = Static<typeof EntitlementResponseSchema>;

/**
 * Schema for usage response.
 */
export const UsageResponseSchema = Type.Object({
  tenantId: Type.String({ description: 'Tenant UUID' }),
  metric: Type.String({ description: 'Usage metric key' }),
  used: Type.Number({ description: 'Current usage in period' }),
  limit: Type.Number({ description: 'Quota limit (-1 for unlimited)' }),
  periodStart: Type.String({ description: 'Period start (ISO 8601)' }),
  periodEnd: Type.String({ description: 'Period end (ISO 8601)' }),
});

export type UsageResponse = Static<typeof UsageResponseSchema>;

/**
 * Schema for quota enforcement response.
 */
export const QuotaResultSchema = Type.Object({
  allowed: Type.Boolean({ description: 'Whether the increment is within quota' }),
  used: Type.Number({ description: 'Usage after increment (if allowed)' }),
  limit: Type.Number({ description: 'Quota limit' }),
  remaining: Type.Number({ description: 'Remaining quota' }),
  reason: Type.Optional(Type.String({ description: 'Reason for denial' })),
});

export type QuotaResult = Static<typeof QuotaResultSchema>;

/**
 * Schema for downgrade result (includes data impact warnings).
 */
export const DowngradeResultSchema = Type.Object({
  subscription: SubscriptionResponseSchema,
  warnings: Type.Array(Type.Object({
    metric: Type.String({ description: 'Affected metric' }),
    currentUsage: Type.Number({ description: 'Current usage' }),
    newLimit: Type.Number({ description: 'New plan limit' }),
    message: Type.String({ description: 'Warning message' }),
  }), { description: 'Warnings about data that may exceed new plan limits' }),
});

export type DowngradeResult = Static<typeof DowngradeResultSchema>;
