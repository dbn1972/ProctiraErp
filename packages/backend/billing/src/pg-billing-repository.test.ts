/**
 * Live smoke for PgBillingRepository against DATABASE_URL (skipped otherwise) — G-704.
 */
import { randomUUID } from 'node:crypto';

import { getSharedPgPool } from '@proctira/database';
import { describe, expect, it } from 'vitest';

import { PgBillingRepository } from './pg-billing-repository.js';

const pool = getSharedPgPool();

describe('PgBillingRepository (live)', () => {
  it.skipIf(!pool)('persists plans, subscriptions, entitlements and usage', async () => {
    const repo = new PgBillingRepository(pool!);
    const tenantId = randomUUID();
    const planId = randomUUID();

    const plan = await repo.createPlan({
      id: planId,
      name: `Plan ${planId.slice(0, 8)}`,
      description: 'live',
      tier: 'starter',
      status: 'active',
      features: [{ featureKey: 'core', enabled: true }],
      quotas: [{ metric: 'students', limit: 100 }],
      priceMonthly: 10,
      priceYearly: 100,
      trialDays: 14,
      sortOrder: 1,
    });
    expect((await repo.findPlanByName(plan.name.toUpperCase()))?.id).toBe(planId);

    const subId = randomUUID();
    const now = new Date();
    await repo.createSubscription({
      id: subId,
      tenantId,
      planId,
      status: 'trial',
      trialEndsAt: new Date(now.getTime() + 86_400_000),
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000),
      cancelledAt: null,
      previousPlanId: null,
    });
    expect((await repo.findActiveSubscription(tenantId))?.id).toBe(subId);
    expect(await repo.findActiveSubscription(randomUUID())).toBeNull();

    const [ent] = await repo.upsertEntitlements([
      { id: randomUUID(), tenantId, subscriptionId: subId, featureKey: 'core', enabled: true, quotaLimit: 5 },
    ]);
    expect(ent?.enabled).toBe(true);
    expect((await repo.findEntitlement(tenantId, 'core'))?.quotaLimit).toBe(5);

    const usage = await repo.getOrCreateUsage(tenantId, subId, 'students', now, new Date(now.getTime() + 1000));
    const bumped = await repo.incrementUsage(usage.id, 3);
    expect(bumped.used).toBe(3);
    expect((await repo.getUsageByTenant(tenantId, now, new Date(now.getTime() + 1000)))[0]?.used).toBe(3);

    await repo.deleteEntitlementsBySubscription(subId);
    expect(await repo.findEntitlementsByTenant(tenantId)).toHaveLength(0);
    expect(await repo.deletePlan(planId)).toBe(true);
  });
});
