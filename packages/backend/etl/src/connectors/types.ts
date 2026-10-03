/**
 * Connector Types
 *
 * Shared interfaces for source and destination connectors.
 */

import { AppError } from '@proctira/common';

/**
 * PRC-M222: connector types that are declared in the schema but have no real
 * implementation yet. They fail closed (HTTP 501 / failed run) instead of
 * reporting a successful extract/load that never touched any data.
 */
export class ConnectorNotImplementedError extends AppError {
  constructor(kind: string) {
    super(
      `The ${kind} connector is not implemented yet; choose a supported connector type`,
      'CONNECTOR_NOT_IMPLEMENTED',
      501,
    );
  }
}

/**
 * A row of extracted data represented as key-value pairs.
 */
export type DataRow = Record<string, unknown>;

/**
 * Result of an extraction operation.
 */
export interface ExtractionResult {
  rows: DataRow[];
  totalCount: number;
}

/**
 * Result of a load operation.
 */
export interface LoadResult {
  loadedCount: number;
  errorCount: number;
  errors: LoadError[];
}

export interface LoadError {
  row: number;
  message: string;
  data: DataRow | null;
}

/**
 * Source connector interface - extracts data from a source.
 */
export interface SourceConnector {
  /**
   * Extract data from the configured source.
   */
  extract(): Promise<ExtractionResult>;

  /**
   * Validate the source configuration (e.g., test connection).
   */
  validate(): Promise<{ valid: boolean; error?: string }>;
}

/**
 * PRC-M225: per-run load context. `idempotencyKey` is stable across retry
 * attempts of one run, so destinations can de-duplicate re-sent batches.
 */
export interface LoadContext {
  idempotencyKey?: string;
}

/**
 * Destination connector interface - loads data into a destination.
 */
export interface DestinationConnector {
  /**
   * Load rows into the configured destination.
   */
  load(rows: DataRow[], context?: LoadContext): Promise<LoadResult>;

  /**
   * Validate the destination configuration (e.g., test connection).
   */
  validate(): Promise<{ valid: boolean; error?: string }>;
}
