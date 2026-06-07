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

// ─── Repository Interface ─────────────────────────────────────────────────────

export interface ThemeRepository {
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
    updates: Partial<Pick<ThemeEntity, 'name' | 'description' | 'tokens' | 'assets' | 'status' | 'currentRevision'>>,
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
}
