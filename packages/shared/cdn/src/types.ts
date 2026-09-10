/**
 * CDN Configuration Types
 *
 * Defines the interfaces and types for the CDN adapter layer,
 * supporting configurable CDN providers (CloudFront, Nginx, custom)
 * with tenant-aware asset routing and cache invalidation.
 */

import { Type, Static } from '@sinclair/typebox';

// ─── Configuration Schemas ───────────────────────────────────────────────────

/**
 * Schema for CDN adapter configuration.
 */
export const CdnConfigSchema = Type.Object({
  /** CDN adapter type */
  adapter: Type.Union([Type.Literal('cloudfront'), Type.Literal('nginx'), Type.Literal('custom')]),
  /** Base URL for the CDN (e.g., 'https://cdn.proctira.org') */
  baseUrl: Type.String({ minLength: 1 }),
  /** Whether to enable tenant-aware asset routing */
  tenantAware: Type.Boolean({ default: true }),
  /** Path prefix for tenant-specific branding assets */
  brandingPrefix: Type.String({ default: '/branding' }),
  /** Path prefix for shared static assets */
  staticPrefix: Type.String({ default: '/static' }),
  /** Cache configuration */
  cache: Type.Optional(
    Type.Object({
      /** Default cache TTL in seconds */
      defaultTtlSeconds: Type.Number({ minimum: 0, default: 86400 }),
      /** Cache TTL for branding assets in seconds */
      brandingTtlSeconds: Type.Number({ minimum: 0, default: 3600 }),
      /** Whether to append version/hash query params for cache busting */
      enableVersioning: Type.Boolean({ default: true }),
    }),
  ),
  /** CloudFront-specific configuration */
  cloudfront: Type.Optional(
    Type.Object({
      distributionId: Type.String(),
      /** AWS region for CloudFront API calls */
      region: Type.String({ default: 'us-east-1' }),
    }),
  ),
  /** Custom CDN configuration for self-hosted or other providers */
  custom: Type.Optional(
    Type.Object({
      /** Custom invalidation endpoint URL */
      invalidationEndpoint: Type.Optional(Type.String()),
      /** Custom headers to include in invalidation requests */
      headers: Type.Optional(Type.Record(Type.String(), Type.String())),
    }),
  ),
});

export type CdnConfig = Static<typeof CdnConfigSchema>;

// ─── Asset Types ─────────────────────────────────────────────────────────────

/**
 * Supported asset categories for CDN routing.
 */
export type AssetCategory = 'branding' | 'static' | 'upload' | 'document';

/**
 * Options for generating a CDN asset URL.
 */
export interface AssetUrlOptions {
  /** The relative path to the asset (e.g., 'logo.png', 'css/main.css') */
  path: string;
  /** Asset category determines the URL prefix */
  category: AssetCategory;
  /** Tenant ID for tenant-aware routing (required when tenantAware is true) */
  tenantId?: string;
  /** Optional version string for cache busting */
  version?: string;
}

/**
 * Result of a CDN URL generation.
 */
export interface AssetUrl {
  /** The fully-qualified CDN URL */
  url: string;
  /** The resolved path (without base URL) */
  path: string;
  /** Whether the URL includes a cache-busting parameter */
  versioned: boolean;
}

// ─── Cache Invalidation ──────────────────────────────────────────────────────

/**
 * Request to invalidate cached assets on the CDN.
 */
export interface InvalidationRequest {
  /** Paths to invalidate (supports wildcards like '/branding/tenant-1/*') */
  paths: string[];
  /** Optional reason for the invalidation (for audit logging) */
  reason?: string;
  /** Tenant ID if invalidating tenant-specific assets */
  tenantId?: string;
}

/**
 * Result of a cache invalidation operation.
 */
export interface InvalidationResult {
  /** Whether the invalidation was successfully submitted */
  success: boolean;
  /** Provider-specific invalidation ID for tracking */
  invalidationId?: string;
  /** Estimated time for invalidation to complete (in seconds) */
  estimatedCompletionSeconds?: number;
  /** Error message if invalidation failed */
  error?: string;
}

// ─── Adapter Interface ───────────────────────────────────────────────────────

/**
 * Health status for the CDN adapter.
 */
export interface CdnAdapterHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  adapter: string;
  baseUrl: string;
  lastCheck?: Date;
  details?: Record<string, unknown>;
}

/**
 * CDN Adapter Interface
 *
 * Provides an abstraction over CDN providers for:
 * - Generating asset URLs with tenant-aware routing
 * - Cache invalidation
 * - Health checking
 */
export interface CdnAdapter {
  /** Generate a fully-qualified CDN URL for an asset */
  getAssetUrl(options: AssetUrlOptions): AssetUrl;

  /** Invalidate cached assets on the CDN */
  invalidate(request: InvalidationRequest): Promise<InvalidationResult>;

  /** Check the health of the CDN adapter */
  healthCheck(): Promise<CdnAdapterHealth>;
}
