/**
 * PRC-H044 — gateway billing entitlement gate (G-811).
 *
 * Verifies fail-closed denials for premium features and quota-limited creates,
 * that non-gated routes/methods pass, and that a billing-service failure denies
 * rather than allows.
 */
import { describe, expect, it } from 'vitest';

import {
  billingEntitlementsEnforced,
  evaluateBillingEntitlement,
  type EntitlementChecker,
} from './billing-entitlements.js';

const TENANT = '550e8400-e29b-41d4-a716-446655440000';

function checker(impl: EntitlementChecker['checkEntitlement']): EntitlementChecker {
  return { checkEntitlement: impl };
}

describe('billingEntitlementsEnforced', () => {
  it('is off by default and on for truthy flag values', () => {
    expect(billingEntitlementsEnforced({} as NodeJS.ProcessEnv)).toBe(false);
    expect(
      billingEntitlementsEnforced({ BILLING_ENTITLEMENTS_ENFORCED: 'true' } as NodeJS.ProcessEnv),
    ).toBe(true);
    expect(
      billingEntitlementsEnforced({ BILLING_ENTITLEMENTS_ENFORCED: '1' } as NodeJS.ProcessEnv),
    ).toBe(true);
    expect(
      billingEntitlementsEnforced({ BILLING_ENTITLEMENTS_ENFORCED: 'no' } as NodeJS.ProcessEnv),
    ).toBe(false);
  });
});

describe('evaluateBillingEntitlement', () => {
  it('ignores non-gated routes', async () => {
    const b = checker(async () => {
      throw new Error('should not be called');
    });
    expect(await evaluateBillingEntitlement(b, TENANT, 'GET', '/api/v1/institutions')).toBeNull();
    expect(await evaluateBillingEntitlement(b, TENANT, 'POST', '/api/v1/assessments')).toBeNull();
  });

  it('does not gate non-create methods on quota-limited segments', async () => {
    const b = checker(async () => {
      throw new Error('should not be called');
    });
    expect(await evaluateBillingEntitlement(b, TENANT, 'GET', '/api/v1/students')).toBeNull();
    expect(await evaluateBillingEntitlement(b, TENANT, 'PUT', '/api/v1/students/x')).toBeNull();
  });

  it('denies student create with 402 when no active subscription (fail closed)', async () => {
    const b = checker(async () => ({ allowed: false, reason: 'No active subscription' }));
    const denial = await evaluateBillingEntitlement(b, TENANT, 'POST', '/api/v1/students');
    expect(denial?.statusCode).toBe(402);
    expect(denial?.code).toBe('SUBSCRIPTION_REQUIRED');
    expect(denial?.metric).toBe('students');
  });

  it('denies student create with 429 QUOTA_EXCEEDED when seat limit reached', async () => {
    const b = checker(async () => ({
      allowed: false,
      reason: "Quota exceeded for 'students' (2/2)",
      quota: { used: 2, limit: 2 },
    }));
    const denial = await evaluateBillingEntitlement(b, TENANT, 'POST', '/api/v1/students');
    expect(denial?.statusCode).toBe(429);
    expect(denial?.code).toBe('QUOTA_EXCEEDED');
    expect(denial?.quota).toEqual({ used: 2, limit: 2 });
  });

  it('allows student create when quota available', async () => {
    const b = checker(async () => ({ allowed: true, quota: { used: 1, limit: 10 } }));
    expect(await evaluateBillingEntitlement(b, TENANT, 'POST', '/api/v1/students')).toBeNull();
  });

  it('denies premium feature route with 402 when no subscription', async () => {
    const b = checker(async () => ({ allowed: false, reason: 'No active subscription' }));
    const denial = await evaluateBillingEntitlement(b, TENANT, 'GET', '/api/v1/library/books');
    expect(denial?.statusCode).toBe(402);
    expect(denial?.feature).toBe('library');
  });

  it('denies premium feature route with 403 when plan lacks the feature', async () => {
    const b = checker(async () => ({
      allowed: false,
      reason: "Feature 'library' is not included in the current plan",
    }));
    const denial = await evaluateBillingEntitlement(b, TENANT, 'GET', '/api/v1/library/books');
    expect(denial?.statusCode).toBe(403);
    expect(denial?.code).toBe('FEATURE_NOT_ENTITLED');
    expect(denial?.feature).toBe('library');
  });

  it('fails closed when the billing service throws', async () => {
    const b = checker(async () => {
      throw new Error('store down');
    });
    const denial = await evaluateBillingEntitlement(b, TENANT, 'POST', '/api/v1/students');
    expect(denial?.statusCode).toBe(402);
    expect(denial?.code).toBe('SUBSCRIPTION_REQUIRED');
  });

  it('denies a gated route with no tenant context', async () => {
    const b = checker(async () => ({ allowed: true }));
    const denial = await evaluateBillingEntitlement(b, undefined, 'POST', '/api/v1/students');
    expect(denial?.statusCode).toBe(402);
  });
});
