/**
 * ETL Schemas
 *
 * Typebox schemas for pipeline definition, field mapping,
 * source/destination configuration, and API request/response shapes.
 */
import { Type, type Static } from '@sinclair/typebox';

/** UUID v4 pattern for validation */
const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
const UuidString = () => Type.String({ pattern: UUID_PATTERN, description: 'UUID v4 identifier' });

// ─── Source Type Schemas ──────────────────────────────────────────────────────

export const SourceTypeSchema = Type.Union([
  Type.Literal('postgresql'),
  Type.Literal('rest_api'),
  Type.Literal('csv'),
  Type.Literal('excel'),
]);

export type SourceType = Static<typeof SourceTypeSchema>;

/**
 * PostgreSQL source connection configuration.
 */
export const PostgresSourceConfigSchema = Type.Object({
  type: Type.Literal('postgresql'),
  host: Type.String({ minLength: 1 }),
  port: Type.Number({ minimum: 1, maximum: 65535, default: 5432 }),
  database: Type.String({ minLength: 1 }),
  username: Type.String({ minLength: 1 }),
  password: Type.String({ minLength: 1 }),
  schema: Type.Optional(Type.String({ default: 'public' })),
  query: Type.String({ minLength: 1, description: 'SQL query to extract data' }),
});

export type PostgresSourceConfig = Static<typeof PostgresSourceConfigSchema>;

/**
 * REST API source connection configuration.
 */
export const RestApiSourceConfigSchema = Type.Object({
  type: Type.Literal('rest_api'),
  url: Type.String({ minLength: 1, description: 'API endpoint URL' }),
  method: Type.Optional(Type.Union([
    Type.Literal('GET'),
    Type.Literal('POST'),
  ], { default: 'GET' })),
  headers: Type.Optional(Type.Record(Type.String(), Type.String())),
  body: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  authType: Type.Optional(Type.Union([
    Type.Literal('none'),
    Type.Literal('bearer'),
    Type.Literal('basic'),
    Type.Literal('api_key'),
  ])),
  authConfig: Type.Optional(Type.Record(Type.String(), Type.String())),
  paginationType: Type.Optional(Type.Union([
    Type.Literal('none'),
    Type.Literal('offset'),
    Type.Literal('cursor'),
    Type.Literal('page'),
  ])),
  paginationConfig: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  dataPath: Type.Optional(Type.String({ description: 'JSON path to data array in response' })),
});

export type RestApiSourceConfig = Static<typeof RestApiSourceConfigSchema>;

/**
 * CSV file source configuration.
 */
export const CsvSourceConfigSchema = Type.Object({
  type: Type.Literal('csv'),
  filePath: Type.Optional(Type.String({ description: 'Path to CSV file' })),
  fileContent: Type.Optional(Type.String({ description: 'Inline CSV content' })),
  delimiter: Type.Optional(Type.String({ default: ',', maxLength: 1 })),
  hasHeader: Type.Optional(Type.Boolean({ default: true })),
  encoding: Type.Optional(Type.String({ default: 'utf-8' })),
});

export type CsvSourceConfig = Static<typeof CsvSourceConfigSchema>;

/**
 * Excel file source configuration.
 */
export const ExcelSourceConfigSchema = Type.Object({
  type: Type.Literal('excel'),
  filePath: Type.Optional(Type.String({ description: 'Path to Excel file' })),
  fileContent: Type.Optional(Type.String({ description: 'Base64-encoded Excel content' })),
  sheetName: Type.Optional(Type.String({ description: 'Sheet name to read' })),
  sheetIndex: Type.Optional(Type.Number({ minimum: 0, description: 'Sheet index (0-based)' })),
  hasHeader: Type.Optional(Type.Boolean({ default: true })),
  startRow: Type.Optional(Type.Number({ minimum: 0, default: 0 })),
});

export type ExcelSourceConfig = Static<typeof ExcelSourceConfigSchema>;

/**
 * Union of all source configurations.
 */
export const DataSourceConfigSchema = Type.Union([
  PostgresSourceConfigSchema,
  RestApiSourceConfigSchema,
  CsvSourceConfigSchema,
  ExcelSourceConfigSchema,
]);

export type DataSourceConfig = Static<typeof DataSourceConfigSchema>;

// ─── Destination Type Schemas ─────────────────────────────────────────────────

export const DestinationTypeSchema = Type.Union([
  Type.Literal('postgresql'),
  Type.Literal('rest_api'),
]);

export type DestinationType = Static<typeof DestinationTypeSchema>;

/**
 * PostgreSQL destination configuration.
 */
export const PostgresDestinationConfigSchema = Type.Object({
  type: Type.Literal('postgresql'),
  host: Type.String({ minLength: 1 }),
  port: Type.Number({ minimum: 1, maximum: 65535, default: 5432 }),
  database: Type.String({ minLength: 1 }),
  username: Type.String({ minLength: 1 }),
  password: Type.String({ minLength: 1 }),
  schema: Type.Optional(Type.String({ default: 'public' })),
  table: Type.String({ minLength: 1, description: 'Target table name' }),
  writeMode: Type.Optional(Type.Union([
    Type.Literal('insert'),
    Type.Literal('upsert'),
    Type.Literal('replace'),
  ], { default: 'insert' })),
  upsertKey: Type.Optional(Type.Array(Type.String(), { description: 'Columns for upsert conflict resolution' })),
});

export type PostgresDestinationConfig = Static<typeof PostgresDestinationConfigSchema>;

/**
 * REST API destination configuration.
 */
export const RestApiDestinationConfigSchema = Type.Object({
  type: Type.Literal('rest_api'),
  url: Type.String({ minLength: 1, description: 'API endpoint URL' }),
  method: Type.Optional(Type.Union([
    Type.Literal('POST'),
    Type.Literal('PUT'),
    Type.Literal('PATCH'),
  ], { default: 'POST' })),
  headers: Type.Optional(Type.Record(Type.String(), Type.String())),
  authType: Type.Optional(Type.Union([
    Type.Literal('none'),
    Type.Literal('bearer'),
    Type.Literal('basic'),
    Type.Literal('api_key'),
  ])),
  authConfig: Type.Optional(Type.Record(Type.String(), Type.String())),
  batchSize: Type.Optional(Type.Number({ minimum: 1, maximum: 1000, default: 100 })),
});

export type RestApiDestinationConfig = Static<typeof RestApiDestinationConfigSchema>;

/**
 * Union of all destination configurations.
 */
export const DataDestinationConfigSchema = Type.Union([
  PostgresDestinationConfigSchema,
  RestApiDestinationConfigSchema,
]);

export type DataDestinationConfig = Static<typeof DataDestinationConfigSchema>;

// ─── Transformation Schemas ───────────────────────────────────────────────────

export const TransformationTypeSchema = Type.Union([
  Type.Literal('type_cast'),
  Type.Literal('lookup'),
  Type.Literal('concatenate'),
  Type.Literal('format'),
  Type.Literal('custom'),
]);

export type TransformationType = Static<typeof TransformationTypeSchema>;

/**
 * Type cast transformation config.
 */
export const TypeCastConfigSchema = Type.Object({
  targetType: Type.Union([
    Type.Literal('string'),
    Type.Literal('number'),
    Type.Literal('boolean'),
    Type.Literal('date'),
    Type.Literal('integer'),
  ]),
  format: Type.Optional(Type.String({ description: 'Date format or number format pattern' })),
});

export type TypeCastConfig = Static<typeof TypeCastConfigSchema>;

/**
 * Lookup transformation config.
 */
export const LookupConfigSchema = Type.Object({
  lookupTable: Type.Record(Type.String(), Type.Unknown(), {
    description: 'Key-value mapping for lookup replacement',
  }),
  defaultValue: Type.Optional(Type.Unknown({ description: 'Default value if lookup key not found' })),
});

export type LookupConfig = Static<typeof LookupConfigSchema>;

/**
 * Concatenate transformation config.
 */
export const ConcatenateConfigSchema = Type.Object({
  fields: Type.Array(Type.String(), { minItems: 2, description: 'Source fields to concatenate' }),
  separator: Type.Optional(Type.String({ default: '' })),
});

export type ConcatenateConfig = Static<typeof ConcatenateConfigSchema>;

/**
 * Format transformation config.
 */
export const FormatConfigSchema = Type.Object({
  template: Type.String({ minLength: 1, description: 'Template string with {field} placeholders' }),
});

export type FormatConfig = Static<typeof FormatConfigSchema>;

/**
 * Custom transformation config.
 */
export const CustomTransformConfigSchema = Type.Object({
  expression: Type.String({ minLength: 1, description: 'Custom transformation expression' }),
});

export type CustomTransformConfig = Static<typeof CustomTransformConfigSchema>;

// ─── Field Mapping Schema ─────────────────────────────────────────────────────

/**
 * Field mapping with optional transformation.
 */
export const FieldMappingSchema = Type.Object({
  sourceField: Type.String({ minLength: 1 }),
  destinationField: Type.String({ minLength: 1 }),
  transformation: Type.Optional(TransformationTypeSchema),
  transformConfig: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export type FieldMapping = Static<typeof FieldMappingSchema>;

// ─── Retry Policy Schema ──────────────────────────────────────────────────────

export const RetryPolicySchema = Type.Object({
  maxRetries: Type.Number({ minimum: 0, maximum: 10, default: 3 }),
  backoffMs: Type.Number({ minimum: 100, maximum: 300000, default: 1000 }),
});

export type RetryPolicy = Static<typeof RetryPolicySchema>;

// ─── Pipeline Definition Schema ───────────────────────────────────────────────

/**
 * Create pipeline request body.
 */
export const CreatePipelineSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255 }),
  description: Type.Optional(Type.String({ maxLength: 1000 })),
  source: DataSourceConfigSchema,
  destination: DataDestinationConfigSchema,
  fieldMappings: Type.Array(FieldMappingSchema, { minItems: 1 }),
  schedule: Type.Optional(Type.String({ description: 'Cron expression for scheduled execution' })),
  retryPolicy: Type.Optional(RetryPolicySchema),
  enabled: Type.Optional(Type.Boolean({ default: true })),
});

export type CreatePipelineInput = Static<typeof CreatePipelineSchema>;

/**
 * Update pipeline request body.
 */
export const UpdatePipelineSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  description: Type.Optional(Type.String({ maxLength: 1000 })),
  source: Type.Optional(DataSourceConfigSchema),
  destination: Type.Optional(DataDestinationConfigSchema),
  fieldMappings: Type.Optional(Type.Array(FieldMappingSchema, { minItems: 1 })),
  schedule: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  retryPolicy: Type.Optional(RetryPolicySchema),
  enabled: Type.Optional(Type.Boolean()),
});

export type UpdatePipelineInput = Static<typeof UpdatePipelineSchema>;

// ─── Route Params & Query Schemas ─────────────────────────────────────────────

export const PipelineParamsSchema = Type.Object({
  pipelineId: UuidString(),
});

export type PipelineParams = Static<typeof PipelineParamsSchema>;

export const PipelineListQuerySchema = Type.Object({
  page: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20 })),
  search: Type.Optional(Type.String()),
  enabled: Type.Optional(Type.Boolean()),
});

export type PipelineListQuery = Static<typeof PipelineListQuerySchema>;

// ─── Pipeline Entity ──────────────────────────────────────────────────────────

export interface Pipeline {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  source: DataSourceConfig;
  destination: DataDestinationConfig;
  fieldMappings: FieldMapping[];
  schedule: string | null;
  retryPolicy: RetryPolicy;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Execution Log Entity ─────────────────────────────────────────────────────

export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface PipelineExecution {
  id: string;
  pipelineId: string;
  tenantId: string;
  status: ExecutionStatus;
  startedAt: Date;
  completedAt: Date | null;
  extractedCount: number;
  transformedCount: number;
  loadedCount: number;
  errorCount: number;
  errors: ExecutionError[];
}

export interface ExecutionError {
  row: number;
  field: string | null;
  message: string;
  data: Record<string, unknown> | null;
}
