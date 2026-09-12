/**
 * Thin ETL run lineage (P2-WH).
 *
 * Breadcrumb only — not a governed warehouse catalog or column/graph lineage.
 * See docs/audits/PRODUCT_WAREHOUSE_ETL_LINEAGE.md (PRD-018).
 */
import type {
  DataDestinationConfig,
  DataSourceConfig,
  ExecutionLineage,
  Pipeline,
} from './schemas.js';

const LABEL_MAX = 120;

function truncate(value: string, max = LABEL_MAX): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function sourceLabel(source: DataSourceConfig): string {
  switch (source.type) {
    case 'csv':
      return truncate(source.filePath ?? 'inline-csv');
    case 'excel':
      return truncate(source.filePath ?? source.sheetName ?? 'inline-excel');
    case 'postgresql':
      return truncate(`${source.database}:${source.query}`);
    case 'rest_api':
      return truncate(source.url);
    default:
      return 'unknown-source';
  }
}

function destinationLabel(destination: DataDestinationConfig): string {
  switch (destination.type) {
    case 'postgresql':
      return truncate(
        destination.schema ? `${destination.schema}.${destination.table}` : destination.table,
      );
    case 'rest_api':
      return truncate(destination.url);
    default:
      return 'unknown-destination';
  }
}

/**
 * Build thin lineage metadata for a pipeline execution.
 */
export function buildExecutionLineage(pipeline: Pipeline): ExecutionLineage {
  return {
    sourceType: pipeline.source.type,
    destinationType: pipeline.destination.type,
    sourceLabel: sourceLabel(pipeline.source),
    destinationLabel: destinationLabel(pipeline.destination),
    fieldMappingCount: pipeline.fieldMappings.length,
  };
}
