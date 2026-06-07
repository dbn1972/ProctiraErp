/**
 * Connector Factory
 *
 * Creates source and destination connectors based on configuration type.
 */
import type { DataSourceConfig, DataDestinationConfig } from '../schemas.js';
import type { SourceConnector, DestinationConnector } from './types.js';
import { PostgresSourceConnector } from './postgresql-source.js';
import { RestApiSourceConnector } from './rest-api-source.js';
import { CsvSourceConnector } from './csv-source.js';
import { ExcelSourceConnector } from './excel-source.js';
import { PostgresDestinationConnector } from './postgresql-destination.js';
import { RestApiDestinationConnector } from './rest-api-destination.js';

/**
 * Create a source connector based on the configuration type.
 */
export function createSourceConnector(config: DataSourceConfig): SourceConnector {
  switch (config.type) {
    case 'postgresql':
      return new PostgresSourceConnector(config);
    case 'rest_api':
      return new RestApiSourceConnector(config);
    case 'csv':
      return new CsvSourceConnector(config);
    case 'excel':
      return new ExcelSourceConnector(config);
    default: {
      const _exhaustive: never = config;
      throw new Error(`Unsupported source type: ${(config as { type: string }).type}`);
    }
  }
}

/**
 * Create a destination connector based on the configuration type.
 */
export function createDestinationConnector(config: DataDestinationConfig): DestinationConnector {
  switch (config.type) {
    case 'postgresql':
      return new PostgresDestinationConnector(config);
    case 'rest_api':
      return new RestApiDestinationConnector(config);
    default: {
      const _exhaustive: never = config;
      throw new Error(`Unsupported destination type: ${(config as { type: string }).type}`);
    }
  }
}
