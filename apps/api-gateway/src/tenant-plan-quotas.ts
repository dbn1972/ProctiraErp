/**
 * G-505 — Per-tenant API rate quotas derived from plan tier (G-106).
 *
 * Resolution order:
 *   1. JWT claim `planTier` / `tier` when present
 *   2. TENANT_PLAN_TIERS env map: `tenantId:tier,tenantId:tier`
 *   3. Default tier `starter`
 *
 * Limits mirror packages/backend/billing DEFAULT_TIER_RATE_LIMITS.
 */

export type PlanTier = 'free' | 'starter' | 'professional' | 'enterprise' | 'custom' | string;

export interface TierQuota {
  maxRequests: number;
  windowMs: number;
}

/** Canonical per-tier quotas (requests per window). */
export const PLAN_TIER_QUOTAS: Record<string, TierQuota> = {
  free: { maxRequests: 100, windowMs: 60_000 },
  starter: { maxRequests: 500, windowMs: 60_000 },
  professional: { maxRequests: 2_000, windowMs: 60_000 },
  enterprise: { maxRequests: 10_000, windowMs: 60_000 },
  custom: { maxRequests: 10_000, windowMs: 60_000 },
};

const tierByTenant = new Map<string, PlanTier>();

function bootstrapFromEnv(env: NodeJS.ProcessEnv = process.env): void {
  const raw = env['TENANT_PLAN_TIERS'];
  if (!raw) return;
  for (const part of raw.split(',')) {
    const [tenantId, tier] = part.split(':').map((s) => s.trim());
    if (tenantId && tier) tierByTenant.set(tenantId, tier);
  }
}

bootstrapFromEnv();

/** Test helper */
export function setTenantPlanTierForTests(tenantId: string, tier: PlanTier): void {
  tierByTenant.set(tenantId, tier);
}

/** Test helper */
export function clearTenantPlanTiersForTests(): void {
  tierByTenant.clear();
  bootstrapFromEnv();
}

export function resolvePlanTier(
  tenantId: string | undefined,
  user?: { planTier?: string; tier?: string } | null,
): PlanTier | undefined {
  if (user?.planTier) return user.planTier;
  if (user?.tier) return user.tier;
  if (tenantId && tierByTenant.has(tenantId)) {
    return tierByTenant.get(tenantId)!;
  }
  return undefined;
}

export function quotaForTier(tier: PlanTier, fallbackMax?: number): TierQuota {
  const known = PLAN_TIER_QUOTAS[tier];
  if (known) return known;
  if (fallbackMax != null) {
    return { maxRequests: fallbackMax, windowMs: 60_000 };
  }
  return PLAN_TIER_QUOTAS['starter']!;
}

/**
 * Resolve max requests for a tenant.
 * When no plan tier is known, fall back to gateway `fallbackMax` so existing
 * global rate-limit config (and tests) keep working.
 */
export function maxRequestsForTenant(
  tenantId: string | undefined,
  user?: { planTier?: string; tier?: string } | null,
  fallbackMax?: number,
): number {
  const tier = resolvePlanTier(tenantId, user);
  if (!tier) {
    return fallbackMax ?? PLAN_TIER_QUOTAS['starter']!.maxRequests;
  }
  return quotaForTier(tier, fallbackMax).maxRequests;
}
