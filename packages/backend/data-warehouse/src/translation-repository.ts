/**
 * Translation Repository Interface
 *
 * Defines the contract for translation persistence operations.
 */
import type { Translation, TranslatableEntityType } from './translation-schemas.js';

export interface TranslationListOptions {
  language?: string;
  entityType?: TranslatableEntityType;
  entityId?: string;
  page: number;
  pageSize: number;
}

export interface TranslationListResult {
  data: Translation[];
  total: number;
}

/**
 * Repository interface for translation CRUD operations.
 */
export interface TranslationRepository {
  createTranslation(translation: Translation): Promise<Translation>;
  upsertTranslation(translation: Translation): Promise<Translation>;
  upsertTranslationsBatch(translations: Translation[]): Promise<Translation[]>;
  deleteTranslation(id: string, warehouseId: string, tenantId: string): Promise<void>;
  findTranslation(
    warehouseId: string,
    tenantId: string,
    entityType: TranslatableEntityType,
    entityId: string,
    language: string,
    field: string,
  ): Promise<Translation | null>;
  listTranslations(warehouseId: string, tenantId: string, options: TranslationListOptions): Promise<TranslationListResult>;
  getTranslationsForEntity(
    warehouseId: string,
    tenantId: string,
    entityType: TranslatableEntityType,
    entityId: string,
  ): Promise<Translation[]>;
  getTranslationsByLanguage(
    warehouseId: string,
    tenantId: string,
    language: string,
  ): Promise<Translation[]>;
  deleteTranslationsForEntity(
    warehouseId: string,
    tenantId: string,
    entityType: TranslatableEntityType,
    entityId: string,
  ): Promise<void>;
}
