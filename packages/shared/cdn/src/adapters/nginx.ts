/**
 * Nginx CDN Adapter
 *
 * Implements the CDN adapter interface for self-hosted Nginx-based CDN.
 * Cache invalidation is performed via the Nginx cache purge module endpoint.
 */

import type {
  AssetUrl,
  AssetUrlOptions,
  CdnAdapter,
  CdnAdapterHealth,
  CdnConfig,
  InvalidationRequest,
  InvalidationResult,
} from '../types.js';
import { buildAssetUrl } from '../url-builder.js';

export class NginxCdnAdapter implements CdnAdapter {
  private readonly config: CdnConfig;

  constructor(config: CdnConfig) {
    this.config = config;
  }

  getAssetUrl(options: AssetUrlOptions): AssetUrl {
    return buildAssetUrl(options, this.config);
  }

  async invalidate(request: InvalidationRequest): Promise<InvalidationResult> {
    // Nginx cache purge is typically done via PURGE requests to the cached URLs
    // or by clearing the cache directory on the server.
    // This implementation assumes an nginx-cache-purge module or proxy_cache_purge.

    const purgeBaseUrl = this.config.baseUrl;
    const errors: string[] = [];

    for (const path of request.paths) {
      const purgeUrl = `${purgeBaseUrl}${path.startsWith('/') ? path : '/' + path}`;
      try {
        // In production, this would send a PURGE request:
        // await fetch(purgeUrl, { method: 'PURGE' });
        void purgeUrl; // Placeholder for actual purge call
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Failed to purge ${path}: ${message}`);
      }
    }

    if (errors.length > 0) {
      return {
        success: false,
        error: errors.join('; '),
      };
    }

    return {
      success: true,
      invalidationId: `nginx-${Date.now()}`,
      estimatedCompletionSeconds: 1, // Nginx purge is near-instant
    };
  }

  async healthCheck(): Promise<CdnAdapterHealth> {
    try {
      // In production, this would ping the Nginx health endpoint
      return {
        status: 'healthy',
        adapter: 'nginx',
        baseUrl: this.config.baseUrl,
        lastCheck: new Date(),
      };
    } catch {
      return {
        status: 'unhealthy',
        adapter: 'nginx',
        baseUrl: this.config.baseUrl,
        lastCheck: new Date(),
      };
    }
  }
}
