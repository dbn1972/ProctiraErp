/**
 * In-Memory Billing Repository
 *
 * Used for testing and development. Stores plans, subscriptions, entitlements,
 * and usage records in memory with full interface compliance.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import type {
  PlanEntity,
  SubscriptionEntity,
  EntitlementEntity,
  UsageEntity,
  PlanFilter,
  BillingRepository,
} from './billing-repository.js';

export class InMemoryBillingRepository implements BillingRepository {
  private plans: PlanEntity[] = [];
  private subscriptions: SubscriptionEntity[] = [];
  private entitlements: EntitlementEntity[] = [];
  private usageRecords: UsageEntity[] = [];

  // ─── Plan CRUD ───────────────────────────────────────────────────────────

  async createPlan(data: Omit<PlanEntity, 'createdAt' | 'updatedAt'>): Promise<PlanEntity> {
    const now = new Date();
    const entity: PlanEntity = {
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    this.plans.push(entity);
    return entity;
  }

  async updatePlan(id: string, data: Partial<PlanEntity>): Promise<PlanEntity | null> {
    const index = this.plans.findIndex((p) => p.id === id);
    if (index === -1) return null;

    const existing = this.plans[index]!;
    const updated: PlanEntity = {
      id: existing.id,
      name: data.name ?? existing.name,
      description: data.description !== undefined ? data.description : existing.description,
      tier: data.tier ?? existing.tier,
      status: data.status ?? existing.status,
      features: data.features ?? existing.features,
      quotas: data.quotas ?? existing.quotas,
      priceMonthly: data.priceMonthly !== undefined ? data.priceMonthly : existing.priceMonthly,
      priceYearly: data.priceYearly !== undefined ? data.priceYearly : existing.priceYearly,
      trialDays: data.trialDays ?? existing.trialDays,
      sortOrder: data.sortOrder ?? existing.sortOrder,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.plans[index] = updated;
    return updated;
  }

  async findPlanById(id: string): Promise<PlanEntity | null> {
    return this.plans.find((p) => p.id === id) ?? null;
  }

  async findPlanByName(name: string): Promise<PlanEntity | null> {
    return this.plans.find(
      (p) => p.name.toLowerCase() === name.toLowerCase(),
    ) ?? null;
  }

  async listPlans(
    filter: PlanFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<PlanEntity>> {
    let filtered = [...this.plans];

    if (filter.tier) {
      filtered = filtered.filter((p) => p.tier === filter.tier);
    }
    if (filter.status) {
      filtered = filtered.filter((p) => p.status === filter.status);
    }
    if (filter.search) {
      const search = filter.search.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.name.toLowerCase().includes(search) ||
          (p.description && p.description.toLowerCase().includes(search)),
      );
    }

    // Sort
    const sortBy = pagination.sortBy ?? 'sortOrder';
    const sortOrder = pagination.sortOrder ?? 'asc';
    filtered.sort((a, b) => {
      const aVal = (a as unknown as Record<string, unknown>)[sortBy];
      const bVal = (b as unknown as Record<string, unknown>)[sortBy];
      if (aVal === bVal) return 0;
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      const cmp = aVal < bVal ? -1 : 1;
      return sortOrder === 'asc' ? cmp : -cmp;
    });

    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / pagination.pageSize);
    const start = (pagination.page - 1) * pagination.pageSize;
    const data = filtered.slice(start, start + pagination.pageSize);

    return {
      data,
      meta: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        totalItems,
        totalPages,
      },
    };
  }

  async deletePlan(id: string): Promise<boolean> {
    const index = this.plans.findIndex((p) => p.id === id);
    if (index === -1) return false;
    this.plans.splice(index, 1);
    return true;
  }

  // ─── Subscription CRUD ───────────────────────────────────────────────────

  async createSubscription(data: Omit<SubscriptionEntity, 'createdAt' | 'updatedAt'>): Promise<SubscriptionEntity> {
    const now = new Date();
    const entity: SubscriptionEntity = {
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    this.subscriptions.push(entity);
    return entity;
  }

  async updateSubscription(id: string, data: Partial<SubscriptionEntity>): Promise<SubscriptionEntity | null> {
    const index = this.subscriptions.findIndex((s) => s.id === id);
    if (index === -1) return null;

    const existing = this.subscriptions[index]!;
    const updated: SubscriptionEntity = {
      id: existing.id,
      tenantId: existing.tenantId,
      planId: data.planId ?? existing.planId,
      status: data.status ?? existing.status,
      trialEndsAt: data.trialEndsAt !== undefined ? data.trialEndsAt : existing.trialEndsAt,
      currentPeriodStart: data.currentPeriodStart ?? existing.currentPeriodStart,
      currentPeriodEnd: data.currentPeriodEnd ?? existing.currentPeriodEnd,
      cancelledAt: data.cancelledAt !== undefined ? data.cancelledAt : existing.cancelledAt,
      previousPlanId: data.previousPlanId !== undefined ? data.previousPlanId : existing.previousPlanId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.subscriptions[index] = updated;
    return updated;
  }

  async findSubscriptionById(id: string): Promise<SubscriptionEntity | null> {
    return this.subscriptions.find((s) => s.id === id) ?? null;
  }

  async findActiveSubscription(tenantId: string): Promise<SubscriptionEntity | null> {
    return this.subscriptions.find(
      (s) => s.tenantId === tenantId && (s.status === 'active' || s.status === 'trial' || s.status === 'suspended'),
    ) ?? null;
  }

  async findSubscriptionsByTenant(tenantId: string): Promise<SubscriptionEntity[]> {
    return this.subscriptions.filter((s) => s.tenantId === tenantId);
  }

  // ─── Entitlements ────────────────────────────────────────────────────────

  async upsertEntitlements(entitlements: Omit<EntitlementEntity, 'createdAt' | 'updatedAt'>[]): Promise<EntitlementEntity[]> {
    const now = new Date();
    const results: EntitlementEntity[] = [];

    for (const data of entitlements) {
      const existingIndex = this.entitlements.findIndex(
        (e) => e.tenantId === data.tenantId && e.featureKey === data.featureKey,
      );

      if (existingIndex >= 0) {
        const existing = this.entitlements[existingIndex]!;
        const updated: EntitlementEntity = {
          ...existing,
          subscriptionId: data.subscriptionId,
          enabled: data.enabled,
          quotaLimit: data.quotaLimit,
          updatedAt: now,
        };
        this.entitlements[existingIndex] = updated;
        results.push(updated);
      } else {
        const entity: EntitlementEntity = {
          ...data,
          createdAt: now,
          updatedAt: now,
        };
        this.entitlements.push(entity);
        results.push(entity);
      }
    }

    return results;
  }

  async findEntitlementsByTenant(tenantId: string): Promise<EntitlementEntity[]> {
    return this.entitlements.filter((e) => e.tenantId === tenantId);
  }

  async findEntitlement(tenantId: string, featureKey: string): Promise<EntitlementEntity | null> {
    return this.entitlements.find(
      (e) => e.tenantId === tenantId && e.featureKey === featureKey,
    ) ?? null;
  }

  async deleteEntitlementsBySubscription(subscriptionId: string): Promise<void> {
    this.entitlements = this.entitlements.filter((e) => e.subscriptionId !== subscriptionId);
  }

  // ─── Usage Tracking ──────────────────────────────────────────────────────

  async getOrCreateUsage(
    tenantId: string,
    subscriptionId: string,
    metric: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<UsageEntity> {
    const existing = this.usageRecords.find(
      (u) =>
        u.tenantId === tenantId &&
        u.metric === metric &&
        u.periodStart.getTime() === periodStart.getTime() &&
        u.periodEnd.getTime() === periodEnd.getTime(),
    );

    if (existing) return existing;

    const now = new Date();
    const entity: UsageEntity = {
      id: crypto.randomUUID(),
      tenantId,
      subscriptionId,
      metric,
      used: 0,
      periodStart,
      periodEnd,
      createdAt: now,
      updatedAt: now,
    };
    this.usageRecords.push(entity);
    return entity;
  }

  async incrementUsage(id: string, increment: number): Promise<UsageEntity> {
    const index = this.usageRecords.findIndex((u) => u.id === id);
    if (index === -1) {
      throw new Error(`Usage record with id '${id}' not found`);
    }

    const existing = this.usageRecords[index]!;
    const updated: UsageEntity = {
      ...existing,
      used: existing.used + increment,
      updatedAt: new Date(),
    };
    this.usageRecords[index] = updated;
    return updated;
  }

  async getUsage(tenantId: string, metric: string, periodStart: Date, periodEnd: Date): Promise<UsageEntity | null> {
    return this.usageRecords.find(
      (u) =>
        u.tenantId === tenantId &&
        u.metric === metric &&
        u.periodStart.getTime() >= periodStart.getTime() &&
        u.periodEnd.getTime() <= periodEnd.getTime(),
    ) ?? null;
  }

  async getUsageByTenant(tenantId: string, periodStart: Date, periodEnd: Date): Promise<UsageEntity[]> {
    return this.usageRecords.filter(
      (u) =>
        u.tenantId === tenantId &&
        u.periodStart.getTime() >= periodStart.getTime() &&
        u.periodEnd.getTime() <= periodEnd.getTime(),
    );
  }

  // ─── Test Helpers ────────────────────────────────────────────────────────

  /** Clear all data (for testing) */
  clear(): void {
    this.plans = [];
    this.subscriptions = [];
    this.entitlements = [];
    this.usageRecords = [];
  }
}
