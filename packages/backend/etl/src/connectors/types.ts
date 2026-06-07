/**
 * Connector Types
 *
 * Shared interfaces for source and destination connectors.
 */

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
 * Destination connector interface - loads data into a destination.
 */
export interface DestinationConnector {
  /**
   * Load rows into the configured destination.
   */
  load(rows: DataRow[]): Promise<LoadResult>;

  /**
   * Validate the destination configuration (e.g., test connection).
   */
  validate(): Promise<{ valid: boolean; error?: string }>;
}
