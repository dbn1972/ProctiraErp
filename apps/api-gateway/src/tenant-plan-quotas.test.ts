import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearTenantPlanTiersForTests,
  maxRequestsForTenant,
  quotaForTier,
  resolvePlanTier,
  setTenantPlanTierForTests,
} from './tenant-plan-quotas.js';

describe('G-505 tenant plan quotas', () => {
  beforeEach(() => {
    clearTenantPlanTiersForTests();
  });

  it('resolves tier from JWT claim first', () => {
    setTenantPlanTierForTests('t1', 'enterprise');
    expect(resolvePlanTier('t1', { planTier: 'free' })).toBe('free');
  });

  it('falls back to TENANT_PLAN_TIERS map then undefined (caller uses config max)', () => {
    setTenantPlanTierForTests('t1', 'professional');
    expect(resolvePlanTier('t1')).toBe('professional');
    expect(resolvePlanTier('unknown')).toBeUndefined();
    expect(maxRequestsForTenant('unknown', null, 42)).toBe(42);
  });

  it('maps tiers to distinct max request quotas', () => {
    expect(quotaForTier('free').maxRequests).toBe(100);
    expect(quotaForTier('enterprise').maxRequests).toBe(10_000);
    expect(maxRequestsForTenant('t-free', { planTier: 'free' })).toBe(100);
    expect(maxRequestsForTenant('t-ent', { planTier: 'enterprise' })).toBe(10_000);
  });
});
