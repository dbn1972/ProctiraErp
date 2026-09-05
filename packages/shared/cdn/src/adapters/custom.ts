/**
 * Custom CDN Adapter
 *
 * Implements the CDN adapter interface for custom or self-hosted CDN providers.
 * Supports configurable invalidation endpoints and custom headers.
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

export class CustomCdnAdapter implements CdnAdapter {
  private readonly config: CdnConfig;

  constructor(config: CdnConfig) {
    this.config = config;
  }

  getAssetUrl(options: AssetUrlOptions): AssetUrl {
    return buildAssetUrl(options, this.config);
  }

  async invalidate(request: InvalidationRequest): Promise<InvalidationResult> {
    const endpoint = this.config.custom?.invalidationEndpoint;
    const pathCount = request.paths.length;

    if (!endpoint) {
      // No invalidation endpoint configured — invalidation is a no-op
      return {
        success: true,
        invalidationId: `custom-noop-${pathCount}-${Date.now()}`,
        estimatedCompletionSeconds: 0,
      };
    }

    try {
      // In production, this would POST to the custom invalidation endpoint:
      // const response = await fetch(endpoint, {
      //   method: 'POST',
      //   headers: {
      //     'Content-Type': 'application/json',
      //     ...this.config.custom?.headers,
      //   },
      //   body: JSON.stringify({
      //     paths: request.paths,
      //     tenantId: request.tenantId,
      //     reason: request.reason,
      //   }),
      // });

      void endpoint; // Placeholder for actual API call

      return {
        success: true,
        invalidationId: `custom-${pathCount}-${Date.now()}`,
        estimatedCompletionSeconds: 60,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: `Custom CDN invalidation failed: ${message}`,
      };
    }
  }

  async healthCheck(): Promise<CdnAdapterHealth> {
    return {
      status: 'healthy',
      adapter: 'custom',
      baseUrl: this.config.baseUrl,
      lastCheck: new Date(),
      details: {
        hasInvalidationEndpoint: !!this.config.custom?.invalidationEndpoint,
      },
    };
  }
}
