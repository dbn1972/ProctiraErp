/**
 * REST API Destination Connector
 *
 * Loads data into a REST API endpoint with support for
 * batching and authentication.
 */
import { lookup } from 'node:dns/promises';

import type { RestApiDestinationConfig } from '../schemas.js';

import { assertPublicHttpsUrl, safeFetch } from './safe-fetch.js';
import type {
  DestinationConnector,
  DataRow,
  LoadContext,
  LoadResult,
  LoadError,
} from './types.js';

/** PRC-M224: cap on remote error text kept per failed batch. */
const REMOTE_ERROR_BODY_MAX = 200;

export class RestApiDestinationConnector implements DestinationConnector {
  constructor(private readonly config: RestApiDestinationConfig) {}

  async load(rows: DataRow[], context: LoadContext = {}): Promise<LoadResult> {
    if (rows.length === 0) {
      return { loadedCount: 0, errorCount: 0, errors: [] };
    }

    const batchSize = this.config.batchSize ?? 100;
    const batches = this.chunk(rows, batchSize);
    let loadedCount = 0;
    const errors: LoadError[] = [];

    for (const [batchIndex, batch] of batches.entries()) {
      try {
        // PRC-M225: stable per (run, batch) so a retried run does not double-post.
        const idempotencyKey = context.idempotencyKey
          ? `${context.idempotencyKey}:${batchIndex}`
          : undefined;
        const response = await this.sendBatch(batch, idempotencyKey);
        if (response.ok) {
          loadedCount += batch.length;
        } else {
          // PRC-M224: remote bodies can echo the payload; keep a short prefix only.
          const errorText = (await response.text()).slice(0, REMOTE_ERROR_BODY_MAX);
          for (let i = 0; i < batch.length; i++) {
            errors.push({
              row: loadedCount + i,
              message: `API error: ${response.status} - ${errorText}`,
              data: null,
            });
          }
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        for (let i = 0; i < batch.length; i++) {
          errors.push({
            row: loadedCount + i,
            message,
            data: null,
          });
        }
      }
    }

    return {
      loadedCount,
      errorCount: errors.length,
      errors,
    };
  }

  async validate(): Promise<{ valid: boolean; error?: string }> {
    if (!this.config.url) {
      return { valid: false, error: 'URL is required' };
    }
    // PRC-C003: reject non-public / non-https targets at validate time too.
    try {
      await assertPublicHttpsUrl(this.config.url, (host) => lookup(host, { all: true }));
    } catch (error) {
      return { valid: false, error: error instanceof Error ? error.message : 'Invalid URL' };
    }
    return { valid: true };
  }

  private async sendBatch(batch: DataRow[], idempotencyKey?: string): Promise<Response> {
    const headers = this.buildHeaders();
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const method = this.config.method ?? 'POST';

    // PRC-C003: SSRF-guarded — a tenant-authored destination URL can no longer exfiltrate to
    // loopback/metadata/internal targets from the shared process.
    return safeFetch(this.config.url, {
      method,
      headers,
      body: JSON.stringify(batch),
    });
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.headers,
    };

    if (this.config.authType === 'bearer' && this.config.authConfig?.token) {
      headers['Authorization'] = `Bearer ${this.config.authConfig.token}`;
    } else if (this.config.authType === 'basic' && this.config.authConfig) {
      const username = this.config.authConfig['username'] ?? '';
      const password = this.config.authConfig['password'] ?? '';
      const encoded = Buffer.from(`${username}:${password}`).toString('base64');
      headers['Authorization'] = `Basic ${encoded}`;
    } else if (this.config.authType === 'api_key' && this.config.authConfig) {
      const { headerName, apiKey } = this.config.authConfig;
      if (headerName && apiKey) {
        headers[headerName] = apiKey;
      }
    }

    return headers;
  }

  private chunk(array: DataRow[], size: number): DataRow[][] {
    const chunks: DataRow[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
