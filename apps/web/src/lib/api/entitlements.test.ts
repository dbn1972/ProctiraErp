/**
 * PRC-L078: the dashboard feeds FeatureFlagsProvider from the tenant's own
 * entitlements (`GET /billing/me/entitlements`) instead of hard-coded defaults.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const gatewayFetch = vi.fn();
vi.mock('./gateway', () => ({
  gatewayFetch: (...args: unknown[]) => gatewayFetch(...args),
}));

import { featureFlagsFromEntitlements, getTenantFeatureFlags } from './entitlements';

beforeEach(() => {
  gatewayFetch.mockReset();
});

describe('featureFlagsFromEntitlements (PRC-L078)', () => {
  it('maps known feature keys and drops unknown ones', () => {
    expect(
      featureFlagsFromEntitlements({
        subscribed: true,
        status: 'active',
        features: [
          { featureKey: 'legacy_mobile_routes', enabled: true },
          { featureKey: 'not_a_web_flag', enabled: true },
        ],
      }),
    ).toEqual({ legacy_mobile_routes: true });
  });

  it('keeps an explicit false and tolerates a missing feature list', () => {
    expect(
      featureFlagsFromEntitlements({
        subscribed: false,
        status: 'suspended',
        features: [{ featureKey: 'legacy_mobile_routes', enabled: false }],
      }),
    ).toEqual({ legacy_mobile_routes: false });
    expect(featureFlagsFromEntitlements(null)).toEqual({});
  });
});

describe('getTenantFeatureFlags (PRC-L078)', () => {
  it('reads the tenant entitlements without caching', async () => {
    gatewayFetch.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        subscribed: true,
        status: 'active',
        features: [{ featureKey: 'legacy_mobile_routes', enabled: true }],
      },
    });
    await expect(getTenantFeatureFlags()).resolves.toEqual({ legacy_mobile_routes: true });
    expect(gatewayFetch).toHaveBeenCalledWith(
      '/billing/me/entitlements',
      expect.objectContaining({ method: 'GET', next: { revalidate: 0 } }),
    );
  });

  it('falls back to the defaults (no flags) when the read fails', async () => {
    gatewayFetch.mockResolvedValue({ ok: false, status: 503, data: null });
    await expect(getTenantFeatureFlags()).resolves.toEqual({});
    gatewayFetch.mockRejectedValue(new Error('network'));
    await expect(getTenantFeatureFlags()).resolves.toEqual({});
  });
});
