/**
 * In-Memory Theme Repository
 *
 * Used for testing and local development without a database.
 */
import type { ThemeLevel, ThemeStatus } from './schemas.js';
import {
  PLATFORM_THEME_OWNER_SENTINEL,
  ThemeRevisionConflictError,
  type ThemeRepository,
  type ThemeEntity,
  type ThemeRevisionEntity,
  type ThemeFilter,
  type ThemeRevisionCommitUpdate,
} from './theme-repository.js';

export class InMemoryThemeRepository implements ThemeRepository {
  private themes: Map<string, ThemeEntity> = new Map();
  private revisions: Map<string, ThemeRevisionEntity> = new Map();

  // ─── Platform default theme ─────────────────────────────────────────────────

  async createPlatformTheme(
    entity: Omit<ThemeEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<ThemeEntity> {
    if (entity.level !== 'platform' || entity.tenantId !== PLATFORM_THEME_OWNER_SENTINEL) {
      throw new Error('createPlatformTheme requires a platform-level, platform-owned entity');
    }
    return this.createTheme(entity);
  }

  async findPlatformTheme(): Promise<ThemeEntity | null> {
    for (const theme of this.themes.values()) {
      if (theme.level === 'platform' && theme.tenantId === PLATFORM_THEME_OWNER_SENTINEL) {
        return theme;
      }
    }
    return null;
  }

  // ─── Themes ─────────────────────────────────────────────────────────────────

  async createTheme(entity: Omit<ThemeEntity, 'createdAt' | 'updatedAt'>): Promise<ThemeEntity> {
    const now = new Date();
    const theme: ThemeEntity = { ...entity, createdAt: now, updatedAt: now };
    this.themes.set(theme.id, theme);
    return theme;
  }

  async findThemeById(id: string): Promise<ThemeEntity | null> {
    return this.themes.get(id) ?? null;
  }

  async findThemeByTenantAndLevel(
    tenantId: string,
    level: ThemeLevel,
    portalId?: string,
  ): Promise<ThemeEntity | null> {
    for (const theme of this.themes.values()) {
      if (theme.tenantId === tenantId && theme.level === level) {
        if (level === 'portal' && portalId) {
          if (theme.portalId === portalId) return theme;
        } else {
          return theme;
        }
      }
    }
    return null;
  }

  async listThemes(
    tenantId: string,
    filter: ThemeFilter,
    page: number,
    pageSize: number,
  ): Promise<{ data: ThemeEntity[]; total: number }> {
    let results = Array.from(this.themes.values()).filter((t) => t.tenantId === tenantId);

    if (filter.level) {
      results = results.filter((t) => t.level === filter.level);
    }
    if (filter.status) {
      results = results.filter((t) => t.status === filter.status);
    }
    if (filter.search) {
      const search = filter.search.toLowerCase();
      results = results.filter(
        (t) =>
          t.name.toLowerCase().includes(search) ||
          (t.description?.toLowerCase().includes(search) ?? false),
      );
    }

    const total = results.length;
    const offset = (page - 1) * pageSize;
    const data = results.slice(offset, offset + pageSize);

    return { data, total };
  }

  async updateTheme(
    id: string,
    updates: Partial<
      Pick<ThemeEntity, 'name' | 'description' | 'tokens' | 'assets' | 'status' | 'currentRevision'>
    >,
  ): Promise<ThemeEntity> {
    const theme = this.themes.get(id);
    if (!theme) throw new Error(`Theme not found: ${id}`);
    const updated: ThemeEntity = { ...theme, ...updates, updatedAt: new Date() };
    this.themes.set(id, updated);
    return updated;
  }

  async deleteTheme(id: string): Promise<void> {
    this.themes.delete(id);
  }

  // ─── Revisions ──────────────────────────────────────────────────────────────

  async createRevision(entity: ThemeRevisionEntity): Promise<ThemeRevisionEntity> {
    this.revisions.set(entity.id, entity);
    return entity;
  }

  async findRevisionById(id: string): Promise<ThemeRevisionEntity | null> {
    return this.revisions.get(id) ?? null;
  }

  async findRevisionByThemeAndNumber(
    themeId: string,
    revisionNumber: number,
  ): Promise<ThemeRevisionEntity | null> {
    for (const rev of this.revisions.values()) {
      if (rev.themeId === themeId && rev.revisionNumber === revisionNumber) {
        return rev;
      }
    }
    return null;
  }

  async listRevisions(themeId: string): Promise<ThemeRevisionEntity[]> {
    const results: ThemeRevisionEntity[] = [];
    for (const rev of this.revisions.values()) {
      if (rev.themeId === themeId) {
        results.push(rev);
      }
    }
    return results.sort((a, b) => b.revisionNumber - a.revisionNumber);
  }

  async getLatestRevisionNumber(themeId: string): Promise<number> {
    let max = 0;
    for (const rev of this.revisions.values()) {
      if (rev.themeId === themeId && rev.revisionNumber > max) {
        max = rev.revisionNumber;
      }
    }
    return max;
  }
  async commitRevision(
    revision: ThemeRevisionEntity,
    themeUpdate: ThemeRevisionCommitUpdate,
    options: { requireStatusIn?: readonly ThemeStatus[] } = {},
  ): Promise<ThemeEntity> {
    // Single synchronous critical section: checks and both writes happen with no
    // await in between, which is the in-memory equivalent of one transaction.
    const theme = this.themes.get(revision.themeId);
    if (!theme) {
      throw new ThemeRevisionConflictError('theme_missing', `Theme not found: ${revision.themeId}`);
    }
    if (options.requireStatusIn && !options.requireStatusIn.includes(theme.status)) {
      throw new ThemeRevisionConflictError(
        'status_changed',
        `Theme ${theme.id} is ${theme.status}`,
      );
    }
    for (const rev of this.revisions.values()) {
      if (rev.themeId === revision.themeId && rev.revisionNumber === revision.revisionNumber) {
        throw new ThemeRevisionConflictError(
          'revision_number_taken',
          `Revision ${revision.revisionNumber} already exists for theme ${revision.themeId}`,
        );
      }
    }
    this.revisions.set(revision.id, revision);
    const updated: ThemeEntity = { ...theme, ...themeUpdate, updatedAt: new Date() };
    this.themes.set(theme.id, updated);
    return updated;
  }
}
