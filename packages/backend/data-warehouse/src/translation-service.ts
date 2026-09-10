/**
 * Translation Service
 *
 * Manages multi-language metadata for indicators, units, subgroups, and areas.
 * Supports translation import/export in JSON and CSV formats.
 * Implements Requirement 15.5.
 */
import { v4 as uuidv4 } from 'uuid';
import { NotFoundError } from '@proctira/common';

import type {
  Translation,
  TranslatableEntityType,
  CreateTranslationInput,
  BatchTranslationInput,
  TranslationImportInput,
  TranslationExportQuery,
  TranslationImportResult,
  TranslationExportResult,
} from './translation-schemas.js';
import type { TranslationRepository } from './translation-repository.js';
import type { WarehouseRepository } from './warehouse-repository.js';

export interface TranslationServiceConfig {
  /** Supported languages */
  supportedLanguages: string[];
  /** Maximum translations per import batch */
  maxImportBatchSize: number;
}

export class TranslationService {
  constructor(
    private readonly translationRepository: TranslationRepository,
    private readonly warehouseRepository: WarehouseRepository,
    private readonly config: TranslationServiceConfig,
  ) {}

  /**
   * Create or update a single translation.
   */
  async setTranslation(
    tenantId: string,
    warehouseId: string,
    input: CreateTranslationInput,
  ): Promise<Translation> {
    // Validate warehouse exists
    const warehouse = await this.warehouseRepository.findWarehouseById(warehouseId, tenantId);
    if (!warehouse) {
      throw new NotFoundError(`Warehouse not found: ${warehouseId}`);
    }

    // Validate entity exists
    await this.validateEntityExists(tenantId, warehouseId, input.entityType, input.entityId);

    const now = new Date();
    const translation: Translation = {
      id: uuidv4(),
      warehouseId,
      tenantId,
      entityType: input.entityType,
      entityId: input.entityId,
      language: input.language,
      field: input.field,
      value: input.value,
      createdAt: now,
      updatedAt: now,
    };

    return this.translationRepository.upsertTranslation(translation);
  }

  /**
   * Set multiple translations in batch.
   */
  async setTranslationsBatch(
    tenantId: string,
    warehouseId: string,
    input: BatchTranslationInput,
  ): Promise<{
    successCount: number;
    errorCount: number;
    errors: Array<{ index: number; message: string }>;
  }> {
    const warehouse = await this.warehouseRepository.findWarehouseById(warehouseId, tenantId);
    if (!warehouse) {
      throw new NotFoundError(`Warehouse not found: ${warehouseId}`);
    }

    const errors: Array<{ index: number; message: string }> = [];
    const validTranslations: Translation[] = [];
    const now = new Date();

    for (let i = 0; i < input.translations.length; i++) {
      const item = input.translations[i]!;
      try {
        await this.validateEntityExists(tenantId, warehouseId, item.entityType, item.entityId);
        validTranslations.push({
          id: uuidv4(),
          warehouseId,
          tenantId,
          entityType: item.entityType,
          entityId: item.entityId,
          language: item.language,
          field: item.field,
          value: item.value,
          createdAt: now,
          updatedAt: now,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        errors.push({ index: i, message });
      }
    }

    if (validTranslations.length > 0) {
      await this.translationRepository.upsertTranslationsBatch(validTranslations);
    }

    return {
      successCount: validTranslations.length,
      errorCount: errors.length,
      errors,
    };
  }

  /**
   * Get translations for a specific entity.
   */
  async getEntityTranslations(
    tenantId: string,
    warehouseId: string,
    entityType: TranslatableEntityType,
    entityId: string,
  ): Promise<Translation[]> {
    const warehouse = await this.warehouseRepository.findWarehouseById(warehouseId, tenantId);
    if (!warehouse) {
      throw new NotFoundError(`Warehouse not found: ${warehouseId}`);
    }

    return this.translationRepository.getTranslationsForEntity(
      warehouseId,
      tenantId,
      entityType,
      entityId,
    );
  }

  /**
   * List translations with filtering.
   */
  async listTranslations(
    tenantId: string,
    warehouseId: string,
    options: {
      language?: string;
      entityType?: TranslatableEntityType;
      entityId?: string;
      page?: number;
      pageSize?: number;
    },
  ): Promise<{ data: Translation[]; total: number }> {
    const warehouse = await this.warehouseRepository.findWarehouseById(warehouseId, tenantId);
    if (!warehouse) {
      throw new NotFoundError(`Warehouse not found: ${warehouseId}`);
    }

    return this.translationRepository.listTranslations(warehouseId, tenantId, {
      language: options.language,
      entityType: options.entityType,
      entityId: options.entityId,
      page: options.page || 1,
      pageSize: options.pageSize || 50,
    });
  }

  /**
   * Export translations in the specified format.
   */
  async exportTranslations(
    tenantId: string,
    warehouseId: string,
    query: TranslationExportQuery,
  ): Promise<TranslationExportResult> {
    const warehouse = await this.warehouseRepository.findWarehouseById(warehouseId, tenantId);
    if (!warehouse) {
      throw new NotFoundError(`Warehouse not found: ${warehouseId}`);
    }

    const format = query.format || 'json';

    // Get all translations matching the filter
    const result = await this.translationRepository.listTranslations(warehouseId, tenantId, {
      language: query.language,
      entityType: query.entityType,
      page: 1,
      pageSize: 100000, // Get all for export
    });

    let content: string;
    if (format === 'csv') {
      content = this.translationsToCSV(result.data);
    } else {
      content = this.translationsToJSON(result.data);
    }

    return {
      format,
      language: query.language || null,
      entityType: query.entityType || null,
      totalRecords: result.data.length,
      content,
    };
  }

  /**
   * Import translations from the specified format.
   */
  async importTranslations(
    tenantId: string,
    warehouseId: string,
    input: TranslationImportInput,
  ): Promise<TranslationImportResult> {
    const warehouse = await this.warehouseRepository.findWarehouseById(warehouseId, tenantId);
    if (!warehouse) {
      throw new NotFoundError(`Warehouse not found: ${warehouseId}`);
    }

    let rawTranslations: Array<{
      entityType: TranslatableEntityType;
      entityId: string;
      language: string;
      field: string;
      value: string;
    }>;

    try {
      if (input.format === 'csv') {
        rawTranslations = this.parseCSVTranslations(input.content);
      } else {
        rawTranslations = this.parseJSONTranslations(input.content);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Parse error';
      return {
        totalRows: 0,
        successCount: 0,
        errorCount: 1,
        updatedCount: 0,
        errors: [{ row: 0, field: null, message: `Failed to parse import content: ${message}` }],
      };
    }

    if (rawTranslations.length > this.config.maxImportBatchSize) {
      return {
        totalRows: rawTranslations.length,
        successCount: 0,
        errorCount: 1,
        updatedCount: 0,
        errors: [
          {
            row: 0,
            field: null,
            message: `Import batch size ${rawTranslations.length} exceeds maximum of ${this.config.maxImportBatchSize}`,
          },
        ],
      };
    }

    const errors: Array<{ row: number; field: string | null; message: string }> = [];
    const validTranslations: Translation[] = [];
    let updatedCount = 0;
    const now = new Date();

    for (let i = 0; i < rawTranslations.length; i++) {
      const item = rawTranslations[i]!;

      // Validate required fields
      if (!item.entityType || !item.entityId || !item.language || !item.field || !item.value) {
        errors.push({ row: i + 1, field: null, message: 'Missing required fields' });
        continue;
      }

      // Validate entity type
      if (!['indicator', 'unit', 'subgroup', 'area'].includes(item.entityType)) {
        errors.push({
          row: i + 1,
          field: 'entityType',
          message: `Invalid entity type: ${item.entityType}`,
        });
        continue;
      }

      // Check if this is an update
      const existing = await this.translationRepository.findTranslation(
        warehouseId,
        tenantId,
        item.entityType,
        item.entityId,
        item.language,
        item.field,
      );
      if (existing) {
        updatedCount++;
      }

      validTranslations.push({
        id: existing?.id || uuidv4(),
        warehouseId,
        tenantId,
        entityType: item.entityType,
        entityId: item.entityId,
        language: item.language,
        field: item.field,
        value: item.value,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      });
    }

    if (validTranslations.length > 0) {
      await this.translationRepository.upsertTranslationsBatch(validTranslations);
    }

    return {
      totalRows: rawTranslations.length,
      successCount: validTranslations.length,
      errorCount: errors.length,
      updatedCount,
      errors,
    };
  }

  /**
   * Get a translated value for an entity field, with fallback to default language.
   */
  async getTranslatedValue(
    tenantId: string,
    warehouseId: string,
    entityType: TranslatableEntityType,
    entityId: string,
    field: string,
    language: string,
    defaultValue: string,
  ): Promise<string> {
    // Try requested language
    const translation = await this.translationRepository.findTranslation(
      warehouseId,
      tenantId,
      entityType,
      entityId,
      language,
      field,
    );
    if (translation) {
      return translation.value;
    }

    // Fallback to default language of the warehouse
    const warehouse = await this.warehouseRepository.findWarehouseById(warehouseId, tenantId);
    if (warehouse && warehouse.defaultLanguage !== language) {
      const fallback = await this.translationRepository.findTranslation(
        warehouseId,
        tenantId,
        entityType,
        entityId,
        warehouse.defaultLanguage,
        field,
      );
      if (fallback) {
        return fallback.value;
      }
    }

    // Return the default value (original entity field value)
    return defaultValue;
  }

  private async validateEntityExists(
    tenantId: string,
    warehouseId: string,
    entityType: TranslatableEntityType,
    entityId: string,
  ): Promise<void> {
    switch (entityType) {
      case 'indicator': {
        const indicator = await this.warehouseRepository.findIndicatorById(
          entityId,
          warehouseId,
          tenantId,
        );
        if (!indicator) throw new NotFoundError(`Indicator not found: ${entityId}`);
        break;
      }
      case 'unit': {
        const unit = await this.warehouseRepository.findUnitById(entityId, warehouseId, tenantId);
        if (!unit) throw new NotFoundError(`Unit not found: ${entityId}`);
        break;
      }
      case 'subgroup': {
        const subgroup = await this.warehouseRepository.findSubgroupById(
          entityId,
          warehouseId,
          tenantId,
        );
        if (!subgroup) throw new NotFoundError(`Subgroup not found: ${entityId}`);
        break;
      }
      case 'area': {
        const area = await this.warehouseRepository.findAreaById(entityId, warehouseId, tenantId);
        if (!area) throw new NotFoundError(`Area not found: ${entityId}`);
        break;
      }
    }
  }

  private translationsToCSV(translations: Translation[]): string {
    const header = 'entityType,entityId,language,field,value';
    const rows = translations.map((t) => {
      const escapedValue =
        t.value.includes(',') || t.value.includes('"') || t.value.includes('\n')
          ? `"${t.value.replace(/"/g, '""')}"`
          : t.value;
      return `${t.entityType},${t.entityId},${t.language},${t.field},${escapedValue}`;
    });
    return [header, ...rows].join('\n');
  }

  private translationsToJSON(translations: Translation[]): string {
    const exportData = translations.map((t) => ({
      entityType: t.entityType,
      entityId: t.entityId,
      language: t.language,
      field: t.field,
      value: t.value,
    }));
    return JSON.stringify(exportData, null, 2);
  }

  private parseCSVTranslations(content: string): Array<{
    entityType: TranslatableEntityType;
    entityId: string;
    language: string;
    field: string;
    value: string;
  }> {
    const decoded = this.decodeContent(content);

    const lines = decoded.trim().split('\n');
    if (lines.length <= 1) return [];

    // Skip header
    const dataLines = lines.slice(1);
    return dataLines
      .map((line) => {
        const parts = this.parseCSVLine(line);
        return {
          entityType: parts[0] as TranslatableEntityType,
          entityId: parts[1] || '',
          language: parts[2] || '',
          field: parts[3] || '',
          value: parts[4] || '',
        };
      })
      .filter((t) => t.entityId && t.language && t.field && t.value);
  }

  private parseJSONTranslations(content: string): Array<{
    entityType: TranslatableEntityType;
    entityId: string;
    language: string;
    field: string;
    value: string;
  }> {
    const decoded = this.decodeContent(content);

    const parsed = JSON.parse(decoded);
    if (!Array.isArray(parsed)) {
      throw new Error('Expected JSON array of translation objects');
    }

    return parsed.map((item: Record<string, unknown>) => ({
      entityType: item.entityType as TranslatableEntityType,
      entityId: (item.entityId as string) || '',
      language: (item.language as string) || '',
      field: (item.field as string) || '',
      value: (item.value as string) || '',
    }));
  }

  /**
   * Decode content that may be base64-encoded or raw text.
   * Tries to parse as raw text first (JSON/CSV), then falls back to base64 decoding.
   */
  private decodeContent(content: string): string {
    // If it looks like valid JSON or CSV (starts with [ or has commas/newlines), use as-is
    const trimmed = content.trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{') || trimmed.includes('\n')) {
      return content;
    }

    // Try base64 decoding
    try {
      const decoded = Buffer.from(content, 'base64').toString('utf-8');
      // Verify the decoded content is valid UTF-8 text
      if (
        decoded &&
        (decoded.startsWith('[') ||
          decoded.startsWith('{') ||
          decoded.includes('\n') ||
          decoded.includes(','))
      ) {
        return decoded;
      }
    } catch {
      // Not valid base64, use as-is
    }

    return content;
  }

  private parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i]!;
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  }
}
