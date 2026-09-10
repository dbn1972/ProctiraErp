/**
 * In-Memory Translation Repository
 *
 * In-memory implementation of TranslationRepository for testing and development.
 */
import type { Translation, TranslatableEntityType } from './translation-schemas.js';
import type {
  TranslationRepository,
  TranslationListOptions,
  TranslationListResult,
} from './translation-repository.js';

export class InMemoryTranslationRepository implements TranslationRepository {
  private translations: Map<string, Translation> = new Map();

  async createTranslation(translation: Translation): Promise<Translation> {
    this.translations.set(translation.id, { ...translation });
    return { ...translation };
  }

  async upsertTranslation(translation: Translation): Promise<Translation> {
    // Check if a translation already exists for this entity/language/field combination
    const existing = await this.findTranslation(
      translation.warehouseId,
      translation.tenantId,
      translation.entityType,
      translation.entityId,
      translation.language,
      translation.field,
    );

    if (existing) {
      const updated = { ...existing, value: translation.value, updatedAt: new Date() };
      this.translations.set(existing.id, updated);
      return { ...updated };
    }

    this.translations.set(translation.id, { ...translation });
    return { ...translation };
  }

  async upsertTranslationsBatch(translations: Translation[]): Promise<Translation[]> {
    const results: Translation[] = [];
    for (const translation of translations) {
      const result = await this.upsertTranslation(translation);
      results.push(result);
    }
    return results;
  }

  async deleteTranslation(id: string, warehouseId: string, tenantId: string): Promise<void> {
    const existing = this.translations.get(id);
    if (!existing || existing.warehouseId !== warehouseId || existing.tenantId !== tenantId) {
      throw new Error(`Translation not found: ${id}`);
    }
    this.translations.delete(id);
  }

  async findTranslation(
    warehouseId: string,
    tenantId: string,
    entityType: TranslatableEntityType,
    entityId: string,
    language: string,
    field: string,
  ): Promise<Translation | null> {
    const translation = Array.from(this.translations.values()).find(
      (t) =>
        t.warehouseId === warehouseId &&
        t.tenantId === tenantId &&
        t.entityType === entityType &&
        t.entityId === entityId &&
        t.language === language &&
        t.field === field,
    );
    return translation ? { ...translation } : null;
  }

  async listTranslations(
    warehouseId: string,
    tenantId: string,
    options: TranslationListOptions,
  ): Promise<TranslationListResult> {
    let results = Array.from(this.translations.values()).filter(
      (t) => t.warehouseId === warehouseId && t.tenantId === tenantId,
    );

    if (options.language) {
      results = results.filter((t) => t.language === options.language);
    }
    if (options.entityType) {
      results = results.filter((t) => t.entityType === options.entityType);
    }
    if (options.entityId) {
      results = results.filter((t) => t.entityId === options.entityId);
    }

    const total = results.length;
    const offset = (options.page - 1) * options.pageSize;
    const data = results.slice(offset, offset + options.pageSize);
    return { data: data.map((t) => ({ ...t })), total };
  }

  async getTranslationsForEntity(
    warehouseId: string,
    tenantId: string,
    entityType: TranslatableEntityType,
    entityId: string,
  ): Promise<Translation[]> {
    return Array.from(this.translations.values())
      .filter(
        (t) =>
          t.warehouseId === warehouseId &&
          t.tenantId === tenantId &&
          t.entityType === entityType &&
          t.entityId === entityId,
      )
      .map((t) => ({ ...t }));
  }

  async getTranslationsByLanguage(
    warehouseId: string,
    tenantId: string,
    language: string,
  ): Promise<Translation[]> {
    return Array.from(this.translations.values())
      .filter(
        (t) => t.warehouseId === warehouseId && t.tenantId === tenantId && t.language === language,
      )
      .map((t) => ({ ...t }));
  }

  async deleteTranslationsForEntity(
    warehouseId: string,
    tenantId: string,
    entityType: TranslatableEntityType,
    entityId: string,
  ): Promise<void> {
    const toDelete = Array.from(this.translations.entries()).filter(
      ([, t]) =>
        t.warehouseId === warehouseId &&
        t.tenantId === tenantId &&
        t.entityType === entityType &&
        t.entityId === entityId,
    );
    for (const [id] of toDelete) {
      this.translations.delete(id);
    }
  }
}
