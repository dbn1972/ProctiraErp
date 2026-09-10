/**
 * Translation Schemas
 *
 * Typebox schemas for multi-language metadata management.
 * Supports translation import/export for indicators, units, subgroups, and areas.
 * Implements Requirement 15.5.
 */
import { Type, type Static } from '@sinclair/typebox';

/** UUID v4 pattern for validation */
const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
const UuidString = () => Type.String({ pattern: UUID_PATTERN, description: 'UUID v4 identifier' });

// ─── Entity Types for Translation ────────────────────────────────────────────

export const TranslatableEntityTypeSchema = Type.Union([
  Type.Literal('indicator'),
  Type.Literal('unit'),
  Type.Literal('subgroup'),
  Type.Literal('area'),
]);

export type TranslatableEntityType = Static<typeof TranslatableEntityTypeSchema>;

// ─── Translation Entity ──────────────────────────────────────────────────────

export interface Translation {
  id: string;
  warehouseId: string;
  tenantId: string;
  entityType: TranslatableEntityType;
  entityId: string;
  language: string;
  field: string;
  value: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Create Translation Schema ───────────────────────────────────────────────

export const CreateTranslationSchema = Type.Object({
  entityType: TranslatableEntityTypeSchema,
  entityId: UuidString(),
  language: Type.String({ minLength: 2, maxLength: 10 }),
  field: Type.String({
    minLength: 1,
    maxLength: 50,
    description: 'Field name to translate (e.g., "name", "shortName", "info")',
  }),
  value: Type.String({ minLength: 1, maxLength: 5000 }),
});

export type CreateTranslationInput = Static<typeof CreateTranslationSchema>;

// ─── Batch Translation Schema ────────────────────────────────────────────────

export const BatchTranslationSchema = Type.Object({
  translations: Type.Array(CreateTranslationSchema, { minItems: 1, maxItems: 1000 }),
});

export type BatchTranslationInput = Static<typeof BatchTranslationSchema>;

// ─── Translation Import/Export Schema ────────────────────────────────────────

export const TranslationExportQuerySchema = Type.Object({
  language: Type.Optional(Type.String({ minLength: 2, maxLength: 10 })),
  entityType: Type.Optional(TranslatableEntityTypeSchema),
  format: Type.Optional(Type.Union([Type.Literal('json'), Type.Literal('csv')])),
});

export type TranslationExportQuery = Static<typeof TranslationExportQuerySchema>;

export const TranslationImportSchema = Type.Object({
  format: Type.Union([Type.Literal('json'), Type.Literal('csv')]),
  content: Type.String({ description: 'Base64-encoded content or raw JSON string' }),
});

export type TranslationImportInput = Static<typeof TranslationImportSchema>;

// ─── Translation List Query ──────────────────────────────────────────────────

export const TranslationListQuerySchema = Type.Object({
  language: Type.Optional(Type.String({ minLength: 2, maxLength: 10 })),
  entityType: Type.Optional(TranslatableEntityTypeSchema),
  entityId: Type.Optional(UuidString()),
  page: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 50 })),
});

export type TranslationListQuery = Static<typeof TranslationListQuerySchema>;

// ─── Translation Import Result ───────────────────────────────────────────────

export interface TranslationImportResult {
  totalRows: number;
  successCount: number;
  errorCount: number;
  updatedCount: number;
  errors: TranslationImportError[];
}

export interface TranslationImportError {
  row: number;
  field: string | null;
  message: string;
}

// ─── Translation Export Result ───────────────────────────────────────────────

export interface TranslationExportResult {
  format: 'json' | 'csv';
  language: string | null;
  entityType: string | null;
  totalRecords: number;
  content: string;
}
