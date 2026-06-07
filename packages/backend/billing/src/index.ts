/**
 * @proctira/backend-billing - Billing and Entitlement Service
 *
 * Provides billing management with:
 * - Plan definition (features, quotas, pricing tiers)
 * - Tenant subscription lifecycle (trial, active, suspended, cancelled)
 * - Entitlement checking (feature flags, usage quotas)
 * - Usage tracking and quota enforcement
 * - Plan upgrades and downgrades (data never silently lost)
 *
 * Charter: Section 10 (Subscription, Entitlements, Feature Control)
 */

// Plugin
export { billingPlugin } from './billing-plugin.js';
export type { BillingPluginOptions } from './billing-plugin.js';

// Service
export { BillingService } from './billing-service.js';

// Repository
export type {
  PlanEntity,
  SubscriptionEntity,
  EntitlementEntity,
  UsageEntity,
  PlanFilter,
  BillingRepository,
} from './billing-repository.js';

// In-memory repository (for testing)
export { InMemoryBillingRepository } from './in-memory-repository.js';

// Schemas
export {
  SubscriptionStatusEnum,
  PlanStatusEnum,
  PricingTierEnum,
  EntitlementTypeEnum,
  PlanFeatureSchema,
  PlanQuotaSchema,
  CreatePlanSchema,
  UpdatePlanSchema,
  PlanParamsSchema,
  PlanListQuerySchema,
  CreateSubscriptionSchema,
  SubscriptionParamsSchema,
  ChangePlanSchema,
  CheckEntitlementSchema,
  RecordUsageSchema,
  GetUsageSchema,
  PlanResponseSchema,
  PlanListResponseSchema,
  SubscriptionResponseSchema,
  EntitlementResponseSchema,
  UsageResponseSchema,
  QuotaResultSchema,
  DowngradeResultSchema,
} from './schemas.js';
export type {
  SubscriptionStatus,
  PlanStatus,
  PricingTier,
  EntitlementType,
  PlanFeature,
  PlanQuota,
  CreatePlanInput,
  UpdatePlanInput,
  PlanParams,
  PlanListQuery,
  CreateSubscriptionInput,
  SubscriptionParams,
  ChangePlanInput,
  CheckEntitlementInput,
  RecordUsageInput,
  GetUsageInput,
  PlanResponse,
  PlanListResponse,
  SubscriptionResponse,
  EntitlementResponse,
  UsageResponse,
  QuotaResult,
  DowngradeResult,
} from './schemas.js';

// Routes
export { registerBillingRoutes } from './routes.js';
export type { BillingRoutesOptions } from './routes.js';

// Default tenant feature configuration
export {
  LEGACY_MOBILE_ROUTES_FEATURE_KEY,
  DEFAULT_TENANT_FEATURES,
  getDefaultFeatureFlag,
} from './defaults.js';

// Entitlement Middleware
export {
  createEntitlementMiddleware,
  evaluateFeatureFlag,
  hashTenantFeature,
  InMemoryRateLimitStore,
  DEFAULT_TIER_RATE_LIMITS,
} from './entitlement-middleware.js';
export type {
  EntitlementMiddlewareOptions,
  FeatureFlagOverride,
  TierRateLimitConfig,
  RateLimitEntry,
  RateLimitStore,
} from './entitlement-middleware.js';
