/**
 * @proctira/backend-data-warehouse - Statistical Data Warehouse Service
 *
 * Provides DevInfo/DI7 compatible data warehouse management with
 * indicators, units, subgroups, time periods, areas, and data records.
 * Supports data import from Excel (DES format), CSV, and database connections
 * with IUS uniqueness and referential integrity validation.
 *
 * Additional capabilities:
 * - GIS layer management with PostGIS (Shapefile and GeoJSON support) [Req 15.3]
 * - Data publishing to mobile apps, web portals, and API endpoints [Req 15.4]
 * - Multi-language metadata with translation import/export [Req 15.5]
 */

// Plugin
export { dataWarehousePlugin, type DataWarehousePluginOptions } from './data-warehouse-plugin.js';

// Service
export { DataWarehouseService, type DataWarehouseServiceConfig } from './data-warehouse-service.js';

// Repository
export type { WarehouseRepository, ListFilter, ListResult } from './warehouse-repository.js';
export { InMemoryWarehouseRepository } from './in-memory-repository.js';

// Import utilities
export {
  importDataRecords,
  parseCsvContent,
  parseExcelDesContent,
  type ImportContext,
} from './import-service.js';

// GIS Service (Requirement 15.3)
export { GISService, type GISServiceConfig } from './gis-service.js';
export type { GISRepository, GISLayerListOptions, GISListResult } from './gis-repository.js';
export { InMemoryGISRepository } from './in-memory-gis-repository.js';
export {
  CreateGISLayerSchema,
  UpdateGISLayerSchema,
  GISLayerListQuerySchema,
  GISLayerParamsSchema,
  GISLayerTypeSchema,
  type GISLayerInput,
  type UpdateGISLayerInput,
  type GISLayerListQuery,
  type GISLayerParams,
  type GISLayerType,
  type GISLayer,
  type GISFeature,
} from './gis-schemas.js';

// Publishing Service (Requirement 15.4)
export { PublishingService, type PublishingServiceConfig } from './publishing-service.js';
export {
  PublishTargetSchema,
  PublishRequestSchema,
  PublishHistoryQuerySchema,
  type PublishTarget,
  type PublishRequestInput,
  type PublishResult,
  type PublishRecord,
  type PublishedPayload,
  type PublishedDataRecord,
  type PublishedGISLayer,
  type PublishedMetadata,
  type PublishHistoryQuery,
} from './publishing-schemas.js';

// Translation Service (Requirement 15.5)
export { TranslationService, type TranslationServiceConfig } from './translation-service.js';
export type {
  TranslationRepository,
  TranslationListOptions,
  TranslationListResult,
} from './translation-repository.js';
export { InMemoryTranslationRepository } from './in-memory-translation-repository.js';
export {
  CreateTranslationSchema,
  BatchTranslationSchema,
  TranslationExportQuerySchema,
  TranslationImportSchema,
  TranslationListQuerySchema,
  TranslatableEntityTypeSchema,
  type Translation,
  type TranslatableEntityType,
  type CreateTranslationInput,
  type BatchTranslationInput,
  type TranslationExportQuery,
  type TranslationImportInput,
  type TranslationImportResult,
  type TranslationExportResult,
  type TranslationListQuery,
} from './translation-schemas.js';

// Schemas
export {
  CreateWarehouseSchema,
  UpdateWarehouseSchema,
  CreateIndicatorSchema,
  UpdateIndicatorSchema,
  CreateUnitSchema,
  UpdateUnitSchema,
  CreateSubgroupSchema,
  UpdateSubgroupSchema,
  CreateTimePeriodSchema,
  UpdateTimePeriodSchema,
  CreateAreaSchema,
  UpdateAreaSchema,
  BulkImportSchema,
  DataQuerySchema,
  DataRecordSchema,
  ImportFormatSchema,
  WarehouseParamsSchema,
  EntityParamsSchema,
  WarehouseListQuerySchema,
  type CreateWarehouseInput,
  type UpdateWarehouseInput,
  type CreateIndicatorInput,
  type UpdateIndicatorInput,
  type CreateUnitInput,
  type UpdateUnitInput,
  type CreateSubgroupInput,
  type UpdateSubgroupInput,
  type CreateTimePeriodInput,
  type UpdateTimePeriodInput,
  type CreateAreaInput,
  type UpdateAreaInput,
  type BulkImportInput,
  type DataQueryInput,
  type DataRecordInput,
  type ImportFormat,
  type WarehouseParams,
  type EntityParams,
  type WarehouseListQuery,
  type Warehouse,
  type Indicator,
  type Unit,
  type Subgroup,
  type TimePeriod,
  type Area,
  type DataRecord,
  type ImportResult,
  type ImportRowError,
} from './schemas.js';
