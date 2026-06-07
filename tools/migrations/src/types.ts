/**
 * Shared type definitions for the migration pipeline.
 */

/** Configuration for connecting to the legacy MySQL database. */
export interface MySQLConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

/** Configuration for connecting to the target PostgreSQL database. */
export interface PostgreSQLConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  schema: string;
}

/** Full migration configuration. */
export interface MigrationConfig {
  mysql: MySQLConfig;
  pg: PostgreSQLConfig;
  batchSize: number;
  defaultTenantName: string;
  defaultTenantSlug: string;
  stagingSchema: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  pgloaderBin: string;
}

/** Mapping from a legacy table/column to the new schema. */
export interface TableMapping {
  /** Legacy MySQL table name. */
  sourceTable: string;
  /** Target PostgreSQL table name. */
  targetTable: string;
  /** Column mappings: legacy column name → new column name. */
  columns: ColumnMapping[];
  /** Optional filter to select a subset of rows (e.g., user type). */
  sourceFilter?: string;
  /** Whether this table has an integer PK that needs UUID generation. */
  requiresUuidGeneration: boolean;
  /** The legacy primary key column name. */
  legacyPkColumn: string;
  /** Foreign key relationships to remap. */
  foreignKeys: ForeignKeyMapping[];
}

/** Column mapping between legacy and new schema. */
export interface ColumnMapping {
  source: string;
  target: string;
  /** Transformation to apply during migration. */
  transform?: ColumnTransform;
}

/** Supported column transformations. */
export type ColumnTransform =
  | { type: 'rename' }
  | { type: 'cast'; targetType: string }
  | { type: 'default'; value: string }
  | { type: 'map_enum'; mapping: Record<string, string> }
  | { type: 'json_wrap' }
  | { type: 'concat'; separator: string; sources: string[] }
  | { type: 'coalesce'; fallback: string };

/** Foreign key relationship mapping. */
export interface ForeignKeyMapping {
  /** Column in this table holding the FK. */
  column: string;
  /** The legacy table this FK references. */
  referencesTable: string;
  /** The legacy column in the referenced table. */
  referencesColumn: string;
  /** The new target table after migration. */
  targetReferencesTable: string;
}

/** UUID mapping entry: legacy integer ID → new UUID. */
export interface UuidMapping {
  legacyTable: string;
  legacyId: number;
  newUuid: string;
}

/** Result of a migration step. */
export interface MigrationStepResult {
  step: string;
  status: 'success' | 'warning' | 'error';
  tablesProcessed: number;
  rowsProcessed: number;
  errors: MigrationError[];
  warnings: MigrationWarning[];
  durationMs: number;
}

/** Migration error detail. */
export interface MigrationError {
  table: string;
  row?: number;
  column?: string;
  message: string;
  legacyId?: number;
}

/** Migration warning detail. */
export interface MigrationWarning {
  table: string;
  message: string;
  count?: number;
}

/** Validation report produced after migration. */
export interface ValidationReport {
  timestamp: string;
  tables: TableValidation[];
  overallStatus: 'pass' | 'fail' | 'warning';
  totalSourceRows: number;
  totalTargetRows: number;
  integrityErrors: IntegrityError[];
}

/** Per-table validation result. */
export interface TableValidation {
  sourceTable: string;
  targetTable: string;
  sourceRowCount: number;
  targetRowCount: number;
  status: 'match' | 'mismatch' | 'skipped';
  missingRows: number;
  extraRows: number;
}

/** Referential integrity violation. */
export interface IntegrityError {
  table: string;
  column: string;
  referencedTable: string;
  orphanedCount: number;
  sampleIds: string[];
}
