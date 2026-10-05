/**
 * PostgreSQL Destination Connector — NOT IMPLEMENTED (PRC-M222).
 *
 * The previous stub reported every row as loaded without writing anything.
 * Until a real, tenant-bound, transactional implementation exists (and the
 * owner decides which external databases a tenant may write to), this
 * connector fails closed: the factory refuses it (501) and, if constructed
 * directly, `validate()` is invalid and `load()` throws.
 */
import type { PostgresDestinationConfig } from '../schemas.js';

import {
  ConnectorNotImplementedError,
  type DestinationConnector,
  type DataRow,
  type LoadResult,
} from './types.js';

export class PostgresDestinationConnector implements DestinationConnector {
  constructor(private readonly config: PostgresDestinationConfig) {}

  async load(_rows: DataRow[]): Promise<LoadResult> {
    throw new ConnectorNotImplementedError('postgresql destination');
  }

  async validate(): Promise<{ valid: boolean; error?: string }> {
    void this.config;
    return { valid: false, error: 'The postgresql destination connector is not implemented yet' };
  }
}
