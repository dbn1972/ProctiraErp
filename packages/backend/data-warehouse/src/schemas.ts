/**
 * Data Warehouse Schemas
 *
 * Typebox schemas for DevInfo/DI7 data warehouse entities:
 * indicators, units, subgroups, time periods, areas, and data records.
 * Follows the DI7 schema standard for statistical data warehousing.
 */
import { Type, type Static } from '@sinclair/typebox';

/** UUID v4 pattern for validation */
const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
const UuidString = () => Type.String({ pattern: UUID_PATTERN, description: 'UUID v4 identifier' });

// ─── Warehouse Schema ─────────────────────────────────────────────────────────

/**
 * Create warehouse request body.
 */
export const CreateWarehouseSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255 }),
  description: Type.Optional(Type.String({ maxLength: 2000 })),
  defaultLanguage: Type.Optional(Type.String({ minLength: 2, maxLength: 10, default: 'en' })),
});

export type CreateWarehouseInput = Static<typeof CreateWarehouseSchema>;

/**
 * Update warehouse request body.
 */
export const UpdateWarehouseSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  description: Type.Optional(Type.String({ maxLength: 2000 })),
  defaultLanguage: Type.Optional(Type.String({ minLength: 2, maxLength: 10 })),
});

export type UpdateWarehouseInput = Static<typeof UpdateWarehouseSchema>;

// ─── Indicator Schema ─────────────────────────────────────────────────────────

/**
 * Create indicator request body.
 */
export const CreateIndicatorSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255 }),
  gid: Type.String({
    minLength: 1,
    maxLength: 60,
    description: 'Global unique identifier for the indicator',
  }),
  shortName: Type.Optional(Type.String({ maxLength: 50 })),
  keywords: Type.Optional(Type.String({ maxLength: 255 })),
  info: Type.Optional(Type.String({ maxLength: 5000 })),
  highIsGood: Type.Optional(Type.Boolean({ default: false })),
});

export type CreateIndicatorInput = Static<typeof CreateIndicatorSchema>;

/**
 * Update indicator request body.
 */
export const UpdateIndicatorSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  shortName: Type.Optional(Type.String({ maxLength: 50 })),
  keywords: Type.Optional(Type.String({ maxLength: 255 })),
  info: Type.Optional(Type.String({ maxLength: 5000 })),
  highIsGood: Type.Optional(Type.Boolean()),
});

export type UpdateIndicatorInput = Static<typeof UpdateIndicatorSchema>;

// ─── Unit Schema ──────────────────────────────────────────────────────────────

/**
 * Create unit request body.
 */
export const CreateUnitSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 128 }),
  gid: Type.String({
    minLength: 1,
    maxLength: 60,
    description: 'Global unique identifier for the unit',
  }),
});

export type CreateUnitInput = Static<typeof CreateUnitSchema>;

/**
 * Update unit request body.
 */
export const UpdateUnitSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
});

export type UpdateUnitInput = Static<typeof UpdateUnitSchema>;

// ─── Subgroup Schema ──────────────────────────────────────────────────────────

/**
 * Create subgroup request body.
 */
export const CreateSubgroupSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 128 }),
  gid: Type.String({
    minLength: 1,
    maxLength: 255,
    description: 'Global unique identifier for the subgroup',
  }),
  typeName: Type.Optional(Type.String({ maxLength: 128 })),
});

export type CreateSubgroupInput = Static<typeof CreateSubgroupSchema>;

/**
 * Update subgroup request body.
 */
export const UpdateSubgroupSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  typeName: Type.Optional(Type.String({ maxLength: 128 })),
});

export type UpdateSubgroupInput = Static<typeof UpdateSubgroupSchema>;

// ─── Time Period Schema ───────────────────────────────────────────────────────

/**
 * Create time period request body.
 */
export const CreateTimePeriodSchema = Type.Object({
  timePeriod: Type.String({
    minLength: 1,
    maxLength: 30,
    description: 'Time period label (e.g., "2023", "2023.Q1")',
  }),
  startDate: Type.Optional(Type.String({ description: 'ISO date string for period start' })),
  endDate: Type.Optional(Type.String({ description: 'ISO date string for period end' })),
  periodicity: Type.Optional(
    Type.String({ maxLength: 50, description: 'Periodicity (e.g., "Annual", "Quarterly")' }),
  ),
});

export type CreateTimePeriodInput = Static<typeof CreateTimePeriodSchema>;

/**
 * Update time period request body.
 */
export const UpdateTimePeriodSchema = Type.Object({
  startDate: Type.Optional(Type.String()),
  endDate: Type.Optional(Type.String()),
  periodicity: Type.Optional(Type.String({ maxLength: 50 })),
});

export type UpdateTimePeriodInput = Static<typeof UpdateTimePeriodSchema>;

// ─── Area Schema ──────────────────────────────────────────────────────────────

/**
 * Create area request body.
 */
export const CreateAreaSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 60 }),
  areaId: Type.String({ minLength: 1, maxLength: 255, description: 'External area identifier' }),
  gid: Type.String({
    minLength: 1,
    maxLength: 60,
    description: 'Global unique identifier for the area',
  }),
  parentId: Type.Optional(UuidString()),
  level: Type.Number({ minimum: 0, maximum: 10 }),
});

export type CreateAreaInput = Static<typeof CreateAreaSchema>;

/**
 * Update area request body.
 */
export const UpdateAreaSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 60 })),
  parentId: Type.Optional(Type.Union([UuidString(), Type.Null()])),
  level: Type.Optional(Type.Number({ minimum: 0, maximum: 10 })),
});

export type UpdateAreaInput = Static<typeof UpdateAreaSchema>;

// ─── Data Import Schema ───────────────────────────────────────────────────────

/**
 * Import format types.
 */
export const ImportFormatSchema = Type.Union([
  Type.Literal('excel_des'),
  Type.Literal('csv'),
  Type.Literal('db'),
]);

export type ImportFormat = Static<typeof ImportFormatSchema>;

/**
 * A single data record for import (IUS + area + time period + value).
 */
export const DataRecordSchema = Type.Object({
  indicatorGid: Type.String({ minLength: 1 }),
  unitGid: Type.String({ minLength: 1 }),
  subgroupGid: Type.String({ minLength: 1 }),
  areaId: Type.String({ minLength: 1 }),
  timePeriod: Type.String({ minLength: 1 }),
  dataValue: Type.Optional(Type.Number()),
  textualDataValue: Type.Optional(Type.String()),
  source: Type.Optional(Type.String({ maxLength: 255 })),
  footnote: Type.Optional(Type.String()),
});

export type DataRecordInput = Static<typeof DataRecordSchema>;

/**
 * Bulk import request body.
 */
export const BulkImportSchema = Type.Object({
  format: ImportFormatSchema,
  records: Type.Optional(Type.Array(DataRecordSchema, { minItems: 1 })),
  fileContent: Type.Optional(
    Type.String({ description: 'Base64-encoded file content for Excel/CSV' }),
  ),
  dbConnectionConfig: Type.Optional(
    Type.Object({
      host: Type.String({ minLength: 1 }),
      port: Type.Number({ minimum: 1, maximum: 65535 }),
      database: Type.String({ minLength: 1 }),
      username: Type.String({ minLength: 1 }),
      password: Type.String({ minLength: 1 }),
      query: Type.String({ minLength: 1 }),
    }),
  ),
});

export type BulkImportInput = Static<typeof BulkImportSchema>;

// ─── Data Query Schema ────────────────────────────────────────────────────────

/**
 * Data query request.
 */
export const DataQuerySchema = Type.Object({
  indicatorIds: Type.Optional(Type.Array(UuidString())),
  unitIds: Type.Optional(Type.Array(UuidString())),
  subgroupIds: Type.Optional(Type.Array(UuidString())),
  areaIds: Type.Optional(Type.Array(UuidString())),
  timePeriods: Type.Optional(Type.Array(Type.String())),
  aggregation: Type.Optional(
    Type.Union([Type.Literal('sum'), Type.Literal('avg'), Type.Literal('count')]),
  ),
  page: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 1000, default: 50 })),
});

export type DataQueryInput = Static<typeof DataQuerySchema>;

// ─── Route Params & Query Schemas ─────────────────────────────────────────────

export const WarehouseParamsSchema = Type.Object({
  warehouseId: UuidString(),
});

export type WarehouseParams = Static<typeof WarehouseParamsSchema>;

export const EntityParamsSchema = Type.Object({
  warehouseId: UuidString(),
  entityId: UuidString(),
});

export type EntityParams = Static<typeof EntityParamsSchema>;

export const WarehouseListQuerySchema = Type.Object({
  page: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20 })),
  search: Type.Optional(Type.String()),
});

export type WarehouseListQuery = Static<typeof WarehouseListQuerySchema>;

// ─── Entity Types ─────────────────────────────────────────────────────────────

export interface Warehouse {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  defaultLanguage: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Indicator {
  id: string;
  warehouseId: string;
  tenantId: string;
  name: string;
  gid: string;
  shortName: string | null;
  keywords: string | null;
  info: string | null;
  highIsGood: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Unit {
  id: string;
  warehouseId: string;
  tenantId: string;
  name: string;
  gid: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Subgroup {
  id: string;
  warehouseId: string;
  tenantId: string;
  name: string;
  gid: string;
  typeName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TimePeriod {
  id: string;
  warehouseId: string;
  tenantId: string;
  timePeriod: string;
  startDate: Date | null;
  endDate: Date | null;
  periodicity: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Area {
  id: string;
  warehouseId: string;
  tenantId: string;
  name: string;
  areaId: string;
  gid: string;
  parentId: string | null;
  level: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface DataRecord {
  id: string;
  warehouseId: string;
  tenantId: string;
  indicatorId: string;
  unitId: string;
  subgroupId: string;
  areaId: string;
  timePeriodId: string;
  dataValue: number | null;
  textualDataValue: string | null;
  source: string | null;
  footnote: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Import Result ────────────────────────────────────────────────────────────

export interface ImportResult {
  totalRows: number;
  successCount: number;
  errorCount: number;
  duplicateCount: number;
  errors: ImportRowError[];
}

export interface ImportRowError {
  row: number;
  field: string | null;
  message: string;
}
