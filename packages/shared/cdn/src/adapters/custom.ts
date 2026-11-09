/**
 * Custom CDN Adapter
 *
 * Implements the CDN adapter interface for custom or self-hosted CDN providers.
 * Supports configurable invalidation endpoints and custom headers.
 *
 * PRC-L489: invalidate() POSTs to the configured endpoint and reports the HTTP outcome;
 * with no endpoint configured it reports failure instead of a fabricated success.
 */
import type {
  AssetUrl,
  AssetUrlOptions,
  CdnAdapter,
  CdnAdapterDeps,
  CdnAdapterHealth,
  CdnConfig,
  InvalidationRequest,
  InvalidationResult,
} from '../types.js';
import { buildAssetUrl } from '../url-builder.js';
import { DEFAULT_CDN_TIMEOUT_MS, errorText, probeBaseUrl, resolveFetch } from './http.js';

export class CustomCdnAdapter implements CdnAdapter {
  private readonly config: CdnConfig;
  private readonly deps: CdnAdapterDeps;

  constructor(config: CdnConfig, deps: CdnAdapterDeps = {}) {
    this.config = config;
    this.deps = deps;
  }

  getAssetUrl(options: AssetUrlOptions): AssetUrl {
    return buildAssetUrl(options, this.config);
  }

  async invalidate(request: InvalidationRequest): Promise<InvalidationResult> {
    const endpoint = this.config.custom?.invalidationEndpoint;
    if (!endpoint) {
      return {
        success: false,
        error: 'Custom CDN invalidation failed: no invalidation endpoint configured',
      };
    }

    try {
      const response = await resolveFetch(this.deps)(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.config.custom?.headers,
        },
        body: JSON.stringify({
          paths: request.paths,
          tenantId: request.tenantId,
          reason: request.reason,
        }),
        redirect: 'manual',
        signal: AbortSignal.timeout(this.deps.timeoutMs ?? DEFAULT_CDN_TIMEOUT_MS),
      });
      if (!response.ok) {
        return {
          success: false,
          error: `Custom CDN invalidation failed: HTTP ${response.status}`,
        };
      }
      let providerId: string | undefined;
      try {
        const body = (await response.json()) as { id?: unknown; invalidationId?: unknown };
        const id = body?.invalidationId ?? body?.id;
        providerId = typeof id === 'string' && id.length > 0 ? id : undefined;
      } catch {
        // A provider may answer 2xx with an empty or non-JSON body.
      }
      return {
        success: true,
        invalidationId: providerId ?? `custom-${Date.now()}`,
        estimatedCompletionSeconds: 60,
      };
    } catch (error) {
      return {
        success: false,
        error: `Custom CDN invalidation failed: ${errorText(error)}`,
      };
    }
  }

  async healthCheck(): Promise<CdnAdapterHealth> {
    const hasInvalidationEndpoint = !!this.config.custom?.invalidationEndpoint;
    const health = await probeBaseUrl('custom', this.config.baseUrl, this.deps, {
      hasInvalidationEndpoint,
    });
    // Reachable but unable to invalidate is not fully healthy.
    if (health.status === 'healthy' && !hasInvalidationEndpoint) {
      return { ...health, status: 'degraded' };
    }
    return health;
  }
}
