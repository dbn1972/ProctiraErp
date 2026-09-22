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
import {
  PgDocumentCollection,
  withPgTenant,
  type PgPoolWithConnect,
  type PgQueryable,
} from '@proctira/database';
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

/** Shape of the `tenants` table columns the fallback reads. */
interface TenantTableRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  config: unknown;
  legal_hold: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

/** `timestamp without time zone` comes back as a string from some drivers. */
function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(String(value));
}

/**
 * Tenant ids reach this repository from JWT claims and URL params. `tenants.id` is
 * `uuid`, so a malformed value raises 22P02 (a 500) instead of simply not matching.
 * Every statement that interpolates an id into a `::uuid` cast checks this first.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PgTenantRepository implements TenantRepository {
  private readonly tenants: PgDocumentCollection<TenantEntity>;
  private readonly domains: PgDocumentCollection<DomainEntity>;
  private readonly usage: PgDocumentCollection<TenantUsageEntity>;
  private readonly themeVersions: PgDocumentCollection<TenantThemeVersionEntity>;
  private readonly brandingDrafts: PgDocumentCollection<TenantBrandingDraftEntity>;

  /** Retained for the `tenants`-table fallback in {@link findTenantById}. */
  private readonly pool: PgPoolWithConnect | PgQueryable;

  constructor(pool: PgPoolWithConnect | PgQueryable) {
    this.pool = pool;
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
      legalHold: data.legalHold !== undefined ? data.legalHold : (existing.legalHold ?? false),
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    return this.tenants.put(id, updated);
  }

  /**
   * Find a tenant, falling back to the `tenants` table when the control plane has
   * no document for it.
   *
   * ## Why a fallback is needed
   *
   * Tenant identity lives in two places and nothing reconciles them:
   *
   *   • `control_plane_documents` collection `tenant.tenants` — written only by
   *     `createTenant` here, i.e. only by the tenant-lifecycle service
   *   • the `tenants` **table** — what migrations, seeds and registration create,
   *     and what 20+ domain tables carry a validated `tenant_id` FK to
   *
   * A tenant created any way other than through this service therefore had no
   * document, so `findTenantById` returned null and every caller 404'd. The
   * user-visible effect was severe and silent: `apps/web`'s root layout fetches
   * `GET /api/v1/tenant/branding` on **every page**, so a real deployment logged
   *
   *   404 "Tenant with id '…' not found"
   *
   * on 159 of 193 pages. Confirmed live: the evaluation database holds 940 rows in
   * `tenants` and 0 documents in collection `tenant.tenants`, so before this fallback
   * `findTenantById` resolved none of them.
   *
   * ## What the fallback does and does not do
   *
   * The document remains authoritative when present, so tenant-lifecycle state is
   * never overwritten by a table read. When absent, the row is mapped faithfully:
   * `id`, `name`, `slug`, `status`, `config`, `legalHold`, `createdAt` and
   * `updatedAt` come from real columns. The six lifecycle fields the table does not
   * track — `plan`, `region`, `suspendedAt`, `suspendedReason`, `decommissionedAt`,
   * `dataRetentionUntil` — are returned as `null`, which is the truthful answer
   * ("the control plane holds no lifecycle record for this tenant") rather than an
   * invented default.
   *
   * This does **not** close the underlying split, and is not meant to. Charter
   * findings V2 and V7 cover one identity with two owners; this makes reads coherent
   * so the product stops 404ing on every page, and leaves the ownership decision
   * open. A tenant read through the fallback will show `plan: null` even if a plan
   * exists elsewhere, so do not treat these fields as authoritative for billing.
   */
  async findTenantById(id: string): Promise<TenantEntity | null> {
    const doc = await this.tenants.get(id);
    if (doc) return doc;
    return this.findTenantInTable(id);
  }

  /**
   * Read a tenant straight from the `tenants` table.
   *
   * Runs on the same pool as the document collections, but unlike them it must bind
   * `app.tenant_id` first — see the comment in the body for why an unscoped read
   * returns zero rows.
   */
  private async findTenantInTable(id: string): Promise<TenantEntity | null> {
    if (!UUID_RE.test(id)) return null;
    // `tenants` has FORCE ROW LEVEL SECURITY with
    //   id::text = app.tenant_id  OR  app.platform_admin = '1'
    // so an unscoped read returns zero rows and this fallback would silently do
    // nothing — which is exactly how the first version of it failed.
    //
    // Binds `app.tenant_id` to the id being read rather than taking platform scope:
    // we are resolving precisely that tenant, so this satisfies the policy while
    // granting no visibility of any other tenant's row.
    const result = await withPgTenant(this.pool, id, (client) =>
      client.query(
        `SELECT id, name, slug, status, config, legal_hold, created_at, updated_at
           FROM tenants
          WHERE id = $1::uuid AND deleted_at IS NULL`,
        [id],
      ),
    );
    const row = (result.rows as TenantTableRow[])[0];
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status as TenantEntity['status'],
      config: (row.config ?? {}) as TenantEntity['config'],
      legalHold: row.legal_hold,
      createdAt: asDate(row.created_at),
      updatedAt: asDate(row.updated_at),
      // Not columns on `tenants`. null means "not recorded", not "zero"/"none".
      plan: null,
      region: null,
      suspendedAt: null,
      suspendedReason: null,
      decommissionedAt: null,
      dataRetentionUntil: null,
    };
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

  /**
   * Permanently remove the tenant's control-plane record and mark its `tenants` row
   * deleted.
   *
   * The row soft-delete is required by {@link findTenantById}'s fallback, not
   * optional tidying. Deleting only the document used to be enough because the
   * document was the only thing a read consulted; now that a read falls back to the
   * table, a document-only delete would let a permanently deleted tenant reappear on
   * the next lookup — `TenantService.deleteTenant` would log "permanently deleted"
   * and a subsequent GET would return 200. The fallback filters `deleted_at IS NULL`,
   * so marking the row closes that hole.
   *
   * Soft, not hard: `control_plane_documents.tenant_id` is a real uuid FK to
   * `tenants(id)` (db/sql/100), and other tenant-owned tables reference it too, so
   * the row has to stay. The service layer already gates this path on status
   * `decommissioned`, an elapsed retention deadline, no legal hold, and the
   * destructive-delete guard.
   *
   * Returns true when either store had something to remove, so a tenant that only
   * ever existed as a table row (the common case — 940 rows, 0 documents in the
   * evaluation database) is not silently skipped.
   */
  async deleteTenant(id: string): Promise<boolean> {
    const removedDocument = await this.tenants.delete(id);
    const removedRow = await this.softDeleteTenantRow(id);
    if (!removedDocument && !removedRow) return false;
    const domains = await this.domains.where({ tenantId: id } as Partial<DomainEntity>);
    for (const d of domains) await this.domains.delete(d.id);
    await this.usage.delete(id);
    return true;
  }

  /** Marks the `tenants` row deleted. Idempotent; false when there was nothing to mark. */
  private async softDeleteTenantRow(id: string): Promise<boolean> {
    if (!UUID_RE.test(id)) return false;
    // RETURNING rather than rowCount: `PgQueryable.query` only types `rows`, so
    // reading rowCount off the index signature needs a cast.
    const result = await withPgTenant(this.pool, id, (client) =>
      client.query(
        `UPDATE tenants
            SET deleted_at = now(), updated_at = now()
          WHERE id = $1::uuid AND deleted_at IS NULL
        RETURNING id`,
        [id],
      ),
    );
    return result.rows.length > 0;
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
