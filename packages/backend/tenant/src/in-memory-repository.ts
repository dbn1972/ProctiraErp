/**
 * In-Memory Tenant Repository
 *
 * Used for testing and development. Stores tenants, domains, and usage
 * records in memory with full interface compliance.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';
import type {
  TenantEntity,
  DomainEntity,
  TenantUsageEntity,
  TenantThemeVersionEntity,
  TenantBrandingDraftEntity,
  TenantFilter,
  TenantRepository,
} from './tenant-repository.js';

export class InMemoryTenantRepository implements TenantRepository {
  private tenants: TenantEntity[] = [];
  private domains: DomainEntity[] = [];
  private usageRecords: TenantUsageEntity[] = [];
  /**
   * Append-only theme version log — mirrors the `tenant_theme_versions`
   * SQL table (Task 58.2 / Design §N). Rows are NEVER mutated or removed
   * through the repository surface (the only test helper that resets the
   * log is `clear()`, which simulates a fresh database for unit tests).
   */
  private readonly themeVersions: TenantThemeVersionEntity[] = [];
  /**
   * Mutable per-tenant branding drafts (Task 58.3) — at most one entry per
   * tenant. Keyed by `tenantId` for O(1) upsert / read / delete.
   */
  private readonly brandingDrafts = new Map<string, TenantBrandingDraftEntity>();

  // ─── Tenant CRUD ─────────────────────────────────────────────────────────

  async createTenant(data: Omit<TenantEntity, 'createdAt' | 'updatedAt'>): Promise<TenantEntity> {
    const now = new Date();
    const entity: TenantEntity = {
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    this.tenants.push(entity);
    return entity;
  }

  async updateTenant(id: string, data: Partial<TenantEntity>): Promise<TenantEntity | null> {
    const index = this.tenants.findIndex((t) => t.id === id);
    if (index === -1) return null;

    const existing = this.tenants[index]!;
    const updated: TenantEntity = {
      id: existing.id,
      name: data.name ?? existing.name,
      slug: existing.slug, // Slug is immutable
      status: data.status ?? existing.status,
      plan: data.plan !== undefined ? data.plan : existing.plan,
      region: data.region !== undefined ? data.region : existing.region,
      config: data.config ?? existing.config,
      suspendedAt: data.suspendedAt !== undefined ? data.suspendedAt : existing.suspendedAt,
      suspendedReason: data.suspendedReason !== undefined ? data.suspendedReason : existing.suspendedReason,
      decommissionedAt: data.decommissionedAt !== undefined ? data.decommissionedAt : existing.decommissionedAt,
      dataRetentionUntil: data.dataRetentionUntil !== undefined ? data.dataRetentionUntil : existing.dataRetentionUntil,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.tenants[index] = updated;
    return updated;
  }

  async findTenantById(id: string): Promise<TenantEntity | null> {
    return this.tenants.find((t) => t.id === id) ?? null;
  }

  async findTenantBySlug(slug: string): Promise<TenantEntity | null> {
    return this.tenants.find(
      (t) => t.slug.toLowerCase() === slug.toLowerCase(),
    ) ?? null;
  }

  async listTenants(
    filter: TenantFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<TenantEntity>> {
    let filtered = [...this.tenants];

    if (filter.status) {
      filtered = filtered.filter((t) => t.status === filter.status);
    }
    if (filter.region) {
      filtered = filtered.filter((t) => t.region === filter.region);
    }
    if (filter.search) {
      const search = filter.search.toLowerCase();
      filtered = filtered.filter(
        (t) =>
          t.name.toLowerCase().includes(search) ||
          t.slug.toLowerCase().includes(search),
      );
    }

    // Sort
    const sortBy = pagination.sortBy ?? 'createdAt';
    const sortOrder = pagination.sortOrder ?? 'desc';
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

  async deleteTenant(id: string): Promise<boolean> {
    const index = this.tenants.findIndex((t) => t.id === id);
    if (index === -1) return false;
    this.tenants.splice(index, 1);
    // Also remove associated domains and usage
    this.domains = this.domains.filter((d) => d.tenantId !== id);
    this.usageRecords = this.usageRecords.filter((u) => u.tenantId !== id);
    return true;
  }

  // ─── Domain Management ───────────────────────────────────────────────────

  async addDomain(data: DomainEntity): Promise<DomainEntity> {
    this.domains.push(data);
    return data;
  }

  async removeDomain(tenantId: string, domainId: string): Promise<boolean> {
    const index = this.domains.findIndex(
      (d) => d.tenantId === tenantId && d.id === domainId,
    );
    if (index === -1) return false;
    this.domains.splice(index, 1);
    return true;
  }

  async findDomainsByTenant(tenantId: string): Promise<DomainEntity[]> {
    return this.domains.filter((d) => d.tenantId === tenantId);
  }

  async findDomainByName(domain: string): Promise<DomainEntity | null> {
    return this.domains.find(
      (d) => d.domain.toLowerCase() === domain.toLowerCase(),
    ) ?? null;
  }

  // ─── Usage Tracking ──────────────────────────────────────────────────────

  async getOrCreateUsage(tenantId: string): Promise<TenantUsageEntity> {
    const existing = this.usageRecords.find((u) => u.tenantId === tenantId);
    if (existing) return existing;

    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    const entity: TenantUsageEntity = {
      tenantId,
      storageUsedBytes: 0,
      storageLimitBytes: -1,
      activeUsers: 0,
      totalUsers: 0,
      userLimit: -1,
      apiCallsCurrent: 0,
      apiCallsLimit: -1,
      periodStart: now,
      periodEnd,
      lastUpdated: now,
    };
    this.usageRecords.push(entity);
    return entity;
  }

  async updateUsage(tenantId: string, data: Partial<TenantUsageEntity>): Promise<TenantUsageEntity> {
    const index = this.usageRecords.findIndex((u) => u.tenantId === tenantId);
    if (index === -1) {
      // Create if not exists
      const usage = await this.getOrCreateUsage(tenantId);
      const usageIndex = this.usageRecords.findIndex((u) => u.tenantId === tenantId);
      const updated: TenantUsageEntity = { ...usage, ...data, lastUpdated: new Date() };
      this.usageRecords[usageIndex] = updated;
      return updated;
    }

    const existing = this.usageRecords[index]!;
    const updated: TenantUsageEntity = {
      ...existing,
      ...data,
      tenantId, // Ensure tenantId is not overwritten
      lastUpdated: new Date(),
    };
    this.usageRecords[index] = updated;
    return updated;
  }

  // ─── Theme Versioning (Task 58.2 — append-only) ──────────────────────────

  async insertThemeVersion(
    data: Omit<TenantThemeVersionEntity, 'id' | 'revision' | 'publishedAt'> & {
      id?: string;
      publishedAt?: Date;
    },
  ): Promise<TenantThemeVersionEntity> {
    // Allocate the next revision atomically — for the in-memory store the
    // single-threaded JavaScript event loop already serializes us here, so
    // we just compute MAX(revision) + 1 over the existing rows.
    const existing = this.themeVersions.filter((row) => row.tenantId === data.tenantId);
    const maxRevision = existing.reduce(
      (acc, row) => (row.revision > acc ? row.revision : acc),
      0,
    );
    const nextRevision = maxRevision + 1;

    const entity: TenantThemeVersionEntity = {
      id: data.id ?? uuidv4(),
      tenantId: data.tenantId,
      revision: nextRevision,
      // Defensive deep-clone — guarantees the stored row is independent of
      // any mutations the caller may make to the input object after the
      // insert returns. Mirrors PostgreSQL JSONB-by-value semantics.
      tokens: structuredClone(data.tokens),
      publishedAt: data.publishedAt ?? new Date(),
      publishedBy: data.publishedBy,
    };

    this.themeVersions.push(entity);
    // Return a clone so external callers cannot mutate our internal row.
    return { ...entity, tokens: structuredClone(entity.tokens) };
  }

  async findThemeVersion(
    tenantId: string,
    revision: number,
  ): Promise<TenantThemeVersionEntity | null> {
    const found = this.themeVersions.find(
      (row) => row.tenantId === tenantId && row.revision === revision,
    );
    return found ? { ...found, tokens: structuredClone(found.tokens) } : null;
  }

  async listThemeVersions(tenantId: string): Promise<TenantThemeVersionEntity[]> {
    return this.themeVersions
      .filter((row) => row.tenantId === tenantId)
      .sort((a, b) => a.revision - b.revision)
      .map((row) => ({ ...row, tokens: structuredClone(row.tokens) }));
  }

  async findLatestThemeVersion(
    tenantId: string,
  ): Promise<TenantThemeVersionEntity | null> {
    const sorted = await this.listThemeVersions(tenantId);
    return sorted.length === 0 ? null : sorted[sorted.length - 1]!;
  }

  // ─── Theme Drafts (Task 58.3) ────────────────────────────────────────────

  async upsertBrandingDraft(
    data: Omit<TenantBrandingDraftEntity, 'savedAt'> & { savedAt?: Date },
  ): Promise<TenantBrandingDraftEntity> {
    const entity: TenantBrandingDraftEntity = {
      tenantId: data.tenantId,
      // Defensive deep-clone — guarantees the stored row is independent of
      // any mutations the caller may make to the input object after the
      // upsert returns.
      tokens: structuredClone(data.tokens),
      savedAt: data.savedAt ?? new Date(),
      savedBy: data.savedBy,
    };
    this.brandingDrafts.set(data.tenantId, entity);
    return { ...entity, tokens: structuredClone(entity.tokens) };
  }

  async findBrandingDraft(
    tenantId: string,
  ): Promise<TenantBrandingDraftEntity | null> {
    const found = this.brandingDrafts.get(tenantId);
    return found ? { ...found, tokens: structuredClone(found.tokens) } : null;
  }

  async deleteBrandingDraft(tenantId: string): Promise<boolean> {
    return this.brandingDrafts.delete(tenantId);
  }

  // ─── Test Helpers ────────────────────────────────────────────────────────

  /** Clear all data (for testing) */
  clear(): void {
    this.tenants = [];
    this.domains = [];
    this.usageRecords = [];
    this.themeVersions.length = 0;
    this.brandingDrafts.clear();
  }
}
