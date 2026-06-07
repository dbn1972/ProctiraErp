/**
 * REST API Destination Connector
 *
 * Loads data into a REST API endpoint with support for
 * batching and authentication.
 */
import type { RestApiDestinationConfig } from '../schemas.js';
import type { DestinationConnector, DataRow, LoadResult, LoadError } from './types.js';

export class RestApiDestinationConnector implements DestinationConnector {
  constructor(private readonly config: RestApiDestinationConfig) {}

  async load(rows: DataRow[]): Promise<LoadResult> {
    if (rows.length === 0) {
      return { loadedCount: 0, errorCount: 0, errors: [] };
    }

    const batchSize = this.config.batchSize ?? 100;
    const batches = this.chunk(rows, batchSize);
    let loadedCount = 0;
    const errors: LoadError[] = [];

    for (const batch of batches) {
      try {
        const response = await this.sendBatch(batch);
        if (response.ok) {
          loadedCount += batch.length;
        } else {
          const errorText = await response.text();
          for (let i = 0; i < batch.length; i++) {
            errors.push({
              row: loadedCount + i,
              message: `API error: ${response.status} - ${errorText}`,
              data: batch[i] ?? null,
            });
          }
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        for (let i = 0; i < batch.length; i++) {
          errors.push({
            row: loadedCount + i,
            message,
            data: batch[i] ?? null,
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
    try {
      new URL(this.config.url);
    } catch {
      return { valid: false, error: 'Invalid URL format' };
    }
    return { valid: true };
  }

  private async sendBatch(batch: DataRow[]): Promise<Response> {
    const headers = this.buildHeaders();
    const method = this.config.method ?? 'POST';

    return fetch(this.config.url, {
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
      const { username, password } = this.config.authConfig;
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
