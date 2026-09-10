/**
 * Connectors Module
 *
 * Re-exports all connector types and factory functions.
 */
export type {
  SourceConnector,
  DestinationConnector,
  DataRow,
  ExtractionResult,
  LoadResult,
  LoadError,
} from './types.js';
export { createSourceConnector, createDestinationConnector } from './connector-factory.js';
export { PostgresSourceConnector } from './postgresql-source.js';
export { RestApiSourceConnector } from './rest-api-source.js';
export { CsvSourceConnector } from './csv-source.js';
export { ExcelSourceConnector } from './excel-source.js';
export { PostgresDestinationConnector } from './postgresql-destination.js';
export { RestApiDestinationConnector } from './rest-api-destination.js';
