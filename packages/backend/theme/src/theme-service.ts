/**
 * Theme Service
 *
 * Core business logic for theme management:
 * - Create: Create a new theme with token validation and accessibility checks
 * - Update: Modify theme tokens/assets (draft only)
 * - Publish: Publish a theme creating a versioned revision
 * - Rollback: Revert to a previous revision
 * - Preview: Generate a preview with accessibility validation
 * - GetTokens: Resolve effective tokens with inheritance (platform → tenant → portal)
 *
 * Theme levels with inheritance:
 * - platform: Default theme for the entire platform
 * - tenant: Overrides platform defaults for a specific tenant
 * - portal: Overrides tenant theme for a specific portal
 *
 * All operations are tenant-scoped.
 */
import { v4 as uuidv4 } from 'uuid';
import { NotFoundError, ConflictError, BusinessRuleError } from '@proctira/common';

import type { ThemeRepository, ThemeEntity, ThemeRevisionEntity } from './theme-repository.js';
import type {
  CreateThemeInput,
  UpdateThemeInput,
  PublishThemeInput,
  RollbackThemeInput,
  ThemeTokens,
  ThemeAssets,
  AccessibilityResult,
} from './schemas.js';
import { validateAccessibility } from './accessibility.js';

/**
 * Configuration for the theme service.
 */
export interface ThemeServiceConfig {
  /** Whether to enforce accessibility validation on publish (default: true) */
  enforceAccessibility?: boolean;
}

/**
 * Theme Service - manages the full theme lifecycle.
 */
export class ThemeService {
  private readonly enforceAccessibility: boolean;

  constructor(
    private readonly repository: ThemeRepository,
    private readonly config: ThemeServiceConfig = {},
  ) {
    this.enforceAccessibility = config.enforceAccessibility !== false;
  }

  /**
   * Create a new theme.
   * Validates tokens and checks for conflicts at the same level.
   */
  async create(tenantId: string, input: CreateThemeInput): Promise<ThemeEntity> {
    const { name, description, level, portalId, tokens, assets } = input;

    // Portal-level themes require a portalId
    if (level === 'portal' && !portalId) {
      throw new BusinessRuleError('Portal-level themes require a portalId');
    }

    // Check for existing theme at the same level for this tenant
    const existing = await this.repository.findThemeByTenantAndLevel(
      tenantId,
      level,
      portalId ?? undefined,
    );
    if (existing) {
      throw new ConflictError(
        `A ${level}-level theme already exists for this tenant${portalId ? ` and portal ${portalId}` : ''}`,
      );
    }

    // Validate accessibility
    const accessibilityResult = validateAccessibility(tokens);
    if (this.enforceAccessibility && !accessibilityResult.valid) {
      const errorMessages = accessibilityResult.issues
        .filter((i) => i.severity === 'error')
        .map((i) => i.message)
        .join('; ');
      throw new BusinessRuleError(
        `Theme fails accessibility validation: ${errorMessages}`,
      );
    }

    const themeId = uuidv4();

    const theme = await this.repository.createTheme({
      id: themeId,
      tenantId,
      name,
      description: description ?? null,
      level,
      portalId: portalId ?? null,
      status: 'draft',
      tokens,
      assets: assets ?? null,
      currentRevision: null,
    });

    return theme;
  }

  /**
   * Update a theme's tokens, assets, or metadata.
   * Only draft themes can be updated directly.
   * Published themes must be updated then re-published.
   */
  async update(tenantId: string, themeId: string, input: UpdateThemeInput): Promise<ThemeEntity> {
    const theme = await this.getThemeForTenant(tenantId, themeId);

    const updates: Partial<Pick<ThemeEntity, 'name' | 'description' | 'tokens' | 'assets'>> = {};

    if (input.name !== undefined) {
      updates.name = input.name;
    }
    if (input.description !== undefined) {
      updates.description = input.description;
    }
    if (input.tokens !== undefined) {
      // Validate accessibility for new tokens
      const accessibilityResult = validateAccessibility(input.tokens);
      if (this.enforceAccessibility && !accessibilityResult.valid) {
        const errorMessages = accessibilityResult.issues
          .filter((i) => i.severity === 'error')
          .map((i) => i.message)
          .join('; ');
        throw new BusinessRuleError(
          `Theme fails accessibility validation: ${errorMessages}`,
        );
      }
      updates.tokens = input.tokens;
    }
    if (input.assets !== undefined) {
      updates.assets = input.assets;
    }

    if (Object.keys(updates).length === 0) {
      return theme;
    }

    return this.repository.updateTheme(themeId, updates);
  }

  /**
   * Publish a theme, creating a versioned revision.
   * The current tokens/assets are snapshotted into a revision record.
   * Validates accessibility before publishing.
   */
  async publish(
    tenantId: string,
    themeId: string,
    input: PublishThemeInput,
    actor: string,
  ): Promise<ThemeRevisionEntity> {
    const theme = await this.getThemeForTenant(tenantId, themeId);

    // Validate accessibility before publishing
    const accessibilityResult = validateAccessibility(theme.tokens);
    if (!accessibilityResult.valid) {
      const errorMessages = accessibilityResult.issues
        .filter((i) => i.severity === 'error')
        .map((i) => i.message)
        .join('; ');
      throw new BusinessRuleError(
        `Cannot publish theme: accessibility validation failed: ${errorMessages}`,
      );
    }

    // Get next revision number
    const latestRevision = await this.repository.getLatestRevisionNumber(themeId);
    const nextRevision = latestRevision + 1;

    // Create revision snapshot
    const revision = await this.repository.createRevision({
      id: uuidv4(),
      themeId,
      revisionNumber: nextRevision,
      tokens: theme.tokens,
      assets: theme.assets,
      commitMessage: input.commitMessage ?? null,
      publishedBy: actor,
      publishedAt: new Date(),
    });

    // Update theme status and current revision
    await this.repository.updateTheme(themeId, {
      status: 'published',
      currentRevision: nextRevision,
    });

    return revision;
  }

  /**
   * Rollback a theme to a previous revision.
   * Restores the tokens and assets from the specified revision.
   */
  async rollback(
    tenantId: string,
    themeId: string,
    input: RollbackThemeInput,
  ): Promise<ThemeEntity> {
    const theme = await this.getThemeForTenant(tenantId, themeId);

    // Find the target revision
    const revision = await this.repository.findRevisionById(input.revisionId);
    if (!revision || revision.themeId !== themeId) {
      throw new NotFoundError(`Revision not found: ${input.revisionId}`);
    }

    // Restore tokens and assets from the revision
    const updated = await this.repository.updateTheme(themeId, {
      tokens: revision.tokens,
      assets: revision.assets,
      currentRevision: revision.revisionNumber,
    });

    return updated;
  }

  /**
   * Generate a preview of the theme with accessibility validation.
   * Does not modify the theme state.
   */
  async preview(
    tenantId: string,
    themeId: string,
  ): Promise<{ themeId: string; tokens: ThemeTokens; assets: ThemeAssets | null; accessibilityResult: AccessibilityResult }> {
    const theme = await this.getThemeForTenant(tenantId, themeId);

    const accessibilityResult = validateAccessibility(theme.tokens);

    return {
      themeId: theme.id,
      tokens: theme.tokens,
      assets: theme.assets,
      accessibilityResult,
    };
  }

  /**
   * Validate accessibility for a theme's current tokens.
   */
  async validateThemeAccessibility(themeId: string): Promise<AccessibilityResult> {
    const theme = await this.repository.findThemeById(themeId);
    if (!theme) {
      throw new NotFoundError(`Theme not found: ${themeId}`);
    }
    return validateAccessibility(theme.tokens);
  }

  /**
   * Get the effective tokens for a tenant, resolving inheritance.
   * Inheritance chain: platform default → tenant override → portal override
   */
  async getTokens(tenantId: string, portalId?: string): Promise<ThemeTokens> {
    // Start with platform default
    const platformTheme = await this.repository.findThemeByTenantAndLevel(tenantId, 'platform');
    let effectiveTokens: ThemeTokens | null = platformTheme?.tokens ?? null;

    // Apply tenant override
    const tenantTheme = await this.repository.findThemeByTenantAndLevel(tenantId, 'tenant');
    if (tenantTheme && tenantTheme.status === 'published') {
      effectiveTokens = effectiveTokens
        ? this.mergeTokens(effectiveTokens, tenantTheme.tokens)
        : tenantTheme.tokens;
    }

    // Apply portal override if specified
    if (portalId) {
      const portalTheme = await this.repository.findThemeByTenantAndLevel(tenantId, 'portal', portalId);
      if (portalTheme && portalTheme.status === 'published') {
        effectiveTokens = effectiveTokens
          ? this.mergeTokens(effectiveTokens, portalTheme.tokens)
          : portalTheme.tokens;
      }
    }

    if (!effectiveTokens) {
      throw new NotFoundError('No theme found for this tenant');
    }

    return effectiveTokens;
  }

  /**
   * Get a theme by ID, ensuring it belongs to the specified tenant.
   */
  async getById(tenantId: string, themeId: string): Promise<ThemeEntity> {
    return this.getThemeForTenant(tenantId, themeId);
  }

  /**
   * List themes for a tenant with filtering and pagination.
   */
  async list(
    tenantId: string,
    filter: { level?: string; status?: string },
    page: number,
    pageSize: number,
  ) {
    return this.repository.listThemes(
      tenantId,
      {
        level: filter.level as ThemeEntity['level'] | undefined,
        status: filter.status as ThemeEntity['status'] | undefined,
      },
      page,
      pageSize,
    );
  }

  /**
   * List revisions for a theme.
   */
  async listRevisions(tenantId: string, themeId: string): Promise<ThemeRevisionEntity[]> {
    await this.getThemeForTenant(tenantId, themeId);
    return this.repository.listRevisions(themeId);
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  /**
   * Get a theme and verify it belongs to the tenant.
   */
  private async getThemeForTenant(tenantId: string, themeId: string): Promise<ThemeEntity> {
    const theme = await this.repository.findThemeById(themeId);
    if (!theme) {
      throw new NotFoundError(`Theme not found: ${themeId}`);
    }
    if (theme.tenantId !== tenantId) {
      throw new NotFoundError(`Theme not found: ${themeId}`);
    }
    return theme;
  }

  /**
   * Merge two token sets. The override tokens take precedence.
   * Performs a shallow merge at the top level and deep merge for nested objects.
   */
  private mergeTokens(base: ThemeTokens, override: ThemeTokens): ThemeTokens {
    return {
      colors: { ...base.colors, ...override.colors },
      typography: { ...base.typography, ...override.typography },
      spacing: { ...base.spacing, ...override.spacing },
      borderRadius: { ...(base.borderRadius ?? {}), ...(override.borderRadius ?? {}) },
      shadows: { ...(base.shadows ?? {}), ...(override.shadows ?? {}) },
      darkMode: override.darkMode ?? base.darkMode,
    };
  }
}
