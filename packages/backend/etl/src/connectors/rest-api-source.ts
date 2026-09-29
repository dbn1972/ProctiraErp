/**
 * REST API Source Connector
 *
 * Extracts data from a REST API endpoint with support for
 * authentication and pagination.
 */
import { lookup } from 'node:dns/promises';

import type { RestApiSourceConfig } from '../schemas.js';

import { assertPublicHttpsUrl, safeFetch } from './safe-fetch.js';
import type { SourceConnector, ExtractionResult, DataRow } from './types.js';

export class RestApiSourceConnector implements SourceConnector {
  constructor(private readonly config: RestApiSourceConfig) {}

  async extract(): Promise<ExtractionResult> {
    const headers = this.buildHeaders();
    const method = this.config.method ?? 'GET';

    // PRC-C003: SSRF-guarded fetch — https only, DNS-pinned public target, manual redirects,
    // timeout, size cap. A tenant-authored URL can no longer reach loopback/metadata/internal.
    const response = await safeFetch(this.config.url, {
      method,
      headers,
      body: method === 'POST' && this.config.body ? JSON.stringify(this.config.body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`REST API extraction failed: ${response.status} ${response.statusText}`);
    }

    const json = await response.json();
    const rows = this.extractRows(json);

    return {
      rows,
      totalCount: rows.length,
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

  private extractRows(json: unknown): DataRow[] {
    if (this.config.dataPath) {
      const parts = this.config.dataPath.split('.');
      let current: unknown = json;
      for (const part of parts) {
        if (current && typeof current === 'object' && part in current) {
          current = (current as Record<string, unknown>)[part];
        } else {
          return [];
        }
      }
      if (Array.isArray(current)) {
        return current as DataRow[];
      }
      return [];
    }

    if (Array.isArray(json)) {
      return json as DataRow[];
    }

    return [];
  }
}
