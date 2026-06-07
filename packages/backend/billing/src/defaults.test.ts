/**
 * Unit tests for the default tenant feature configuration.
 *
 * Verifies that:
 *   - `legacy_mobile_routes` is part of the default feature set.
 *   - It defaults to `enabled: false` so new tenants get the responsive
 *     shell automatically (Task 53.5 / Requirement 41.1).
 *   - The default set is immutable so callers cannot accidentally mutate
 *     shared state at runtime.
 *   - `getDefaultFeatureFlag()` answers known keys and returns `undefined`
 *     for unknown keys.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TENANT_FEATURES,
  LEGACY_MOBILE_ROUTES_FEATURE_KEY,
  getDefaultFeatureFlag,
} from './defaults.js';

describe('DEFAULT_TENANT_FEATURES', () => {
  it('exposes a stable feature key constant for legacy mobile routes', () => {
    expect(LEGACY_MOBILE_ROUTES_FEATURE_KEY).toBe('legacy_mobile_routes');
  });

  it('contains the legacy_mobile_routes flag', () => {
    const entry = DEFAULT_TENANT_FEATURES.find(
      (f) => f.featureKey === LEGACY_MOBILE_ROUTES_FEATURE_KEY,
    );
    expect(entry).toBeDefined();
  });

  it('defaults legacy_mobile_routes to disabled so new tenants get the responsive shell', () => {
    const entry = DEFAULT_TENANT_FEATURES.find(
      (f) => f.featureKey === LEGACY_MOBILE_ROUTES_FEATURE_KEY,
    );
    expect(entry?.enabled).toBe(false);
  });

  it('is frozen at module load to prevent accidental mutation', () => {
    expect(Object.isFrozen(DEFAULT_TENANT_FEATURES)).toBe(true);
    for (const entry of DEFAULT_TENANT_FEATURES) {
      expect(Object.isFrozen(entry)).toBe(true);
    }
  });

  it('uses unique feature keys', () => {
    const keys = DEFAULT_TENANT_FEATURES.map((f) => f.featureKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('getDefaultFeatureFlag', () => {
  it('returns the default value for a known feature key', () => {
    expect(getDefaultFeatureFlag(LEGACY_MOBILE_ROUTES_FEATURE_KEY)).toBe(false);
  });

  it('returns undefined for an unknown feature key', () => {
    expect(getDefaultFeatureFlag('not_a_real_feature')).toBeUndefined();
  });
});
