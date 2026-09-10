/**
 * In-Memory Theme Repository
 *
 * Used for testing and local development without a database.
 */
import type {
  ThemeRepository,
  ThemeEntity,
  ThemeRevisionEntity,
  ThemeFilter,
} from './theme-repository.js';
import type { ThemeLevel } from './schemas.js';

export class InMemoryThemeRepository implements ThemeRepository {
  private themes: Map<string, ThemeEntity> = new Map();
  private revisions: Map<string, ThemeRevisionEntity> = new Map();

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
}
