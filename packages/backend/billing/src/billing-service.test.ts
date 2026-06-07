/**
 * Billing Service Unit Tests
 *
 * Tests plan management, subscription lifecycle, entitlement checking,
 * usage tracking, and plan upgrades/downgrades.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ConflictError, NotFoundError, BusinessRuleError } from '@proctira/common';

import { BillingService } from './billing-service.js';
import { InMemoryBillingRepository } from './in-memory-repository.js';
import type { CreatePlanInput } from './schemas.js';

describe('BillingService', () => {
  let service: BillingService;
  let repository: InMemoryBillingRepository;

  beforeEach(() => {
    repository = new InMemoryBillingRepository();
    service = new BillingService(repository);
  });

  // ─── Helper Functions ──────────────────────────────────────────────────

  const createFreePlan = (): CreatePlanInput => ({
    name: 'Free Plan',
    description: 'Basic free tier',
    tier: 'free',
    features: [
      { featureKey: 'basic_reports', enabled: true },
      { featureKey: 'custom_fields', enabled: false },
    ],
    quotas: [
      { metric: 'students', limit: 100 },
      { metric: 'api_calls_per_day', limit: 1000 },
    ],
    trialDays: 0,
  });

  const createProPlan = (): CreatePlanInput => ({
    name: 'Professional Plan',
    description: 'Professional tier with more features',
    tier: 'professional',
    features: [
      { featureKey: 'basic_reports', enabled: true },
      { featureKey: 'custom_fields', enabled: true },
      { featureKey: 'bulk_import', enabled: true },
    ],
    quotas: [
      { metric: 'students', limit: 10000 },
      { metric: 'api_calls_per_day', limit: 50000 },
    ],
    priceMonthly: 9900,
    priceYearly: 99900,
    trialDays: 14,
  });

  const createEnterprisePlan = (): CreatePlanInput => ({
    name: 'Enterprise Plan',
    description: 'Unlimited enterprise tier',
    tier: 'enterprise',
    features: [
      { featureKey: 'basic_reports', enabled: true },
      { featureKey: 'custom_fields', enabled: true },
      { featureKey: 'bulk_import', enabled: true },
      { featureKey: 'sso', enabled: true },
    ],
    quotas: [
      { metric: 'students', limit: -1 },
      { metric: 'api_calls_per_day', limit: -1 },
    ],
    priceMonthly: 49900,
    priceYearly: 499900,
    trialDays: 30,
  });

  const tenantId = '11111111-1111-4111-8111-111111111111';

  // ─── Plan Management ───────────────────────────────────────────────────

  describe('Plan Management', () => {
    it('should create a plan', async () => {
      const plan = await service.createPlan(createFreePlan());

      expect(plan.id).toBeDefined();
      expect(plan.name).toBe('Free Plan');
      expect(plan.tier).toBe('free');
      expect(plan.status).toBe('draft');
      expect(plan.features).toHaveLength(2);
      expect(plan.quotas).toHaveLength(2);
    });

    it('should reject duplicate plan names', async () => {
      await service.createPlan(createFreePlan());

      await expect(service.createPlan(createFreePlan())).rejects.toThrow(ConflictError);
    });

    it('should update a plan', async () => {
      const plan = await service.createPlan(createFreePlan());

      const updated = await service.updatePlan(plan.id, {
        name: 'Updated Free Plan',
        priceMonthly: 0,
      });

      expect(updated.name).toBe('Updated Free Plan');
      expect(updated.priceMonthly).toBe(0);
    });

    it('should reject updating an archived plan', async () => {
      const plan = await service.createPlan(createFreePlan());
      await service.updatePlan(plan.id, { status: 'archived' });

      await expect(
        service.updatePlan(plan.id, { name: 'New Name' }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('should reject updating to a conflicting name', async () => {
      const plan1 = await service.createPlan(createFreePlan());
      await service.createPlan(createProPlan());

      await expect(
        service.updatePlan(plan1.id, { name: 'Professional Plan' }),
      ).rejects.toThrow(ConflictError);
    });

    it('should get a plan by ID', async () => {
      const plan = await service.createPlan(createFreePlan());
      const found = await service.getPlanById(plan.id);

      expect(found.id).toBe(plan.id);
      expect(found.name).toBe('Free Plan');
    });

    it('should throw NotFoundError for non-existent plan', async () => {
      await expect(
        service.getPlanById('00000000-0000-4000-8000-000000000000'),
      ).rejects.toThrow(NotFoundError);
    });

    it('should list plans with filtering', async () => {
      await service.createPlan(createFreePlan());
      await service.createPlan(createProPlan());

      const result = await service.listPlans(
        { tier: 'free' },
        { page: 1, pageSize: 20, sortBy: 'name', sortOrder: 'asc' },
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.tier).toBe('free');
    });
  });

  // ─── Subscription Lifecycle ────────────────────────────────────────────

  describe('Subscription Lifecycle', () => {
    it('should subscribe a tenant to a plan', async () => {
      const plan = await service.createPlan(createProPlan());
      await service.updatePlan(plan.id, { status: 'active' });

      const subscription = await service.subscribeTenant({
        tenantId,
        planId: plan.id,
        startTrial: false,
      });

      expect(subscription.tenantId).toBe(tenantId);
      expect(subscription.planId).toBe(plan.id);
      expect(subscription.status).toBe('active');
      expect(subscription.trialEndsAt).toBeNull();
    });

    it('should start a trial subscription', async () => {
      const plan = await service.createPlan(createProPlan());
      await service.updatePlan(plan.id, { status: 'active' });

      const subscription = await service.subscribeTenant({
        tenantId,
        planId: plan.id,
        startTrial: true,
      });

      expect(subscription.status).toBe('trial');
      expect(subscription.trialEndsAt).not.toBeNull();
    });

    it('should reject subscribing to inactive plan', async () => {
      const plan = await service.createPlan(createProPlan());

      await expect(
        service.subscribeTenant({ tenantId, planId: plan.id }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('should reject duplicate active subscriptions', async () => {
      const plan = await service.createPlan(createProPlan());
      await service.updatePlan(plan.id, { status: 'active' });

      await service.subscribeTenant({ tenantId, planId: plan.id });

      await expect(
        service.subscribeTenant({ tenantId, planId: plan.id }),
      ).rejects.toThrow(ConflictError);
    });

    it('should activate a trial subscription', async () => {
      const plan = await service.createPlan(createProPlan());
      await service.updatePlan(plan.id, { status: 'active' });

      const subscription = await service.subscribeTenant({
        tenantId,
        planId: plan.id,
        startTrial: true,
      });

      const activated = await service.activateSubscription(subscription.id);
      expect(activated.status).toBe('active');
      expect(activated.trialEndsAt).toBeNull();
    });

    it('should reject activating non-trial subscription', async () => {
      const plan = await service.createPlan(createProPlan());
      await service.updatePlan(plan.id, { status: 'active' });

      const subscription = await service.subscribeTenant({
        tenantId,
        planId: plan.id,
        startTrial: false,
      });

      await expect(
        service.activateSubscription(subscription.id),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('should suspend a subscription', async () => {
      const plan = await service.createPlan(createProPlan());
      await service.updatePlan(plan.id, { status: 'active' });

      const subscription = await service.subscribeTenant({
        tenantId,
        planId: plan.id,
      });

      const suspended = await service.suspendSubscription(subscription.id);
      expect(suspended.status).toBe('suspended');
    });

    it('should cancel a subscription', async () => {
      const plan = await service.createPlan(createProPlan());
      await service.updatePlan(plan.id, { status: 'active' });

      const subscription = await service.subscribeTenant({
        tenantId,
        planId: plan.id,
      });

      const cancelled = await service.cancelSubscription(subscription.id);
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.cancelledAt).not.toBeNull();
    });

    it('should reject cancelling already cancelled subscription', async () => {
      const plan = await service.createPlan(createProPlan());
      await service.updatePlan(plan.id, { status: 'active' });

      const subscription = await service.subscribeTenant({
        tenantId,
        planId: plan.id,
      });

      await service.cancelSubscription(subscription.id);

      await expect(
        service.cancelSubscription(subscription.id),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('should reactivate a suspended subscription', async () => {
      const plan = await service.createPlan(createProPlan());
      await service.updatePlan(plan.id, { status: 'active' });

      const subscription = await service.subscribeTenant({
        tenantId,
        planId: plan.id,
      });

      await service.suspendSubscription(subscription.id);
      const reactivated = await service.reactivateSubscription(subscription.id);
      expect(reactivated.status).toBe('active');
    });

    it('should reject reactivating non-suspended subscription', async () => {
      const plan = await service.createPlan(createProPlan());
      await service.updatePlan(plan.id, { status: 'active' });

      const subscription = await service.subscribeTenant({
        tenantId,
        planId: plan.id,
      });

      await expect(
        service.reactivateSubscription(subscription.id),
      ).rejects.toThrow(BusinessRuleError);
    });
  });

  // ─── Entitlement Checking ──────────────────────────────────────────────

  describe('Entitlement Checking', () => {
    it('should allow entitled features', async () => {
      const plan = await service.createPlan(createProPlan());
      await service.updatePlan(plan.id, { status: 'active' });
      await service.subscribeTenant({ tenantId, planId: plan.id });

      const result = await service.checkEntitlement(tenantId, 'custom_fields');
      expect(result.allowed).toBe(true);
      expect(result.featureFlag).toBe(true);
    });

    it('should deny disabled features', async () => {
      const plan = await service.createPlan(createFreePlan());
      await service.updatePlan(plan.id, { status: 'active' });
      await service.subscribeTenant({ tenantId, planId: plan.id });

      const result = await service.checkEntitlement(tenantId, 'custom_fields');
      expect(result.allowed).toBe(false);
      expect(result.featureFlag).toBe(false);
    });

    it('should deny features not in plan', async () => {
      const plan = await service.createPlan(createFreePlan());
      await service.updatePlan(plan.id, { status: 'active' });
      await service.subscribeTenant({ tenantId, planId: plan.id });

      const result = await service.checkEntitlement(tenantId, 'sso');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not included');
    });

    it('should deny when no active subscription', async () => {
      const result = await service.checkEntitlement(tenantId, 'basic_reports');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('No active subscription');
    });

    it('should deny when subscription is suspended', async () => {
      const plan = await service.createPlan(createProPlan());
      await service.updatePlan(plan.id, { status: 'active' });
      const subscription = await service.subscribeTenant({ tenantId, planId: plan.id });
      await service.suspendSubscription(subscription.id);

      const result = await service.checkEntitlement(tenantId, 'custom_fields');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('suspended');
    });

    it('should return quota info for quota-based entitlements', async () => {
      const plan = await service.createPlan(createProPlan());
      await service.updatePlan(plan.id, { status: 'active' });
      await service.subscribeTenant({ tenantId, planId: plan.id });

      const result = await service.checkEntitlement(tenantId, 'students');
      expect(result.allowed).toBe(true);
      expect(result.quota).toBeDefined();
      expect(result.quota!.limit).toBe(10000);
      expect(result.quota!.used).toBe(0);
    });
  });

  // ─── Usage Tracking & Quota Enforcement ────────────────────────────────

  describe('Usage Tracking & Quota Enforcement', () => {
    it('should allow usage within quota', async () => {
      const plan = await service.createPlan(createFreePlan());
      await service.updatePlan(plan.id, { status: 'active' });
      await service.subscribeTenant({ tenantId, planId: plan.id });

      const result = await service.enforceQuota(tenantId, 'students', 10);
      expect(result.allowed).toBe(true);
      expect(result.used).toBe(10);
      expect(result.limit).toBe(100);
      expect(result.remaining).toBe(90);
    });

    it('should deny usage exceeding quota', async () => {
      const plan = await service.createPlan(createFreePlan());
      await service.updatePlan(plan.id, { status: 'active' });
      await service.subscribeTenant({ tenantId, planId: plan.id });

      const result = await service.enforceQuota(tenantId, 'students', 101);
      expect(result.allowed).toBe(false);
      expect(result.used).toBe(0);
      expect(result.remaining).toBe(100);
    });

    it('should accumulate usage across multiple increments', async () => {
      const plan = await service.createPlan(createFreePlan());
      await service.updatePlan(plan.id, { status: 'active' });
      await service.subscribeTenant({ tenantId, planId: plan.id });

      await service.enforceQuota(tenantId, 'students', 50);
      await service.enforceQuota(tenantId, 'students', 30);
      const result = await service.enforceQuota(tenantId, 'students', 25);

      expect(result.allowed).toBe(false);
      expect(result.used).toBe(80);
    });

    it('should allow unlimited quota', async () => {
      const plan = await service.createPlan(createEnterprisePlan());
      await service.updatePlan(plan.id, { status: 'active' });
      await service.subscribeTenant({ tenantId, planId: plan.id });

      const result = await service.enforceQuota(tenantId, 'students', 1000000);
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(-1);
    });

    it('should deny usage when no subscription', async () => {
      const result = await service.enforceQuota(tenantId, 'students', 1);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('No active subscription');
    });

    it('should get usage for a metric', async () => {
      const plan = await service.createPlan(createFreePlan());
      await service.updatePlan(plan.id, { status: 'active' });
      await service.subscribeTenant({ tenantId, planId: plan.id });

      await service.enforceQuota(tenantId, 'students', 25);

      const usage = await service.getUsage(tenantId, 'students');
      expect(usage.used).toBe(25);
      expect(usage.limit).toBe(100);
      expect(usage.metric).toBe('students');
    });
  });

  // ─── Plan Upgrades & Downgrades ────────────────────────────────────────

  describe('Plan Upgrades & Downgrades', () => {
    it('should upgrade a plan', async () => {
      const freePlan = await service.createPlan(createFreePlan());
      await service.updatePlan(freePlan.id, { status: 'active' });

      const proPlan = await service.createPlan(createProPlan());
      await service.updatePlan(proPlan.id, { status: 'active' });

      await service.subscribeTenant({ tenantId, planId: freePlan.id });

      const upgraded = await service.upgradePlan(tenantId, { newPlanId: proPlan.id });
      expect(upgraded.planId).toBe(proPlan.id);
      expect(upgraded.previousPlanId).toBe(freePlan.id);
    });

    it('should reject upgrade to lower tier', async () => {
      const proPlan = await service.createPlan(createProPlan());
      await service.updatePlan(proPlan.id, { status: 'active' });

      const freePlan = await service.createPlan(createFreePlan());
      await service.updatePlan(freePlan.id, { status: 'active' });

      await service.subscribeTenant({ tenantId, planId: proPlan.id });

      await expect(
        service.upgradePlan(tenantId, { newPlanId: freePlan.id }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('should downgrade a plan with warnings', async () => {
      const proPlan = await service.createPlan(createProPlan());
      await service.updatePlan(proPlan.id, { status: 'active' });

      const freePlan = await service.createPlan(createFreePlan());
      await service.updatePlan(freePlan.id, { status: 'active' });

      await service.subscribeTenant({ tenantId, planId: proPlan.id });

      // Use some quota that exceeds the free plan limit
      await service.enforceQuota(tenantId, 'students', 500);

      const result = await service.downgradePlan(tenantId, { newPlanId: freePlan.id });
      expect(result.subscription.planId).toBe(freePlan.id);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]!.metric).toBe('students');
      expect(result.warnings[0]!.currentUsage).toBe(500);
      expect(result.warnings[0]!.newLimit).toBe(100);
    });

    it('should downgrade without warnings when usage is within limits', async () => {
      const proPlan = await service.createPlan(createProPlan());
      await service.updatePlan(proPlan.id, { status: 'active' });

      const freePlan = await service.createPlan(createFreePlan());
      await service.updatePlan(freePlan.id, { status: 'active' });

      await service.subscribeTenant({ tenantId, planId: proPlan.id });

      // Use quota within free plan limits
      await service.enforceQuota(tenantId, 'students', 50);

      const result = await service.downgradePlan(tenantId, { newPlanId: freePlan.id });
      expect(result.subscription.planId).toBe(freePlan.id);
      expect(result.warnings).toHaveLength(0);
    });

    it('should reject downgrade to higher tier', async () => {
      const freePlan = await service.createPlan(createFreePlan());
      await service.updatePlan(freePlan.id, { status: 'active' });

      const proPlan = await service.createPlan(createProPlan());
      await service.updatePlan(proPlan.id, { status: 'active' });

      await service.subscribeTenant({ tenantId, planId: freePlan.id });

      await expect(
        service.downgradePlan(tenantId, { newPlanId: proPlan.id }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('should re-provision entitlements after upgrade', async () => {
      const freePlan = await service.createPlan(createFreePlan());
      await service.updatePlan(freePlan.id, { status: 'active' });

      const proPlan = await service.createPlan(createProPlan());
      await service.updatePlan(proPlan.id, { status: 'active' });

      await service.subscribeTenant({ tenantId, planId: freePlan.id });

      // custom_fields should be disabled on free plan
      let result = await service.checkEntitlement(tenantId, 'custom_fields');
      expect(result.allowed).toBe(false);

      // Upgrade to pro
      await service.upgradePlan(tenantId, { newPlanId: proPlan.id });

      // custom_fields should now be enabled
      result = await service.checkEntitlement(tenantId, 'custom_fields');
      expect(result.allowed).toBe(true);
    });
  });
});
