/**
 * Theme Repository Interface
 *
 * Defines the data access contract for theme management.
 * Storage tables: theme_themes, theme_revisions, theme_tokens, theme_assets
 */
import type { ThemeTokens, ThemeAssets, ThemeLevel, ThemeStatus } from './schemas.js';

// ─── Entity Types ─────────────────────────────────────────────────────────────

export interface ThemeEntity {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  level: ThemeLevel;
  portalId: string | null;
  status: ThemeStatus;
  tokens: ThemeTokens;
  assets: ThemeAssets | null;
  currentRevision: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ThemeRevisionEntity {
  id: string;
  themeId: string;
  revisionNumber: number;
  tokens: ThemeTokens;
  assets: ThemeAssets | null;
  commitMessage: string | null;
  publishedBy: string;
  publishedAt: Date;
}

// ─── Filter Types ─────────────────────────────────────────────────────────────

export interface ThemeFilter {
  level?: ThemeLevel;
  status?: ThemeStatus;
  search?: string;
}

// ─── Atomic revision commit ───────────────────────────────────────────────────

/** Theme fields a revision commit (publish / rollback) may set. */
export type ThemeRevisionCommitUpdate = Partial<
  Pick<ThemeEntity, 'tokens' | 'assets' | 'status' | 'currentRevision'>
>;

/**
 * Raised by `ThemeRepository.commitRevision` when the commit cannot be applied
 * atomically: the (themeId, revisionNumber) pair already exists (a concurrent
 * publish/rollback won the number), the theme's status no longer matches the
 * caller's precondition (e.g. archived concurrently), or the theme is gone.
 */
export class ThemeRevisionConflictError extends Error {
  constructor(
    readonly reason: 'revision_number_taken' | 'status_changed' | 'theme_missing',
    message: string,
  ) {
    super(message);
    this.name = 'ThemeRevisionConflictError';
  }
}

// ─── Repository Interface ─────────────────────────────────────────────────────

/**
 * Tenancy contract (PRC-M395, #555 review #10):
 * - Tenant and portal themes are tenant-owned rows (`tenantId` = owning tenant,
 *   tenants FK + tenant RLS).
 * - The platform default theme is global. It is created and read only through
 *   `createPlatformTheme` / `findPlatformTheme`, and its `tenantId` is
 *   {@link PLATFORM_THEME_OWNER_SENTINEL}, never a `tenants` row. A persistent
 *   implementation MUST serve those methods (and platform-theme revisions) on a
 *   platform-scope path: a table without the tenants FK and tenant RLS, accessed
 *   under platform scope. It must never insert the sentinel inside a
 *   tenant-bound transaction, where WITH CHECK / the FK would reject it and
 *   tenant-scoped reads could not see it.
 */
export interface ThemeRepository {
  // ─── Platform default theme (platform scope) ────────────────────────────────
  createPlatformTheme(entity: Omit<ThemeEntity, 'createdAt' | 'updatedAt'>): Promise<ThemeEntity>;
  findPlatformTheme(): Promise<ThemeEntity | null>;

  // ─── Themes ─────────────────────────────────────────────────────────────────

  createTheme(entity: Omit<ThemeEntity, 'createdAt' | 'updatedAt'>): Promise<ThemeEntity>;

  findThemeById(id: string): Promise<ThemeEntity | null>;

  findThemeByTenantAndLevel(
    tenantId: string,
    level: ThemeLevel,
    portalId?: string,
  ): Promise<ThemeEntity | null>;

  listThemes(
    tenantId: string,
    filter: ThemeFilter,
    page: number,
    pageSize: number,
  ): Promise<{ data: ThemeEntity[]; total: number }>;

  updateTheme(
    id: string,
    updates: Partial<
      Pick<ThemeEntity, 'name' | 'description' | 'tokens' | 'assets' | 'status' | 'currentRevision'>
    >,
  ): Promise<ThemeEntity>;

  deleteTheme(id: string): Promise<void>;

  // ─── Revisions ──────────────────────────────────────────────────────────────

  createRevision(entity: ThemeRevisionEntity): Promise<ThemeRevisionEntity>;

  findRevisionById(id: string): Promise<ThemeRevisionEntity | null>;

  findRevisionByThemeAndNumber(
    themeId: string,
    revisionNumber: number,
  ): Promise<ThemeRevisionEntity | null>;

  listRevisions(themeId: string): Promise<ThemeRevisionEntity[]>;

  getLatestRevisionNumber(themeId: string): Promise<number>;
  /**
   * Atomically record `revision` and apply `themeUpdate` to its theme (#555
   * review #12). All-or-nothing: rejects with {@link ThemeRevisionConflictError}
   * and writes nothing when (themeId, revisionNumber) already exists or, when
   * `requireStatusIn` is given, the theme's current status is not in it.
   * Persistent implementations: one transaction, a UNIQUE
   * (theme_id, revision_number) index, and the status precondition evaluated on
   * the locked theme row.
   */
  commitRevision(
    revision: ThemeRevisionEntity,
    themeUpdate: ThemeRevisionCommitUpdate,
    options?: { requireStatusIn?: readonly ThemeStatus[] },
  ): Promise<ThemeEntity>;
}
/** Owner id carried by the platform theme entity; never a `tenants` row. */
export const PLATFORM_THEME_OWNER_SENTINEL = '00000000-0000-0000-0000-000000000000';
