/**
 * PostgreSQL Source Connector — NOT IMPLEMENTED (PRC-M222).
 *
 * The previous stub returned zero rows as a "successful" extraction. Until a
 * real read-only, parameterised implementation exists (and the owner decides
 * which external databases a tenant may read), it fails closed: the factory
 * refuses it (501) and, if constructed directly, `validate()` is invalid and
 * `extract()` throws.
 */
import type { PostgresSourceConfig } from '../schemas.js';
import {
  ConnectorNotImplementedError,
  type SourceConnector,
  type ExtractionResult,
} from './types.js';

export class PostgresSourceConnector implements SourceConnector {
  constructor(private readonly config: PostgresSourceConfig) {}

  async extract(): Promise<ExtractionResult> {
    throw new ConnectorNotImplementedError('postgresql source');
  }

  async validate(): Promise<{ valid: boolean; error?: string }> {
    void this.config;
    return { valid: false, error: 'The postgresql source connector is not implemented yet' };
  }
}
