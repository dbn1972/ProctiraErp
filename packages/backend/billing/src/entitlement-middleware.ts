/**
 * Entitlement Middleware
 *
 * Fastify preHandler hooks for entitlement checking on protected routes.
 * Provides:
 * - Feature flag evaluation (plan-based, tenant-specific, percentage rollout)
 * - Rate limiting per tenant tier (different limits per plan)
 * - Clear error responses when quota exceeded or feature not entitled
 *
 * Usage:
 *   fastify.get('/protected', {
 *     preHandler: [requireFeature('custom_fields')],
 *   }, handler);
 *
 *   fastify.post('/students', {
 *     preHandler: [requireQuota('students', 1)],
 *   }, handler);
 *
 * Charter: Section 10.2 (Required Controls)
 */
import type { FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';

import type { BillingService } from './billing-service.js';
import type { PricingTier } from './schemas.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Configuration for a feature flag override (tenant-specific or percentage rollout).
 */
export interface FeatureFlagOverride {
  /** Feature key this override applies to */
  featureKey: string;
  /** Tenant-specific override: if set, applies only to these tenants */
  tenantIds?: string[];
  /** Percentage rollout: 0-100, determines what percentage of tenants get the feature */
  rolloutPercentage?: number;
  /** Whether the feature is enabled by this override */
  enabled: boolean;
}

/**
 * Rate limit configuration per pricing tier.
 */
export interface TierRateLimitConfig {
  /** Maximum requests allowed in the window */
  maxRequests: number;
  /** Time window in milliseconds */
  windowMs: number;
}

/**
 * Rate limit state for a tenant (stored in-memory or Redis).
 */
export interface RateLimitEntry {
  /** Number of requests made in the current window */
  count: number;
  /** When the current window started (Unix timestamp ms) */
  windowStart: number;
}

/**
 * Interface for rate limit storage (allows Redis or in-memory implementations).
 */
export interface RateLimitStore {
  /** Get the current rate limit entry for a tenant */
  get(tenantId: string): Promise<RateLimitEntry | null>;
  /** Set/update the rate limit entry for a tenant */
  set(tenantId: string, entry: RateLimitEntry, ttlMs: number): Promise<void>;
  /** Increment the request count and return the new entry */
  increment(tenantId: string, windowMs: number): Promise<RateLimitEntry>;
}

/**
 * Options for the entitlement middleware factory.
 */
export interface EntitlementMiddlewareOptions {
  /** The billing service instance for entitlement checks */
  billingService: BillingService;
  /** Feature flag overrides (tenant-specific, percentage rollout) */
  featureFlagOverrides?: FeatureFlagOverride[];
  /** Rate limit configuration per tier */
  rateLimits?: Record<string, TierRateLimitConfig>;
  /** Rate limit store implementation (defaults to in-memory) */
  rateLimitStore?: RateLimitStore;
  /** Function to resolve tenant ID from request (defaults to request.tenantId) */
  resolveTenantId?: (request: FastifyRequest) => string | undefined;
  /** Function to resolve tenant tier from request (for rate limiting without DB lookup) */
  resolveTenantTier?: (request: FastifyRequest) => Promise<PricingTier | undefined>;
}

// ─── Default Rate Limits Per Tier ────────────────────────────────────────────

/**
 * Default rate limits per pricing tier.
 * These can be overridden via EntitlementMiddlewareOptions.
 */
export const DEFAULT_TIER_RATE_LIMITS: Record<string, TierRateLimitConfig> = {
  free: { maxRequests: 100, windowMs: 60_000 }, // 100 req/min
  starter: { maxRequests: 500, windowMs: 60_000 }, // 500 req/min
  professional: { maxRequests: 2000, windowMs: 60_000 }, // 2000 req/min
  enterprise: { maxRequests: 10000, windowMs: 60_000 }, // 10000 req/min
  custom: { maxRequests: 10000, windowMs: 60_000 }, // Same as enterprise by default
};

// ─── In-Memory Rate Limit Store ──────────────────────────────────────────────

/**
 * Simple in-memory rate limit store.
 * For production, use Redis-backed implementation.
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private store = new Map<string, RateLimitEntry>();

  async get(tenantId: string): Promise<RateLimitEntry | null> {
    return this.store.get(tenantId) ?? null;
  }

  async set(tenantId: string, entry: RateLimitEntry, _ttlMs: number): Promise<void> {
    this.store.set(tenantId, entry);
  }

  async increment(tenantId: string, windowMs: number): Promise<RateLimitEntry> {
    const now = Date.now();
    const existing = this.store.get(tenantId);

    if (!existing || now - existing.windowStart >= windowMs) {
      // Start a new window
      const entry: RateLimitEntry = { count: 1, windowStart: now };
      this.store.set(tenantId, entry);
      return entry;
    }

    // Increment within current window
    existing.count += 1;
    return existing;
  }

  /** Clear all entries (for testing) */
  clear(): void {
    this.store.clear();
  }
}

// ─── Feature Flag Evaluation ─────────────────────────────────────────────────

/**
 * Evaluate a feature flag considering overrides.
 *
 * Evaluation order:
 * 1. Tenant-specific override (highest priority)
 * 2. Percentage rollout override
 * 3. Plan-based entitlement (from billing service)
 */
export function evaluateFeatureFlag(
  featureKey: string,
  tenantId: string,
  overrides: FeatureFlagOverride[],
): { overridden: boolean; enabled?: boolean } {
  for (const override of overrides) {
    if (override.featureKey !== featureKey) continue;

    // Tenant-specific override
    if (override.tenantIds && override.tenantIds.includes(tenantId)) {
      return { overridden: true, enabled: override.enabled };
    }

    // Percentage rollout
    if (override.rolloutPercentage !== undefined) {
      const hash = hashTenantFeature(tenantId, featureKey);
      const bucket = hash % 100;
      if (bucket < override.rolloutPercentage) {
        return { overridden: true, enabled: override.enabled };
      }
    }
  }

  return { overridden: false };
}

/**
 * Simple deterministic hash for tenant+feature combination.
 * Used for consistent percentage rollout bucketing.
 */
export function hashTenantFeature(tenantId: string, featureKey: string): number {
  const str = `${tenantId}:${featureKey}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

// ─── Middleware Factory ──────────────────────────────────────────────────────

/**
 * Creates the entitlement middleware factory with shared configuration.
 *
 * Returns helper functions that create Fastify preHandler hooks:
 * - requireFeature(featureKey) - Checks feature flag entitlement
 * - requireQuota(metric, increment) - Checks quota availability
 * - rateLimit() - Applies tier-based rate limiting
 */
export function createEntitlementMiddleware(options: EntitlementMiddlewareOptions) {
  const {
    billingService,
    featureFlagOverrides = [],
    rateLimits = DEFAULT_TIER_RATE_LIMITS,
    rateLimitStore = new InMemoryRateLimitStore(),
    resolveTenantId = (request: FastifyRequest) =>
      (request as unknown as { tenantId?: string }).tenantId,
    resolveTenantTier,
  } = options;

  /**
   * PreHandler that requires a specific feature to be enabled for the tenant.
   *
   * Evaluation order:
   * 1. Tenant-specific override (highest priority)
   * 2. Percentage rollout override
   * 3. Plan-based entitlement (from billing service)
   *
   * Returns 403 if feature is not entitled.
   * Returns 402 if no active subscription.
   */
  function requireFeature(featureKey: string): preHandlerHookHandler {
    return async function featureGuard(
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<void> {
      const tenantId = resolveTenantId(request);
      if (!tenantId) {
        reply.status(401).send({
          code: 'UNAUTHORIZED',
          message: 'Tenant context required for entitlement check',
          statusCode: 401,
        });
        return;
      }

      // Check overrides first (tenant-specific, percentage rollout)
      const overrideResult = evaluateFeatureFlag(featureKey, tenantId, featureFlagOverrides);
      if (overrideResult.overridden) {
        if (!overrideResult.enabled) {
          reply.status(403).send({
            code: 'FEATURE_NOT_ENTITLED',
            message: `Feature '${featureKey}' is not available for your tenant`,
            statusCode: 403,
            feature: featureKey,
          });
          return;
        }
        // Feature is enabled via override, allow through
        return;
      }

      // Fall back to plan-based entitlement check
      const entitlement = await billingService.checkEntitlement(tenantId, featureKey);
      if (!entitlement.allowed) {
        const statusCode = entitlement.reason === 'No active subscription' ? 402 : 403;
        reply.status(statusCode).send({
          code: statusCode === 402 ? 'SUBSCRIPTION_REQUIRED' : 'FEATURE_NOT_ENTITLED',
          message: entitlement.reason ?? `Feature '${featureKey}' is not available`,
          statusCode,
          feature: featureKey,
          ...(entitlement.quota ? { quota: entitlement.quota } : {}),
        });
        return;
      }
    };
  }

  /**
   * PreHandler that checks quota availability before allowing the request.
   *
   * Does NOT consume the quota — that should be done in the route handler
   * after the operation succeeds. This only checks if there's room.
   *
   * Returns 429 if quota would be exceeded.
   * Returns 402 if no active subscription.
   */
  function requireQuota(metric: string, increment: number = 1): preHandlerHookHandler {
    return async function quotaGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
      const tenantId = resolveTenantId(request);
      if (!tenantId) {
        reply.status(401).send({
          code: 'UNAUTHORIZED',
          message: 'Tenant context required for quota check',
          statusCode: 401,
        });
        return;
      }

      const result = await billingService.enforceQuota(tenantId, metric, increment);
      if (!result.allowed) {
        const statusCode = result.reason === 'No active subscription' ? 402 : 429;
        reply.status(statusCode).send({
          code: statusCode === 402 ? 'SUBSCRIPTION_REQUIRED' : 'QUOTA_EXCEEDED',
          message: result.reason ?? `Quota exceeded for '${metric}'`,
          statusCode,
          metric,
          quota: {
            used: result.used,
            limit: result.limit,
            remaining: result.remaining,
          },
        });
        return;
      }
    };
  }

  /**
   * PreHandler that applies tier-based rate limiting.
   *
   * Rate limits are determined by the tenant's subscription tier.
   * Different tiers get different request allowances.
   *
   * Returns 429 with Retry-After header when rate limit is exceeded.
   */
  function rateLimit(): preHandlerHookHandler {
    return async function rateLimitGuard(
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<void> {
      const tenantId = resolveTenantId(request);
      if (!tenantId) {
        // No tenant context — skip rate limiting (public routes)
        return;
      }

      // Resolve the tenant's tier
      let tier: string | undefined;
      if (resolveTenantTier) {
        tier = await resolveTenantTier(request);
      }

      if (!tier) {
        // Try to get tier from the billing service
        try {
          const subscription = await billingService.getActiveSubscription(tenantId);
          const plan = await billingService.getPlanById(subscription.planId);
          tier = plan.tier;
        } catch {
          // No active subscription — use free tier limits
          tier = 'free';
        }
      }

      const config = rateLimits[tier] ?? rateLimits['free'] ?? DEFAULT_TIER_RATE_LIMITS['free']!;
      const entry = await rateLimitStore.increment(tenantId, config.windowMs);

      // Set rate limit headers
      reply.header('X-RateLimit-Limit', config.maxRequests);
      reply.header('X-RateLimit-Remaining', Math.max(0, config.maxRequests - entry.count));
      reply.header('X-RateLimit-Reset', Math.ceil((entry.windowStart + config.windowMs) / 1000));

      if (entry.count > config.maxRequests) {
        const retryAfterMs = entry.windowStart + config.windowMs - Date.now();
        const retryAfterSec = Math.ceil(retryAfterMs / 1000);

        reply.header('Retry-After', retryAfterSec);
        reply.status(429).send({
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Rate limit exceeded. Maximum ${config.maxRequests} requests per ${config.windowMs / 1000}s for '${tier}' tier. Retry after ${retryAfterSec}s.`,
          statusCode: 429,
          tier,
          limit: config.maxRequests,
          windowMs: config.windowMs,
          retryAfterSec,
        });
        return;
      }
    };
  }

  return {
    requireFeature,
    requireQuota,
    rateLimit,
  };
}
