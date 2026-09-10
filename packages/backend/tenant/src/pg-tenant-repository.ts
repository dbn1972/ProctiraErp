/**
 * Postgres tenant-lifecycle repository (G-704) on `control_plane_documents`
 * (db/sql/022_control_plane_schema.sql) via PgDocumentCollection.
 *
 * Tenant rows and domains are platform-scoped documents (the control plane
 * owns them); usage, theme versions and branding drafts carry the tenant id
 * so RLS applies. Filtering/sorting mirrors InMemoryTenantRepository so the
 * service layer is unchanged.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { PgDocumentCollection, type PgPoolWithConnect, type PgQueryable } from '@proctira/database';
import { v4 as uuidv4 } from 'uuid';

import type {
  DomainEntity,
  TenantBrandingDraftEntity,
  TenantEntity,
  TenantFilter,
  TenantRepository,
  TenantThemeVersionEntity,
  TenantUsageEntity,
} from './tenant-repository.js';

export class PgTenantRepository implements TenantRepository {
  private readonly tenants: PgDocumentCollection<TenantEntity>;
  private readonly domains: PgDocumentCollection<DomainEntity>;
  private readonly usage: PgDocumentCollection<TenantUsageEntity>;
  private readonly themeVersions: PgDocumentCollection<TenantThemeVersionEntity>;
  private readonly brandingDrafts: PgDocumentCollection<TenantBrandingDraftEntity>;

  constructor(pool: PgPoolWithConnect | PgQueryable) {
    this.tenants = new PgDocumentCollection<TenantEntity>(pool, 'tenant.tenants');
    this.domains = new PgDocumentCollection<DomainEntity>(pool, 'tenant.domains');
    this.usage = new PgDocumentCollection<TenantUsageEntity>(pool, 'tenant.usage');
    this.themeVersions = new PgDocumentCollection<TenantThemeVersionEntity>(
      pool,
      'tenant.theme_versions',
    );
    this.brandingDrafts = new PgDocumentCollection<TenantBrandingDraftEntity>(
      pool,
      'tenant.branding_drafts',
    );
  }

  // ─── Tenant CRUD ─────────────────────────────────────────────────────────

  async createTenant(data: Omit<TenantEntity, 'createdAt' | 'updatedAt'>): Promise<TenantEntity> {
    const now = new Date();
    const entity: TenantEntity = { ...data, createdAt: now, updatedAt: now };
    return this.tenants.put(entity.id, entity);
  }

  async updateTenant(id: string, data: Partial<TenantEntity>): Promise<TenantEntity | null> {
    const existing = await this.tenants.get(id);
    if (!existing) return null;
    const updated: TenantEntity = {
      id: existing.id,
      name: data.name ?? existing.name,
      slug: existing.slug,
      status: data.status ?? existing.status,
      plan: data.plan !== undefined ? data.plan : existing.plan,
      region: data.region !== undefined ? data.region : existing.region,
      config: data.config ?? existing.config,
      suspendedAt: data.suspendedAt !== undefined ? data.suspendedAt : existing.suspendedAt,
      suspendedReason:
        data.suspendedReason !== undefined ? data.suspendedReason : existing.suspendedReason,
      decommissionedAt:
        data.decommissionedAt !== undefined ? data.decommissionedAt : existing.decommissionedAt,
      dataRetentionUntil:
        data.dataRetentionUntil !== undefined
          ? data.dataRetentionUntil
          : existing.dataRetentionUntil,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    return this.tenants.put(id, updated);
  }

  findTenantById(id: string): Promise<TenantEntity | null> {
    return this.tenants.get(id);
  }

  async findTenantBySlug(slug: string): Promise<TenantEntity | null> {
    const all = await this.tenants.all();
    return all.find((t) => t.slug.toLowerCase() === slug.toLowerCase()) ?? null;
  }

  async listTenants(
    filter: TenantFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<TenantEntity>> {
    let filtered = await this.tenants.all();
    if (filter.status) filtered = filtered.filter((t) => t.status === filter.status);
    if (filter.region) filtered = filtered.filter((t) => t.region === filter.region);
    if (filter.search) {
      const search = filter.search.toLowerCase();
      filtered = filtered.filter(
        (t) => t.name.toLowerCase().includes(search) || t.slug.toLowerCase().includes(search),
      );
    }

    const sortBy = pagination.sortBy ?? 'createdAt';
    const sortOrder = pagination.sortOrder ?? 'desc';
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

  async deleteTenant(id: string): Promise<boolean> {
    const removed = await this.tenants.delete(id);
    if (!removed) return false;
    const domains = await this.domains.where({ tenantId: id } as Partial<DomainEntity>);
    for (const d of domains) await this.domains.delete(d.id);
    await this.usage.delete(id);
    return true;
  }

  // ─── Domain Management ───────────────────────────────────────────────────

  addDomain(data: DomainEntity): Promise<DomainEntity> {
    return this.domains.put(data.id, data);
  }

  async removeDomain(tenantId: string, domainId: string): Promise<boolean> {
    const existing = await this.domains.get(domainId);
    if (!existing || existing.tenantId !== tenantId) return false;
    return this.domains.delete(domainId);
  }

  findDomainsByTenant(tenantId: string): Promise<DomainEntity[]> {
    return this.domains.where({ tenantId } as Partial<DomainEntity>);
  }

  async findDomainByName(domain: string): Promise<DomainEntity | null> {
    const all = await this.domains.all();
    return all.find((d) => d.domain.toLowerCase() === domain.toLowerCase()) ?? null;
  }

  // ─── Usage Tracking ──────────────────────────────────────────────────────

  async getOrCreateUsage(tenantId: string): Promise<TenantUsageEntity> {
    const existing = await this.usage.get(tenantId);
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
    return this.usage.put(tenantId, entity, tenantId);
  }

  async updateUsage(
    tenantId: string,
    data: Partial<TenantUsageEntity>,
  ): Promise<TenantUsageEntity> {
    const existing = await this.getOrCreateUsage(tenantId);
    const updated: TenantUsageEntity = {
      ...existing,
      ...data,
      tenantId,
      lastUpdated: new Date(),
    };
    return this.usage.put(tenantId, updated, tenantId);
  }

  // ─── Theme Versioning (append-only) ──────────────────────────────────────

  async insertThemeVersion(
    data: Omit<TenantThemeVersionEntity, 'id' | 'revision' | 'publishedAt'> & {
      id?: string;
      publishedAt?: Date;
    },
  ): Promise<TenantThemeVersionEntity> {
    const existing = await this.themeVersions.byTenant(data.tenantId);
    const maxRevision = existing.reduce((acc, row) => (row.revision > acc ? row.revision : acc), 0);
    const entity: TenantThemeVersionEntity = {
      id: data.id ?? uuidv4(),
      tenantId: data.tenantId,
      revision: maxRevision + 1,
      tokens: structuredClone(data.tokens),
      publishedAt: data.publishedAt ?? new Date(),
      publishedBy: data.publishedBy,
    };
    return this.themeVersions.put(entity.id, entity, entity.tenantId);
  }

  async findThemeVersion(
    tenantId: string,
    revision: number,
  ): Promise<TenantThemeVersionEntity | null> {
    const rows = await this.themeVersions.byTenant(tenantId);
    return rows.find((r) => r.revision === revision) ?? null;
  }

  async listThemeVersions(tenantId: string): Promise<TenantThemeVersionEntity[]> {
    const rows = await this.themeVersions.byTenant(tenantId);
    return rows.sort((a, b) => a.revision - b.revision);
  }

  async findLatestThemeVersion(tenantId: string): Promise<TenantThemeVersionEntity | null> {
    const sorted = await this.listThemeVersions(tenantId);
    return sorted.length === 0 ? null : sorted[sorted.length - 1]!;
  }

  // ─── Theme Drafts ────────────────────────────────────────────────────────

  upsertBrandingDraft(
    data: Omit<TenantBrandingDraftEntity, 'savedAt'> & { savedAt?: Date },
  ): Promise<TenantBrandingDraftEntity> {
    const entity: TenantBrandingDraftEntity = {
      tenantId: data.tenantId,
      tokens: structuredClone(data.tokens),
      savedAt: data.savedAt ?? new Date(),
      savedBy: data.savedBy,
    };
    return this.brandingDrafts.put(data.tenantId, entity, data.tenantId);
  }

  findBrandingDraft(tenantId: string): Promise<TenantBrandingDraftEntity | null> {
    return this.brandingDrafts.get(tenantId);
  }

  deleteBrandingDraft(tenantId: string): Promise<boolean> {
    return this.brandingDrafts.delete(tenantId);
  }
}
