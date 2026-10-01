/**
 * CDN URL Builder
 *
 * Constructs CDN URLs with tenant-aware routing and cache-busting support.
 * Used internally by all CDN adapters for consistent URL generation.
 */

import type { AssetCategory, AssetUrl, AssetUrlOptions, CdnConfig } from './types.js';

/**
 * Resolves the path prefix for a given asset category.
 */
function getCategoryPrefix(category: AssetCategory, config: CdnConfig): string {
  switch (category) {
    case 'branding':
      return config.brandingPrefix;
    case 'static':
      return config.staticPrefix;
    case 'upload':
      return '/uploads';
    case 'document':
      return '/documents';
  }
}

/**
 * Normalizes a URL path by removing duplicate slashes and ensuring
 * it starts with a single forward slash.
 */
export function normalizePath(path: string): string {
  // Remove leading/trailing whitespace
  let normalized = path.trim();

  // Replace multiple consecutive slashes with a single slash
  normalized = normalized.replace(/\/+/g, '/');

  // Ensure leading slash
  if (!normalized.startsWith('/')) {
    normalized = '/' + normalized;
  }

  // Remove trailing slash (unless it's the root path)
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

/** PRC-L580: thrown when an asset path or tenant id is unsafe or missing. */
export class CdnPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CdnPathError';
  }
}

// eslint-disable-next-line no-control-regex -- intentionally matching control characters
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const SAFE_TENANT_ID = /^[A-Za-z0-9_-]+$/;

/**
 * PRC-L580: validates a caller asset path and percent-encodes each segment.
 * Rejects `.`/`..` segments, backslashes and control characters so a path can
 * never escape its category/tenant prefix.
 */
function encodeAssetPath(path: string): string {
  if (path.includes('\\') || CONTROL_CHARS.test(path)) {
    throw new CdnPathError('CDN asset path must not contain backslashes or control characters');
  }
  const segments = path
    .trim()
    .split('/')
    .filter((segment) => segment.length > 0);
  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw new CdnPathError('CDN asset path must not contain "." or ".." segments');
    }
  }
  return segments.map((segment) => encodeURIComponent(segment)).join('/');
}

/** PRC-L580: tenant ids are a single safe segment (no '/', '.', spaces). */
function assertSafeTenantId(tenantId: string): string {
  if (!SAFE_TENANT_ID.test(tenantId)) {
    throw new CdnPathError('CDN tenantId must contain only letters, digits, "-" or "_"');
  }
  return tenantId;
}

/**
 * Strips the trailing slash from a base URL.
 */
function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

/**
 * Builds a CDN asset URL based on the provided options and configuration.
 *
 * URL structure:
 * - Tenant-aware branding: {baseUrl}/branding/{tenantId}/{path}?v={version}
 * - Shared static:         {baseUrl}/static/{path}?v={version}
 * - Tenant uploads:        {baseUrl}/uploads/{tenantId}/{path}?v={version}
 * - Documents:             {baseUrl}/documents/{tenantId}/{path}?v={version}
 */
export function buildAssetUrl(options: AssetUrlOptions, config: CdnConfig): AssetUrl {
  const base = normalizeBaseUrl(config.baseUrl);
  const categoryPrefix = getCategoryPrefix(options.category, config);

  // Build the path segments
  const segments: string[] = [categoryPrefix];

  // Add tenant segment for tenant-aware categories
  // PRC-L580: fail closed — a tenant-aware asset without a tenant would resolve
  // to a shared (cross-tenant) path.
  const needsTenant = config.tenantAware && options.category !== 'static';
  if (needsTenant) {
    const tenantId = options.tenantId?.trim();
    if (!tenantId) {
      throw new CdnPathError(
        `CDN tenantId is required for tenant-aware ${options.category} assets`,
      );
    }
    segments.push(assertSafeTenantId(tenantId));
  }

  // Add the validated, segment-encoded asset path
  segments.push(encodeAssetPath(options.path));

  // Normalize the full path
  const resolvedPath = normalizePath(segments.join('/'));

  // Build the full URL
  let url = `${base}${resolvedPath}`;

  // Add version query parameter for cache busting
  const shouldVersion = config.cache?.enableVersioning !== false && options.version;
  if (shouldVersion) {
    url += `?v=${encodeURIComponent(options.version!)}`;
  }

  return {
    url,
    path: resolvedPath,
    versioned: !!shouldVersion,
  };
}
