/**
 * Connector Factory
 *
 * Creates source and destination connectors based on configuration type.
 */
import type { DataSourceConfig, DataDestinationConfig } from '../schemas.js';

import { resolveDestinationConnection } from './connection-registry.js';
import { CsvSourceConnector } from './csv-source.js';
import { RestApiDestinationConnector } from './rest-api-destination.js';
import { RestApiSourceConnector } from './rest-api-source.js';
import {
  ConnectorNotImplementedError,
  type SourceConnector,
  type DestinationConnector,
} from './types.js';

/** PRC-M222: injectable connector construction (tests supply in-memory fakes). */
export interface ConnectorFactory {
  createSource(config: DataSourceConfig): SourceConnector;
  createDestination(config: DataDestinationConfig): DestinationConnector;
}

/**
 * Create a source connector based on the configuration type.
 */
export function createSourceConnector(config: DataSourceConfig): SourceConnector {
  switch (config.type) {
    case 'postgresql':
      // PRC-M222: stub removed from the runtime path — fail closed (501).
      throw new ConnectorNotImplementedError('postgresql source');
    case 'rest_api':
      return new RestApiSourceConnector(config);
    case 'csv':
      return new CsvSourceConnector(config);
    case 'excel':
      throw new ConnectorNotImplementedError('excel source');
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
      throw new ConnectorNotImplementedError('postgresql destination');
    case 'rest_api':
      return new RestApiDestinationConnector(config);
    case 'connection': {
      // PRC-M109: resolve the server-managed connection; unknown ids fail closed.
      const resolved = resolveDestinationConnection(config);
      if (!resolved) {
        const error = `Unknown destination connection: ${config.connectionId}`;
        return {
          validate: async () => ({ valid: false, error }),
          load: async () => {
            throw new Error(error);
          },
        };
      }
      // Known ids delegate to the concrete destination type, so they inherit its
      // runtime status (PRC-M222: postgresql destination currently fails closed, 501).
      return createDestinationConnector(resolved);
    }
    default: {
      const _exhaustive: never = config;
      throw new Error(`Unsupported destination type: ${(config as { type: string }).type}`);
    }
  }
}

/** Default production factory. */
export const defaultConnectorFactory: ConnectorFactory = {
  createSource: createSourceConnector,
  createDestination: createDestinationConnector,
};
