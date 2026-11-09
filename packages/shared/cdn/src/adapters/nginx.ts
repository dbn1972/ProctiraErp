/**
 * Nginx CDN Adapter
 *
 * Implements the CDN adapter interface for self-hosted Nginx-based CDN.
 * Cache invalidation is performed via the Nginx cache purge module endpoint.
 *
 * PRC-L489: invalidate() sends a real `PURGE` request per path and healthCheck() probes
 * the base URL, instead of returning success without any I/O.
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
import { assertSafeAssetPath, buildAssetUrl, normalizePath } from '../url-builder.js';
import { DEFAULT_CDN_TIMEOUT_MS, errorText, probeBaseUrl, resolveFetch } from './http.js';

export class NginxCdnAdapter implements CdnAdapter {
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
    // Nginx cache purge (ngx_cache_purge / proxy_cache_purge) accepts a PURGE request
    // for the cached URL. 404 means "not in cache", which is already the desired state.
    const purgeBaseUrl = this.config.baseUrl.endsWith('/')
      ? this.config.baseUrl.slice(0, -1)
      : this.config.baseUrl;

    const errors: string[] = [];
    const safePaths: string[] = [];
    for (const path of request.paths) {
      // PRC-L580: never purge a caller path that can traverse out of its prefix.
      try {
        assertSafeAssetPath(path);
        safePaths.push(path);
      } catch (error) {
        errors.push(`Rejected unsafe purge path ${JSON.stringify(path)}: ${errorText(error)}`);
      }
    }
    if (errors.length > 0) {
      // Fail the whole batch before any purge when one path is unsafe.
      return { success: false, error: errors.join('; ') };
    }
    if (safePaths.length === 0) {
      return { success: false, error: 'Nginx purge failed: no paths given' };
    }

    const doFetch = resolveFetch(this.deps);
    for (const path of safePaths) {
      const purgeUrl = `${purgeBaseUrl}${normalizePath(path)}`;
      try {
        const response = await doFetch(purgeUrl, {
          method: 'PURGE',
          redirect: 'manual',
          signal: AbortSignal.timeout(this.deps.timeoutMs ?? DEFAULT_CDN_TIMEOUT_MS),
        });
        if (!response.ok && response.status !== 404) {
          errors.push(`Failed to purge ${path}: HTTP ${response.status}`);
        }
      } catch (error) {
        errors.push(`Failed to purge ${path}: ${errorText(error)}`);
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
    return probeBaseUrl('nginx', this.config.baseUrl, this.deps);
  }
}
