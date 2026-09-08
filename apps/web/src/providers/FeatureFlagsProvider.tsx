'use client';

/**
 * FeatureFlagsProvider — Tenant entitlement feature flags (Design §H, Section A)
 *
 * Exposes the feature-flag entitlements resolved for the current tenant. The
 * backend authoritative copy lives in `packages/backend/billing` (see
 * `DEFAULT_TENANT_FEATURES` in `defaults.ts`); this provider mirrors that
 * shape for the SPA so route-level gating (Task 53.5 — legacy `/mobile/*`
 * routes) and component-level gating can read flags synchronously without
 * suspense.
 *
 * The provider hydrates from `initialFlags` (typically supplied by an
 * authenticated bootstrap response) and falls back to `DEFAULT_FEATURE_FLAGS`
 * — every key here mirrors the documented default in the billing package and
 * MUST stay in sync.
 *
 * Requirements: 41.1, 29.5
 * Charter: Section 10 (Subscription, Entitlements, Feature Control)
 */

import React, { createContext, useContext, useMemo } from 'react';

// ─── Feature Flag Keys ───────────────────────────────────────────────────────

/**
 * Feature flag controlling whether the legacy `/mobile/*` routes are
 * registered in the SPA. Defaults to `false` so the responsive shell from
 * Task 53.1 handles small viewports automatically; existing tenants opt back
 * in by toggling this entitlement on.
 *
 * Mirrors `LEGACY_MOBILE_ROUTES_FEATURE_KEY` in
 * `@proctira/backend-billing/src/defaults.ts`.
 */
export const LEGACY_MOBILE_ROUTES_FEATURE_KEY = 'legacy_mobile_routes';

/** The set of feature flag keys this provider knows about. */
export type FeatureFlagKey = typeof LEGACY_MOBILE_ROUTES_FEATURE_KEY;

/** A read-only map of feature key → enabled state. */
export type FeatureFlags = Readonly<Record<FeatureFlagKey, boolean>>;

/**
 * The authoritative defaults for new / unauthenticated sessions. Mirrors
 * `DEFAULT_TENANT_FEATURES` in the billing package.
 */
export const DEFAULT_FEATURE_FLAGS: FeatureFlags = Object.freeze({
  [LEGACY_MOBILE_ROUTES_FEATURE_KEY]: false,
});

// ─── Context ─────────────────────────────────────────────────────────────────

export interface FeatureFlagsContextValue {
  /** The resolved feature flag map for the current tenant. */
  flags: FeatureFlags;
  /**
   * Convenience helper: returns the boolean value for a known feature key,
   * falling back to the documented default when the tenant payload omits it.
   */
  isEnabled: (key: FeatureFlagKey) => boolean;
}

const FeatureFlagsContext = createContext<FeatureFlagsContextValue | undefined>(undefined);

// ─── Provider ────────────────────────────────────────────────────────────────

export interface FeatureFlagsProviderProps {
  children: React.ReactNode;
  /**
   * Initial feature flags resolved from the entitlement service. Missing
   * keys fall through to `DEFAULT_FEATURE_FLAGS`. Tests typically supply a
   * complete map.
   */
  initialFlags?: Partial<Record<FeatureFlagKey, boolean>>;
}

export function FeatureFlagsProvider({ children, initialFlags }: FeatureFlagsProviderProps) {
  const value = useMemo<FeatureFlagsContextValue>(() => {
    const merged: Record<FeatureFlagKey, boolean> = {
      ...DEFAULT_FEATURE_FLAGS,
      ...(initialFlags ?? {}),
    };
    const flags = Object.freeze(merged) as FeatureFlags;
    return {
      flags,
      isEnabled: (key) => flags[key] ?? DEFAULT_FEATURE_FLAGS[key] ?? false,
    };
  }, [initialFlags]);

  return <FeatureFlagsContext.Provider value={value}>{children}</FeatureFlagsContext.Provider>;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Read the resolved feature flag map for the current tenant.
 *
 * When invoked outside a `<FeatureFlagsProvider>` the hook returns the
 * documented defaults so render trees without an explicit provider (such as
 * SSR pre-hydration paths or unit tests for unrelated components) still get
 * sensible behaviour.
 */
export function useFeatureFlags(): FeatureFlagsContextValue {
  const ctx = useContext(FeatureFlagsContext);
  if (ctx) return ctx;
  return {
    flags: DEFAULT_FEATURE_FLAGS,
    isEnabled: (key) => DEFAULT_FEATURE_FLAGS[key] ?? false,
  };
}
