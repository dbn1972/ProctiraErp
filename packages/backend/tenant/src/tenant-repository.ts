/**
 * Tenant Repository Interface
 *
 * Defines the data access contract for tenant lifecycle operations.
 * Implementations can use Prisma, in-memory stores, or other backends.
 *
 * Tables: tenant_tenants, tenant_settings, tenant_domains
 * Charter: Section 6 (Tenant Model)
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import type { TenantStatus, TenantConfig, ThemeTokens } from './schemas.js';

// ─── Entity Types ────────────────────────────────────────────────────────────

/**
 * Tenant entity as stored in the tenant_tenants table.
 */
export interface TenantEntity {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  plan: string | null;
  region: string | null;
  config: TenantConfig;
  suspendedAt: Date | null;
  suspendedReason: string | null;
  decommissionedAt: Date | null;
  dataRetentionUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Domain entity as stored in the tenant_domains table.
 */
export interface DomainEntity {
  id: string;
  tenantId: string;
  domain: string;
  primary: boolean;
  verified: boolean;
  createdAt: Date;
}

/**
 * Tenant usage metrics entity.
 */
export interface TenantUsageEntity {
  tenantId: string;
  storageUsedBytes: number;
  storageLimitBytes: number;
  activeUsers: number;
  totalUsers: number;
  userLimit: number;
  apiCallsCurrent: number;
  apiCallsLimit: number;
  periodStart: Date;
  periodEnd: Date;
  lastUpdated: Date;
}

/**
 * Tenant theme version entity, mirrored to the `tenant_theme_versions` table.
 *
 * The table is append-only — repositories MUST NOT expose update/delete
 * operations for these rows. Each new publish (or rollback) inserts a fresh
 * row at the next revision number for the tenant.
 */
export interface TenantThemeVersionEntity {
  id: string;
  tenantId: string;
  revision: number;
  tokens: ThemeTokens;
  publishedAt: Date;
  publishedBy: string;
}

/**
 * Tenant theme draft entity (Task 58.3).
 *
 * Represents the in-progress branding token edits a tenant administrator is
 * working on in Settings → Branding before publishing. Drafts are
 * independent of `tenant_theme_versions`:
 *
 *   - There is AT MOST one draft per tenant at any time. Saving again
 *     overwrites the prior draft, so this entity has UPSERT semantics.
 *   - Drafts are never automatically promoted to `tenant_theme_versions`;
 *     publication is an explicit `POST /tenant/branding/publish`.
 *   - Drafts are surfaced ONLY to requests that carry the preview cookie /
 *     header AND originate from a user with `branding:preview` permission
 *     (Design §N). Other callers always see the published tokens.
 *
 * The repository contract intentionally exposes UPSERT / READ / DELETE for
 * this row — unlike the append-only `tenant_theme_versions` table, the
 * draft IS allowed to be discarded ("Discard draft" button).
 */
export interface TenantBrandingDraftEntity {
  tenantId: string;
  tokens: ThemeTokens;
  savedAt: Date;
  savedBy: string;
}

// ─── Filter Types ────────────────────────────────────────────────────────────

/**
 * Filter options for listing tenants.
 */
export interface TenantFilter {
  status?: TenantStatus;
  search?: string;
  region?: string;
}

// ─── Repository Interface ────────────────────────────────────────────────────

/**
 * Repository interface for tenant data access.
 */
export interface TenantRepository {
  // ─── Tenant CRUD ─────────────────────────────────────────────────────────

  /** Create a new tenant */
  createTenant(data: Omit<TenantEntity, 'createdAt' | 'updatedAt'>): Promise<TenantEntity>;

  /** Update an existing tenant */
  updateTenant(id: string, data: Partial<TenantEntity>): Promise<TenantEntity | null>;

  /** Find a tenant by ID */
  findTenantById(id: string): Promise<TenantEntity | null>;

  /** Find a tenant by slug (for uniqueness check) */
  findTenantBySlug(slug: string): Promise<TenantEntity | null>;

  /** List tenants with pagination and filtering */
  listTenants(
    filter: TenantFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<TenantEntity>>;

  /** Delete a tenant (hard delete — only for decommissioned tenants past retention) */
  deleteTenant(id: string): Promise<boolean>;

  // ─── Domain Management ───────────────────────────────────────────────────

  /** Add a domain to a tenant */
  addDomain(data: DomainEntity): Promise<DomainEntity>;

  /** Remove a domain from a tenant */
  removeDomain(tenantId: string, domainId: string): Promise<boolean>;

  /** Find domains for a tenant */
  findDomainsByTenant(tenantId: string): Promise<DomainEntity[]>;

  /** Find a domain by domain name (for uniqueness check) */
  findDomainByName(domain: string): Promise<DomainEntity | null>;

  // ─── Usage Tracking ──────────────────────────────────────────────────────

  /** Get or create usage metrics for a tenant */
  getOrCreateUsage(tenantId: string): Promise<TenantUsageEntity>;

  /** Update usage metrics for a tenant */
  updateUsage(tenantId: string, data: Partial<TenantUsageEntity>): Promise<TenantUsageEntity>;

  // ─── Theme Versioning (Task 58.2 — append-only) ──────────────────────────
  //
  // The repository contract intentionally exposes ONLY insert / read
  // operations. There is no update / delete method — the table is the
  // immutable audit trail described in Design §N.

  /**
   * Insert a new theme version row at the next revision number for the tenant.
   *
   * Implementations MUST allocate `revision = MAX(revision) + 1` for the
   * tenant atomically (the SQL implementation relies on the
   * `(tenant_id, revision)` UNIQUE INDEX + a serializable transaction; the
   * in-memory implementation just iterates the array under the
   * single-threaded Node event loop).
   *
   * Returns the persisted entity (with its assigned revision number).
   */
  insertThemeVersion(
    data: Omit<TenantThemeVersionEntity, 'id' | 'revision' | 'publishedAt'> & {
      id?: string;
      publishedAt?: Date;
    },
  ): Promise<TenantThemeVersionEntity>;

  /** Find a specific revision by `(tenantId, revision)`. */
  findThemeVersion(tenantId: string, revision: number): Promise<TenantThemeVersionEntity | null>;

  /**
   * List every revision recorded for the tenant.
   * Ordered by revision ascending so callers can reason about the audit trail.
   */
  listThemeVersions(tenantId: string): Promise<TenantThemeVersionEntity[]>;

  /** Get the latest revision row for a tenant, or `null` if none exists. */
  findLatestThemeVersion(tenantId: string): Promise<TenantThemeVersionEntity | null>;

  // ─── Theme Drafts (Task 58.3) ───────────────────────────────────────────
  //
  // Branding drafts are the in-progress token edits a tenant administrator
  // is staging in Settings → Branding before publishing. Unlike the
  // append-only version log above, drafts are mutable: there is at most one
  // draft per tenant, and it can be replaced or discarded outright.

  /**
   * Save (insert or replace) the branding draft for a tenant. Returns the
   * persisted entity with the resolved `savedAt` timestamp.
   */
  upsertBrandingDraft(
    data: Omit<TenantBrandingDraftEntity, 'savedAt'> & { savedAt?: Date },
  ): Promise<TenantBrandingDraftEntity>;

  /**
   * Read the draft for a tenant, or `null` if no draft is currently saved.
   */
  findBrandingDraft(tenantId: string): Promise<TenantBrandingDraftEntity | null>;

  /**
   * Delete the draft for a tenant. Returns `true` when a row was removed,
   * `false` if no draft was present.
   */
  deleteBrandingDraft(tenantId: string): Promise<boolean>;
}
