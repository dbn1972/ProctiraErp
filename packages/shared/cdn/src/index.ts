/**
 * @proctira/cdn - CDN Configuration and Asset URL Generation
 *
 * This package provides:
 * - CDN adapter interface for asset URL generation
 * - Configurable base CDN URL with tenant-aware routing
 * - Cache invalidation strategy per provider
 * - Support for CloudFront, Nginx, and custom CDN providers
 * - Tenant-aware branding/static asset routing
 */

// Types and Interfaces
export type {
  CdnConfig,
  AssetCategory,
  AssetUrlOptions,
  AssetUrl,
  InvalidationRequest,
  InvalidationResult,
  CdnAdapterHealth,
  CdnAdapter,
} from './types.js';
export { CdnConfigSchema } from './types.js';

// Factory
export { createCdnAdapter, CdnError } from './cdn-adapter.js';

// URL Builder (exposed for direct use without adapter)
export { buildAssetUrl, normalizePath } from './url-builder.js';

// Adapters
export { CloudFrontCdnAdapter } from './adapters/cloudfront.js';
export { NginxCdnAdapter } from './adapters/nginx.js';
export { CustomCdnAdapter } from './adapters/custom.js';
