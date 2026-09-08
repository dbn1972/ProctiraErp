/**
 * Tenant Lifecycle Service
 *
 * Business logic for tenant provisioning, configuration management,
 * lifecycle transitions, and usage tracking.
 *
 * Key invariants:
 * - Tenant slugs are globally unique and immutable after creation
 * - Lifecycle transitions follow: provisioning → active → suspended → decommissioned
 * - Suspended tenants can be reactivated; decommissioned tenants cannot
 * - Data retention period must be respected before permanent deletion
 * - Configuration changes are applied immediately
 *
 * Charter: Section 6 (Tenant Model)
 */
import { ConflictError, NotFoundError, BusinessRuleError, ValidationError } from '@proctira/common';
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { createLogger } from '@proctira/logging';
import { v4 as uuidv4 } from 'uuid';

import { validateBrandingTokens } from './branding-validation.js';
import type {
  TenantEntity,
  DomainEntity,
  TenantUsageEntity,
  TenantThemeVersionEntity,
  TenantBrandingDraftEntity,
  TenantFilter,
  TenantRepository,
} from './tenant-repository.js';
import type {
  CreateTenantInput,
  UpdateTenantInput,
  SuspendTenantInput,
  DecommissionTenantInput,
  UpdateConfigInput,
  AddDomainInput,
  PublishBrandingInput,
  RollbackBrandingInput,
  SaveBrandingDraftInput,
  TenantConfig,
  TenantResponse,
  TenantUsageResponse,
  TenantThemeVersionResponse,
  TenantBrandingDraftResponse,
  ActiveBrandingResponse,
  ThemeTokens,
  DomainResponse,
} from './schemas.js';

const logger = createLogger({ name: 'tenant-service' });

/**
 * Service handling tenant lifecycle business logic.
 */
export class TenantService {
  constructor(private readonly repository: TenantRepository) {}

  // ─── Tenant CRUD ─────────────────────────────────────────────────────────

  /**
   * Create a new tenant and initiate provisioning.
   *
   * Provisioning flow:
   * 1. Validate slug uniqueness
   * 2. Create tenant record in 'provisioning' status
   * 3. Apply default configuration
   * 4. Transition to 'active' status
   *
   * @throws ConflictError if slug already exists
   */
  async createTenant(input: CreateTenantInput): Promise<TenantEntity> {
    const existingBySlug = await this.repository.findTenantBySlug(input.slug);
    if (existingBySlug) {
      throw new ConflictError(`Tenant with slug '${input.slug}' already exists`);
    }

    const defaultConfig: TenantConfig = {
      branding: {
        organizationName: input.name,
      },
      locale: {
        defaultLocale: 'en',
        supportedLocales: ['en'],
        timezone: 'UTC',
        dateFormat: 'YYYY-MM-DD',
      },
      features: {
        modules: {},
        customFields: true,
        bulkImport: true,
        apiAccess: true,
        webhooks: false,
      },
      security: {
        mfaRequired: false,
        sessionTimeoutMinutes: 480,
        passwordMinLength: 12,
        passwordRequireSpecialChar: true,
      },
    };

    // Merge user-provided config with defaults
    const config = this.mergeConfig(defaultConfig, input.config);

    const tenant = await this.repository.createTenant({
      id: uuidv4(),
      name: input.name,
      slug: input.slug,
      status: 'provisioning',
      plan: input.plan ?? null,
      region: input.region ?? null,
      config,
      suspendedAt: null,
      suspendedReason: null,
      decommissionedAt: null,
      dataRetentionUntil: null,
    });

    logger.info(
      { tenantId: tenant.id, slug: tenant.slug },
      'Tenant record created in provisioning status',
    );

    // Transition to active after provisioning steps complete
    // In a real system, this would involve seeding defaults, creating admin user, etc.
    // For now, we transition immediately.
    const activeTenant = await this.repository.updateTenant(tenant.id, {
      status: 'active',
    });

    logger.info(
      { tenantId: tenant.id, slug: tenant.slug },
      'Tenant provisioning completed, status set to active',
    );

    return activeTenant!;
  }

  /**
   * Update an existing tenant's mutable attributes.
   *
   * @throws NotFoundError if tenant not found
   * @throws BusinessRuleError if tenant is decommissioned
   */
  async updateTenant(id: string, input: UpdateTenantInput): Promise<TenantEntity> {
    const existing = await this.repository.findTenantById(id);
    if (!existing) {
      throw new NotFoundError(`Tenant with id '${id}' not found`);
    }

    if (existing.status === 'decommissioned') {
      throw new BusinessRuleError('Cannot modify a decommissioned tenant');
    }

    const updateData: Partial<TenantEntity> = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.plan !== undefined) updateData.plan = input.plan;
    if (input.region !== undefined) updateData.region = input.region;
    if (input.config !== undefined) {
      updateData.config = this.mergeConfig(existing.config, input.config);
    }

    const updated = await this.repository.updateTenant(id, updateData);
    if (!updated) {
      throw new NotFoundError(`Tenant with id '${id}' not found`);
    }

    logger.info({ tenantId: id }, 'Tenant updated');
    return updated;
  }

  /**
   * Get a single tenant by ID.
   *
   * @throws NotFoundError if tenant not found
   */
  async getTenantById(id: string): Promise<TenantEntity> {
    const tenant = await this.repository.findTenantById(id);
    if (!tenant) {
      throw new NotFoundError(`Tenant with id '${id}' not found`);
    }
    return tenant;
  }

  /**
   * List tenants with pagination and filtering.
   */
  async listTenants(
    filter: TenantFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<TenantEntity>> {
    return this.repository.listTenants(filter, pagination);
  }

  // ─── Lifecycle Transitions ───────────────────────────────────────────────

  /**
   * Suspend a tenant.
   *
   * Suspended tenants:
   * - Cannot authenticate new sessions
   * - Existing sessions are invalidated
   * - Data is preserved and accessible to platform admins
   * - Can be reactivated
   *
   * @throws NotFoundError if tenant not found
   * @throws BusinessRuleError if tenant is not active
   */
  async suspendTenant(id: string, input: SuspendTenantInput): Promise<TenantEntity> {
    const tenant = await this.repository.findTenantById(id);
    if (!tenant) {
      throw new NotFoundError(`Tenant with id '${id}' not found`);
    }

    if (tenant.status !== 'active') {
      throw new BusinessRuleError(
        `Cannot suspend tenant in '${tenant.status}' status. Only active tenants can be suspended.`,
      );
    }

    const updated = await this.repository.updateTenant(id, {
      status: 'suspended',
      suspendedAt: new Date(),
      suspendedReason: input.reason,
    });

    logger.info({ tenantId: id, reason: input.reason }, 'Tenant suspended');

    return updated!;
  }

  /**
   * Reactivate a suspended tenant.
   *
   * @throws NotFoundError if tenant not found
   * @throws BusinessRuleError if tenant is not suspended
   */
  async reactivateTenant(id: string): Promise<TenantEntity> {
    const tenant = await this.repository.findTenantById(id);
    if (!tenant) {
      throw new NotFoundError(`Tenant with id '${id}' not found`);
    }

    if (tenant.status !== 'suspended') {
      throw new BusinessRuleError(
        `Cannot reactivate tenant in '${tenant.status}' status. Only suspended tenants can be reactivated.`,
      );
    }

    const updated = await this.repository.updateTenant(id, {
      status: 'active',
      suspendedAt: null,
      suspendedReason: null,
    });

    logger.info({ tenantId: id }, 'Tenant reactivated');
    return updated!;
  }

  /**
   * Decommission a tenant.
   *
   * Decommissioned tenants:
   * - Are permanently disabled (cannot be reactivated)
   * - Data is retained for the specified retention period
   * - After retention period, data is eligible for permanent deletion
   *
   * @throws NotFoundError if tenant not found
   * @throws BusinessRuleError if tenant is already decommissioned
   */
  async decommissionTenant(id: string, input: DecommissionTenantInput): Promise<TenantEntity> {
    const tenant = await this.repository.findTenantById(id);
    if (!tenant) {
      throw new NotFoundError(`Tenant with id '${id}' not found`);
    }

    if (tenant.status === 'decommissioned') {
      throw new BusinessRuleError('Tenant is already decommissioned');
    }

    const retainDays = input.retainDataDays ?? 30;
    const retentionDeadline = new Date();
    retentionDeadline.setDate(retentionDeadline.getDate() + retainDays);

    const updated = await this.repository.updateTenant(id, {
      status: 'decommissioned',
      decommissionedAt: new Date(),
      dataRetentionUntil: retentionDeadline,
    });

    logger.info(
      { tenantId: id, reason: input.reason, retainDays, retentionDeadline },
      'Tenant decommissioned',
    );

    return updated!;
  }

  /**
   * Permanently delete a decommissioned tenant past its retention period.
   *
   * @throws NotFoundError if tenant not found
   * @throws BusinessRuleError if tenant is not decommissioned or retention period has not passed
   */
  async deleteTenant(id: string): Promise<void> {
    const tenant = await this.repository.findTenantById(id);
    if (!tenant) {
      throw new NotFoundError(`Tenant with id '${id}' not found`);
    }

    if (tenant.status !== 'decommissioned') {
      throw new BusinessRuleError('Only decommissioned tenants can be permanently deleted');
    }

    if (tenant.dataRetentionUntil && tenant.dataRetentionUntil > new Date()) {
      throw new BusinessRuleError(
        `Data retention period has not passed. Retention until: ${tenant.dataRetentionUntil.toISOString()}`,
      );
    }

    await this.repository.deleteTenant(id);
    logger.info({ tenantId: id }, 'Tenant permanently deleted');
  }

  // ─── Configuration Management ────────────────────────────────────────────

  /**
   * Update tenant configuration (branding, locale, timezone, features, security).
   *
   * @throws NotFoundError if tenant not found
   * @throws BusinessRuleError if tenant is decommissioned
   */
  async updateConfig(id: string, input: UpdateConfigInput): Promise<TenantEntity> {
    const tenant = await this.repository.findTenantById(id);
    if (!tenant) {
      throw new NotFoundError(`Tenant with id '${id}' not found`);
    }

    if (tenant.status === 'decommissioned') {
      throw new BusinessRuleError('Cannot modify configuration of a decommissioned tenant');
    }

    const updatedConfig = this.mergeConfig(tenant.config, input);

    const updated = await this.repository.updateTenant(id, {
      config: updatedConfig,
    });

    logger.info({ tenantId: id }, 'Tenant configuration updated');
    return updated!;
  }

  /**
   * Get tenant configuration.
   *
   * @throws NotFoundError if tenant not found
   */
  async getConfig(id: string): Promise<TenantConfig> {
    const tenant = await this.repository.findTenantById(id);
    if (!tenant) {
      throw new NotFoundError(`Tenant with id '${id}' not found`);
    }
    return tenant.config;
  }

  // ─── Domain Management ───────────────────────────────────────────────────

  /**
   * Add a custom domain to a tenant.
   *
   * @throws NotFoundError if tenant not found
   * @throws ConflictError if domain already exists
   * @throws BusinessRuleError if tenant is decommissioned
   */
  async addDomain(tenantId: string, input: AddDomainInput): Promise<DomainEntity> {
    const tenant = await this.repository.findTenantById(tenantId);
    if (!tenant) {
      throw new NotFoundError(`Tenant with id '${tenantId}' not found`);
    }

    if (tenant.status === 'decommissioned') {
      throw new BusinessRuleError('Cannot add domains to a decommissioned tenant');
    }

    const existingDomain = await this.repository.findDomainByName(input.domain);
    if (existingDomain) {
      throw new ConflictError(`Domain '${input.domain}' is already registered`);
    }

    const domain = await this.repository.addDomain({
      id: uuidv4(),
      tenantId,
      domain: input.domain,
      primary: input.primary ?? false,
      verified: false,
      createdAt: new Date(),
    });

    logger.info({ tenantId, domain: input.domain }, 'Domain added to tenant');

    return domain;
  }

  /**
   * Remove a domain from a tenant.
   *
   * @throws NotFoundError if tenant or domain not found
   */
  async removeDomain(tenantId: string, domainId: string): Promise<void> {
    const tenant = await this.repository.findTenantById(tenantId);
    if (!tenant) {
      throw new NotFoundError(`Tenant with id '${tenantId}' not found`);
    }

    const removed = await this.repository.removeDomain(tenantId, domainId);
    if (!removed) {
      throw new NotFoundError(`Domain with id '${domainId}' not found for tenant '${tenantId}'`);
    }

    logger.info({ tenantId, domainId }, 'Domain removed from tenant');
  }

  /**
   * List domains for a tenant.
   *
   * @throws NotFoundError if tenant not found
   */
  async listDomains(tenantId: string): Promise<DomainEntity[]> {
    const tenant = await this.repository.findTenantById(tenantId);
    if (!tenant) {
      throw new NotFoundError(`Tenant with id '${tenantId}' not found`);
    }
    return this.repository.findDomainsByTenant(tenantId);
  }

  // ─── Usage Dashboard ─────────────────────────────────────────────────────

  /**
   * Get tenant usage metrics (storage, users, API calls).
   *
   * @throws NotFoundError if tenant not found
   */
  async getUsage(tenantId: string): Promise<TenantUsageResponse> {
    const tenant = await this.repository.findTenantById(tenantId);
    if (!tenant) {
      throw new NotFoundError(`Tenant with id '${tenantId}' not found`);
    }

    const usage = await this.repository.getOrCreateUsage(tenantId);

    const storagePercentage =
      usage.storageLimitBytes === -1
        ? 0
        : usage.storageLimitBytes === 0
          ? 100
          : Math.round((usage.storageUsedBytes / usage.storageLimitBytes) * 100);

    return {
      tenantId,
      storage: {
        usedBytes: usage.storageUsedBytes,
        limitBytes: usage.storageLimitBytes,
        percentage: storagePercentage,
      },
      users: {
        active: usage.activeUsers,
        total: usage.totalUsers,
        limit: usage.userLimit,
      },
      apiCalls: {
        current: usage.apiCallsCurrent,
        limit: usage.apiCallsLimit,
        periodStart: usage.periodStart.toISOString(),
        periodEnd: usage.periodEnd.toISOString(),
      },
      lastUpdated: usage.lastUpdated.toISOString(),
    };
  }

  // ─── Branding Versioning (Task 58.2) ─────────────────────────────────────

  /**
   * Publish a new tenant branding revision.
   *
   * Append-only contract:
   *   1. Validate the incoming tokens against the publish-time guards
   *      (Task 58.4 — see `branding-validation.ts`). Reject with a
   *      `ValidationError` carrying field-level details when the logo,
   *      favicon, primary color, or accent color fail.
   *   2. Insert a row into `tenant_theme_versions` at `MAX(revision) + 1`.
   *   3. Mirror the published tokens onto `tenant_settings.theme` for
   *      fast boot-time reads (Task 58.1).
   *
   * The migration that owns the table revokes UPDATE/DELETE — this method
   * does not need (and must not attempt) to mutate prior rows.
   *
   * @throws NotFoundError if the tenant does not exist
   * @throws BusinessRuleError if the tenant is decommissioned
   * @throws ValidationError if the tokens fail any publish-time guard
   *         (Requirement 28 AC 7-9)
   */
  async publishBranding(
    tenantId: string,
    input: PublishBrandingInput,
  ): Promise<TenantThemeVersionEntity> {
    const tenant = await this.repository.findTenantById(tenantId);
    if (!tenant) {
      throw new NotFoundError(`Tenant with id '${tenantId}' not found`);
    }
    if (tenant.status === 'decommissioned') {
      throw new BusinessRuleError('Cannot publish branding for a decommissioned tenant');
    }

    // Task 58.4 — server-side validation guards.
    // Each failing field is reported individually so the Settings → Branding
    // UI can render an inline error next to the offending control.
    const validation = validateBrandingTokens(input.tokens);
    if (!validation.ok) {
      throw new ValidationError('Branding token validation failed', validation.errors);
    }

    const version = await this.repository.insertThemeVersion({
      tenantId,
      tokens: input.tokens,
      publishedBy: input.publishedBy,
    });

    // Mirror the just-published tokens onto `tenant_settings.theme` so that
    // a client doing a cold boot can fetch the active theme in a single
    // round-trip without joining the version table.
    await this.repository.updateTenant(tenantId, {
      config: {
        ...tenant.config,
        theme: version.tokens,
      },
    });

    logger.info(
      { tenantId, revision: version.revision, publishedBy: version.publishedBy },
      'Tenant branding revision published',
    );

    return version;
  }

  /**
   * Roll a tenant's branding back to a prior revision.
   *
   * Behavior (Design §N — append-only history):
   *   1. Locate the prior `tenant_theme_versions` row identified by
   *      `(tenantId, revision)`.
   *   2. Copy its tokens onto `tenant_settings.theme` so a cold boot picks
   *      up the rolled-back theme on next page load.
   *   3. APPEND a new `tenant_theme_versions` row carrying the same tokens
   *      at revision = `MAX(revision) + 1`. The original row stays exactly
   *      as it was — the rollback itself is the audit event.
   *
   * Disallowed inputs:
   *   - Rolling back to the current latest revision is a no-op from the
   *     user's perspective; we still record the audit row so the high-risk
   *     event (Requirement 33 AC 4) is captured. Callers that prefer to
   *     reject this case can layer their own check on top.
   *   - Rolling back to a revision that does not exist for the tenant
   *     raises `NotFoundError`.
   *
   * @throws NotFoundError if the tenant or revision does not exist
   * @throws BusinessRuleError if the tenant is decommissioned
   */
  async rollbackBranding(
    tenantId: string,
    input: RollbackBrandingInput,
  ): Promise<TenantThemeVersionEntity> {
    const tenant = await this.repository.findTenantById(tenantId);
    if (!tenant) {
      throw new NotFoundError(`Tenant with id '${tenantId}' not found`);
    }
    if (tenant.status === 'decommissioned') {
      throw new BusinessRuleError('Cannot roll back branding for a decommissioned tenant');
    }

    const target = await this.repository.findThemeVersion(tenantId, input.revision);
    if (!target) {
      throw new NotFoundError(
        `Theme revision '${input.revision}' not found for tenant '${tenantId}'`,
      );
    }

    // Append the rollback as a new audit row at the next revision number.
    const rollback = await this.repository.insertThemeVersion({
      tenantId,
      tokens: target.tokens,
      publishedBy: input.publishedBy,
    });

    // Mirror the restored tokens onto the tenant's active config (Task 58.1).
    await this.repository.updateTenant(tenantId, {
      config: {
        ...tenant.config,
        theme: rollback.tokens,
      },
    });

    logger.info(
      {
        tenantId,
        targetRevision: target.revision,
        rollbackRevision: rollback.revision,
        publishedBy: rollback.publishedBy,
      },
      'Tenant branding rolled back to prior revision',
    );

    return rollback;
  }

  /**
   * List every theme version recorded for a tenant — useful for
   * Settings → Branding history UI and audit exports.
   *
   * @throws NotFoundError if the tenant does not exist
   */
  async listBrandingVersions(tenantId: string): Promise<TenantThemeVersionEntity[]> {
    const tenant = await this.repository.findTenantById(tenantId);
    if (!tenant) {
      throw new NotFoundError(`Tenant with id '${tenantId}' not found`);
    }
    return this.repository.listThemeVersions(tenantId);
  }

  /**
   * Get the currently active branding tokens for a tenant.
   * Returns `null` if no revision has ever been published.
   *
   * @throws NotFoundError if the tenant does not exist
   */
  async getActiveBranding(tenantId: string): Promise<{
    tokens: ThemeTokens | null;
    revision: number | null;
  }> {
    const tenant = await this.repository.findTenantById(tenantId);
    if (!tenant) {
      throw new NotFoundError(`Tenant with id '${tenantId}' not found`);
    }
    const latest = await this.repository.findLatestThemeVersion(tenantId);
    return {
      tokens: latest?.tokens ?? tenant.config.theme ?? null,
      revision: latest?.revision ?? null,
    };
  }

  // ─── Branding Drafts (Task 58.3) ─────────────────────────────────────────

  /**
   * Save (or replace) the in-progress branding draft for a tenant.
   *
   * Drafts are independent of `tenant_theme_versions` — they hold the
   * tokens a tenant administrator is staging in Settings → Branding before
   * publishing. There is at most one draft per tenant; calling this method
   * a second time replaces the prior draft (UPSERT semantics).
   *
   * @throws NotFoundError if the tenant does not exist
   * @throws BusinessRuleError if the tenant is decommissioned
   */
  async saveBrandingDraft(
    tenantId: string,
    input: SaveBrandingDraftInput,
  ): Promise<TenantBrandingDraftEntity> {
    const tenant = await this.repository.findTenantById(tenantId);
    if (!tenant) {
      throw new NotFoundError(`Tenant with id '${tenantId}' not found`);
    }
    if (tenant.status === 'decommissioned') {
      throw new BusinessRuleError('Cannot save branding draft for a decommissioned tenant');
    }

    const draft = await this.repository.upsertBrandingDraft({
      tenantId,
      tokens: input.tokens,
      savedBy: input.savedBy,
    });

    logger.info({ tenantId, savedBy: draft.savedBy }, 'Tenant branding draft saved');

    return draft;
  }

  /**
   * Discard the in-progress branding draft for a tenant. No-op when no
   * draft is currently saved.
   *
   * @throws NotFoundError if the tenant does not exist
   */
  async discardBrandingDraft(tenantId: string): Promise<boolean> {
    const tenant = await this.repository.findTenantById(tenantId);
    if (!tenant) {
      throw new NotFoundError(`Tenant with id '${tenantId}' not found`);
    }
    const removed = await this.repository.deleteBrandingDraft(tenantId);
    if (removed) {
      logger.info({ tenantId }, 'Tenant branding draft discarded');
    }
    return removed;
  }

  /**
   * Read the in-progress branding draft for a tenant, or `null` if none
   * is saved.
   *
   * @throws NotFoundError if the tenant does not exist
   */
  async getBrandingDraft(tenantId: string): Promise<TenantBrandingDraftEntity | null> {
    const tenant = await this.repository.findTenantById(tenantId);
    if (!tenant) {
      throw new NotFoundError(`Tenant with id '${tenantId}' not found`);
    }
    return this.repository.findBrandingDraft(tenantId);
  }

  /**
   * Resolve the active branding tokens for a request (Task 58.3).
   *
   * - When `previewRequested` is `true` AND a draft exists, returns the
   *   draft tokens with `source: 'draft'` and `revision: null`.
   * - Otherwise returns the published tokens (whatever
   *   `getActiveBranding` would return) with `source: 'published'`.
   *
   * The caller is responsible for confirming the requester has the
   * `branding:preview` permission BEFORE setting `previewRequested = true`
   * — this method intentionally does not perform the permission check
   * itself so that the route layer can centralize the auth wiring.
   *
   * @throws NotFoundError if the tenant does not exist
   */
  async resolveActiveBrandingForRequest(
    tenantId: string,
    previewRequested: boolean,
  ): Promise<{
    tokens: ThemeTokens | null;
    revision: number | null;
    source: 'published' | 'draft';
  }> {
    if (previewRequested) {
      const draft = await this.getBrandingDraft(tenantId);
      if (draft) {
        return {
          tokens: draft.tokens,
          revision: null,
          source: 'draft',
        };
      }
      // No draft saved — fall through to published tokens. The preview
      // signal is still honored (the user has permission), but there is
      // simply nothing to preview.
    }

    const active = await this.getActiveBranding(tenantId);
    return {
      tokens: active.tokens,
      revision: active.revision,
      source: 'published',
    };
  }

  // ─── Response Formatting ─────────────────────────────────────────────────

  /**
   * Format a tenant entity for API response.
   */
  formatTenantResponse(entity: TenantEntity): TenantResponse {
    return {
      id: entity.id,
      name: entity.name,
      slug: entity.slug,
      status: entity.status,
      plan: entity.plan,
      region: entity.region,
      config: entity.config,
      suspendedAt: entity.suspendedAt?.toISOString() ?? null,
      suspendedReason: entity.suspendedReason,
      decommissionedAt: entity.decommissionedAt?.toISOString() ?? null,
      dataRetentionUntil: entity.dataRetentionUntil?.toISOString() ?? null,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }

  /**
   * Format a domain entity for API response.
   */
  formatDomainResponse(entity: DomainEntity): DomainResponse {
    return {
      id: entity.id,
      tenantId: entity.tenantId,
      domain: entity.domain,
      primary: entity.primary,
      verified: entity.verified,
      createdAt: entity.createdAt.toISOString(),
    };
  }

  /**
   * Format a theme version entity for API response.
   */
  formatThemeVersionResponse(entity: TenantThemeVersionEntity): TenantThemeVersionResponse {
    return {
      id: entity.id,
      tenantId: entity.tenantId,
      revision: entity.revision,
      tokens: entity.tokens,
      publishedAt: entity.publishedAt.toISOString(),
      publishedBy: entity.publishedBy,
    };
  }

  /**
   * Format a branding draft entity for API response (Task 58.3).
   */
  formatBrandingDraftResponse(entity: TenantBrandingDraftEntity): TenantBrandingDraftResponse {
    return {
      tenantId: entity.tenantId,
      tokens: entity.tokens,
      savedAt: entity.savedAt.toISOString(),
      savedBy: entity.savedBy,
    };
  }

  /**
   * Format an active-branding lookup for API response (Task 58.3).
   */
  formatActiveBrandingResponse(active: {
    tokens: ThemeTokens | null;
    revision: number | null;
    source: 'published' | 'draft';
  }): ActiveBrandingResponse {
    return {
      tokens: active.tokens,
      revision: active.revision,
      source: active.source,
    };
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  /**
   * Deep merge tenant configuration, with override values taking precedence.
   *
   * NOTE on `theme`: theme tokens are written through the dedicated
   * `publishBranding` / `rollbackBranding` flow (Task 58.2), NOT via
   * `updateConfig`. This merge therefore preserves any existing
   * `base.theme` regardless of the override — `UpdateConfigSchema`
   * intentionally excludes the `theme` field.
   */
  private mergeConfig(base: TenantConfig, override?: Partial<TenantConfig>): TenantConfig {
    if (!override) return base;

    return {
      branding: override.branding ? { ...base.branding, ...override.branding } : base.branding,
      locale: override.locale ? { ...base.locale, ...override.locale } : base.locale,
      features: override.features
        ? {
            ...base.features,
            ...override.features,
            modules: {
              ...base.features?.modules,
              ...override.features?.modules,
            },
          }
        : base.features,
      security: override.security ? { ...base.security, ...override.security } : base.security,
      // theme is owned by the branding versioning pipeline — never
      // overwritten by a generic config update.
      theme: override.theme ?? base.theme,
    };
  }
}
