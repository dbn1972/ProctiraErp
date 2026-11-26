/**
 * PRC-L078: tenant feature flags from the tenant's own entitlements.
 *
 * `GET /api/v1/billing/me/entitlements` (PRC-H044) is scoped to the JWT tenant
 * and lists the plan's feature flags (`enabled` is already false while the
 * subscription is suspended or a trial has lapsed). Only keys the web
 * `FeatureFlagsProvider` knows are passed on. Any read failure returns `{}`, so
 * every flag falls back to its documented default (off): a missing entitlement
 * never turns a feature on.
 */
import { DEFAULT_FEATURE_FLAGS, type FeatureFlagKey } from '@/providers/FeatureFlagsProvider';

import { gatewayFetch } from './gateway';

/** Shape of `GET /billing/me/entitlements` this client reads. */
export interface TenantEntitlementsSummary {
  subscribed: boolean;
  status: string;
  features: Array<{ featureKey: string; enabled: boolean }>;
}

const KNOWN_KEYS = new Set<string>(Object.keys(DEFAULT_FEATURE_FLAGS));

/** Map the entitlement summary to the provider's flags (unknown keys dropped). */
export function featureFlagsFromEntitlements(
  summary: TenantEntitlementsSummary | null | undefined,
): Partial<Record<FeatureFlagKey, boolean>> {
  const flags: Partial<Record<FeatureFlagKey, boolean>> = {};
  if (!summary || !Array.isArray(summary.features)) return flags;
  for (const feature of summary.features) {
    if (KNOWN_KEYS.has(feature.featureKey)) {
      flags[feature.featureKey as FeatureFlagKey] = feature.enabled === true;
    }
  }
  return flags;
}

/** The current tenant's feature flags; `{}` (defaults) when the read fails. */
export async function getTenantFeatureFlags(): Promise<Partial<Record<FeatureFlagKey, boolean>>> {
  try {
    const result = await gatewayFetch<TenantEntitlementsSummary>('/billing/me/entitlements', {
      method: 'GET',
      throwOnError: false,
      next: { revalidate: 0 },
    });
    return result.ok ? featureFlagsFromEntitlements(result.data) : {};
  } catch {
    return {};
  }
}
