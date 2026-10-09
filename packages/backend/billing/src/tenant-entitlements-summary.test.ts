/**
 * PRC-H044 — tenant self-service entitlements summary (GET /billing/me/entitlements).
 *
 * Verifies the fail-closed default (no plan ⇒ not subscribed, empty sets) and
 * that an active subscription surfaces the plan's features and quota usage.
 */
import { describe, expect, it, beforeEach } from 'vitest';

import { BillingService } from './billing-service.js';
import { InMemoryBillingRepository } from './in-memory-repository.js';
import type { CreatePlanInput } from './schemas.js';

const tenantId = '550e8400-e29b-41d4-a716-446655440000';

const proPlan = (): CreatePlanInput => ({
  name: 'Pro',
  description: 'Pro tier',
  tier: 'professional',
  features: [
    { featureKey: 'library', enabled: true },
    { featureKey: 'hostel', enabled: false },
  ],
  quotas: [{ metric: 'students', limit: 2 }],
  trialDays: 0,
});

describe('PRC-H044 BillingService.getTenantEntitlements', () => {
  let service: BillingService;
  let repository: InMemoryBillingRepository;

  beforeEach(() => {
    repository = new InMemoryBillingRepository();
    service = new BillingService(repository);
  });

  it('fails closed when the tenant has no subscription (no plan assigned)', async () => {
    const summary = await service.getTenantEntitlements(tenantId);
    expect(summary.subscribed).toBe(false);
    expect(summary.status).toBe('none');
    expect(summary.features).toEqual([]);
    expect(summary.quotas).toEqual([]);
  });

  it('reports plan features (enabled flags) and quota usage for an active subscription', async () => {
    const plan = await service.createPlan(proPlan());
    await service.updatePlan(plan.id, { status: 'active' });
    await service.subscribeTenant({ tenantId, planId: plan.id, startTrial: false });

    // Consume one student seat.
    await service.enforceQuota(tenantId, 'students', 1);

    const summary = await service.getTenantEntitlements(tenantId);
    expect(summary.subscribed).toBe(true);
    expect(summary.status).toBe('active');
    expect(summary.planId).toBe(plan.id);

    const library = summary.features.find((f) => f.featureKey === 'library');
    const hostel = summary.features.find((f) => f.featureKey === 'hostel');
    expect(library?.enabled).toBe(true);
    expect(hostel?.enabled).toBe(false);

    const students = summary.quotas.find((q) => q.metric === 'students');
    expect(students).toEqual({ metric: 'students', used: 1, limit: 2, remaining: 1 });
  });
});
