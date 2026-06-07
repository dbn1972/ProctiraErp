/**
 * Default tenant feature configuration.
 *
 * Defines the canonical list of feature flags every new tenant inherits when
 * a plan is provisioned. Plans MAY override individual entries by listing the
 * same `featureKey` in their own `features` array, but the keys defined here
 * establish the baseline behaviour and the documented default value.
 *
 * Adding a key here makes it discoverable across the codebase: the frontend
 * (`apps/web/src/providers/FeatureFlagsProvider.tsx`) imports the same keys
 * to type its `useFeatureFlags()` shape, and the entitlement middleware can
 * use the defaults to answer `checkEntitlement()` lookups for tenants whose
 * plan does not explicitly opt in.
 *
 * Charter: Section 10 (Subscription, Entitlements, Feature Control)
 */
import type { PlanFeature } from './schemas.js';

// ─── Feature Flag Keys ───────────────────────────────────────────────────────

/**
 * Feature flag controlling whether the legacy `/mobile/*` routes
 * (`<MobileDashboard>`, `<MobileAttendance>`, `<MobileStudentProfile>`) are
 * registered in the SPA. Defaults to `off` so the responsive shell from
 * Task 53.1 becomes the default, while existing tenants can opt back in
 * during the migration window (Requirements 41.1, 29.5; Design §H).
 */
export const LEGACY_MOBILE_ROUTES_FEATURE_KEY = 'legacy_mobile_routes';

// ─── Default Feature Set ─────────────────────────────────────────────────────

/**
 * The default feature flags every new tenant inherits unless their plan
 * explicitly overrides them. New entries SHOULD be `enabled: false` by
 * default and opted into by tenants who need the behaviour.
 */
export const DEFAULT_TENANT_FEATURES: readonly PlanFeature[] = Object.freeze([
  Object.freeze({
    featureKey: LEGACY_MOBILE_ROUTES_FEATURE_KEY,
    enabled: false,
    description:
      'Register the legacy /mobile/* routes (MobileDashboard, MobileAttendance, MobileStudentProfile). Off by default; the responsive shell handles small viewports automatically. Existing tenants migrating from the legacy mobile experience can enable this to keep their bookmarks working.',
  }),
]);

/**
 * Look up the default value (enabled / disabled) for a feature key. Returns
 * `undefined` when the key is not part of the default set so callers can
 * distinguish an unknown key from an explicit `false`.
 */
export function getDefaultFeatureFlag(featureKey: string): boolean | undefined {
  const entry = DEFAULT_TENANT_FEATURES.find((f) => f.featureKey === featureKey);
  return entry?.enabled;
}
