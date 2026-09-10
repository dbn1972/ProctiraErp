/**
 * Postgres billing repository (G-704) on `control_plane_documents`
 * (db/sql/022_control_plane_schema.sql) via PgDocumentCollection.
 *
 * Plans are platform-scoped (tenant_id NULL); subscriptions, entitlements and
 * usage are tenant-scoped so RLS applies. Filtering/sorting semantics mirror
 * InMemoryBillingRepository so the service layer is unchanged.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { PgDocumentCollection, type PgPoolWithConnect, type PgQueryable } from '@proctira/database';

import type {
  BillingRepository,
  EntitlementEntity,
  PlanEntity,
  PlanFilter,
  SubscriptionEntity,
  UsageEntity,
} from './billing-repository.js';

export class PgBillingRepository implements BillingRepository {
  private readonly plans: PgDocumentCollection<PlanEntity>;
  private readonly subscriptions: PgDocumentCollection<SubscriptionEntity>;
  private readonly entitlements: PgDocumentCollection<EntitlementEntity>;
  private readonly usage: PgDocumentCollection<UsageEntity>;

  constructor(pool: PgPoolWithConnect | PgQueryable) {
    this.plans = new PgDocumentCollection<PlanEntity>(pool, 'billing.plans');
    this.subscriptions = new PgDocumentCollection<SubscriptionEntity>(
      pool,
      'billing.subscriptions',
    );
    this.entitlements = new PgDocumentCollection<EntitlementEntity>(pool, 'billing.entitlements');
    this.usage = new PgDocumentCollection<UsageEntity>(pool, 'billing.usage');
  }

  // ─── Plans ───────────────────────────────────────────────────────────────

  async createPlan(data: Omit<PlanEntity, 'createdAt' | 'updatedAt'>): Promise<PlanEntity> {
    const now = new Date();
    const entity: PlanEntity = { ...data, createdAt: now, updatedAt: now };
    return this.plans.put(entity.id, entity);
  }

  async updatePlan(id: string, data: Partial<PlanEntity>): Promise<PlanEntity | null> {
    const existing = await this.plans.get(id);
    if (!existing) return null;
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
    return this.plans.put(id, updated);
  }

  findPlanById(id: string): Promise<PlanEntity | null> {
    return this.plans.get(id);
  }

  async findPlanByName(name: string): Promise<PlanEntity | null> {
    const all = await this.plans.all();
    return all.find((p) => p.name.toLowerCase() === name.toLowerCase()) ?? null;
  }

  async listPlans(
    filter: PlanFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<PlanEntity>> {
    let filtered = await this.plans.all();
    if (filter.tier) filtered = filtered.filter((p) => p.tier === filter.tier);
    if (filter.status) filtered = filtered.filter((p) => p.status === filter.status);
    if (filter.search) {
      const search = filter.search.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.name.toLowerCase().includes(search) ||
          (p.description !== null && p.description.toLowerCase().includes(search)),
      );
    }
    const sortBy = pagination.sortBy ?? 'sortOrder';
    const sortOrder = pagination.sortOrder ?? 'asc';
    filtered.sort((a, b) => {
      const aVal = (a as unknown as Record<string, unknown>)[sortBy];
      const bVal = (b as unknown as Record<string, unknown>)[sortBy];
      if (aVal === bVal) return 0;
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      const cmp = (aVal as number) < (bVal as number) ? -1 : 1;
      return sortOrder === 'asc' ? cmp : -cmp;
    });
    const totalItems = filtered.length;
    const start = (pagination.page - 1) * pagination.pageSize;
    return {
      data: filtered.slice(start, start + pagination.pageSize),
      meta: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / pagination.pageSize),
      },
    };
  }

  deletePlan(id: string): Promise<boolean> {
    return this.plans.delete(id);
  }

  // ─── Subscriptions ───────────────────────────────────────────────────────

  async createSubscription(
    data: Omit<SubscriptionEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<SubscriptionEntity> {
    const now = new Date();
    const entity: SubscriptionEntity = { ...data, createdAt: now, updatedAt: now };
    return this.subscriptions.put(entity.id, entity, entity.tenantId);
  }

  async updateSubscription(
    id: string,
    data: Partial<SubscriptionEntity>,
  ): Promise<SubscriptionEntity | null> {
    const existing = await this.subscriptions.get(id);
    if (!existing) return null;
    const updated: SubscriptionEntity = {
      id: existing.id,
      tenantId: existing.tenantId,
      planId: data.planId ?? existing.planId,
      status: data.status ?? existing.status,
      trialEndsAt: data.trialEndsAt !== undefined ? data.trialEndsAt : existing.trialEndsAt,
      currentPeriodStart: data.currentPeriodStart ?? existing.currentPeriodStart,
      currentPeriodEnd: data.currentPeriodEnd ?? existing.currentPeriodEnd,
      cancelledAt: data.cancelledAt !== undefined ? data.cancelledAt : existing.cancelledAt,
      previousPlanId:
        data.previousPlanId !== undefined ? data.previousPlanId : existing.previousPlanId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    return this.subscriptions.put(id, updated, updated.tenantId);
  }

  findSubscriptionById(id: string): Promise<SubscriptionEntity | null> {
    return this.subscriptions.get(id);
  }

  async findActiveSubscription(tenantId: string): Promise<SubscriptionEntity | null> {
    const subs = await this.subscriptions.byTenant(tenantId);
    return (
      subs.find((s) => s.status === 'active' || s.status === 'trial' || s.status === 'suspended') ??
      null
    );
  }

  findSubscriptionsByTenant(tenantId: string): Promise<SubscriptionEntity[]> {
    return this.subscriptions.byTenant(tenantId);
  }

  // ─── Entitlements ────────────────────────────────────────────────────────

  private entitlementKey(tenantId: string, featureKey: string): string {
    return `${tenantId}:${featureKey}`;
  }

  async upsertEntitlements(
    entitlements: Omit<EntitlementEntity, 'createdAt' | 'updatedAt'>[],
  ): Promise<EntitlementEntity[]> {
    const now = new Date();
    const results: EntitlementEntity[] = [];
    for (const data of entitlements) {
      const key = this.entitlementKey(data.tenantId, data.featureKey);
      const existing = await this.entitlements.get(key);
      const entity: EntitlementEntity = existing
        ? {
            ...existing,
            subscriptionId: data.subscriptionId,
            enabled: data.enabled,
            quotaLimit: data.quotaLimit,
            updatedAt: now,
          }
        : { ...data, createdAt: now, updatedAt: now };
      results.push(await this.entitlements.put(key, entity, entity.tenantId));
    }
    return results;
  }

  findEntitlementsByTenant(tenantId: string): Promise<EntitlementEntity[]> {
    return this.entitlements.byTenant(tenantId);
  }

  findEntitlement(tenantId: string, featureKey: string): Promise<EntitlementEntity | null> {
    return this.entitlements.get(this.entitlementKey(tenantId, featureKey));
  }

  async deleteEntitlementsBySubscription(subscriptionId: string): Promise<void> {
    const rows = await this.entitlements.where({ subscriptionId } as Partial<EntitlementEntity>);
    for (const row of rows) {
      await this.entitlements.delete(this.entitlementKey(row.tenantId, row.featureKey));
    }
  }

  // ─── Usage ───────────────────────────────────────────────────────────────

  async getOrCreateUsage(
    tenantId: string,
    subscriptionId: string,
    metric: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<UsageEntity> {
    const rows = await this.usage.byTenant(tenantId);
    const existing = rows.find(
      (u) =>
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
    return this.usage.put(entity.id, entity, tenantId);
  }

  async incrementUsage(id: string, increment: number): Promise<UsageEntity> {
    const existing = await this.usage.get(id);
    if (!existing) throw new Error(`Usage record with id '${id}' not found`);
    const updated: UsageEntity = {
      ...existing,
      used: existing.used + increment,
      updatedAt: new Date(),
    };
    return this.usage.put(id, updated, updated.tenantId);
  }

  async getUsage(
    tenantId: string,
    metric: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<UsageEntity | null> {
    const rows = await this.usage.byTenant(tenantId);
    return (
      rows.find(
        (u) =>
          u.metric === metric &&
          u.periodStart.getTime() >= periodStart.getTime() &&
          u.periodEnd.getTime() <= periodEnd.getTime(),
      ) ?? null
    );
  }

  async getUsageByTenant(
    tenantId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<UsageEntity[]> {
    const rows = await this.usage.byTenant(tenantId);
    return rows.filter(
      (u) =>
        u.periodStart.getTime() >= periodStart.getTime() &&
        u.periodEnd.getTime() <= periodEnd.getTime(),
    );
  }
}
