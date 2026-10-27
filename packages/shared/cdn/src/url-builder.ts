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

/** Matches one character from the same whitespace set as `\s` and `String.prototype.trim`. */
const WHITESPACE_CHAR_RE = /^\s$/;

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

  // Remove trailing slashes and any whitespace they expose so the result is
  // idempotent; the root path stays '/'. A single backward scan keeps this
  // linear: a trailing-run regex such as /[\s/]+$/ backtracks O(n^2) on a long
  // whitespace run followed by another character.
  let end = normalized.length;
  while (end > 0) {
    const ch = normalized.charAt(end - 1);
    if (ch !== '/' && !WHITESPACE_CHAR_RE.test(ch)) break;
    end--;
  }
  normalized = normalized.slice(0, end);

  return normalized === '' ? '/' : normalized;
}

/**
 * PRC-L580: thrown when a caller-supplied tenant id or asset/purge path could
 * escape its prefix. Fails closed rather than stripping, so a malicious path is
 * never silently mapped to a different, valid asset.
 */
export class CdnPathError extends Error {
  readonly code = 'CDN_INVALID_PATH';
  constructor(message: string) {
    super(message);
    this.name = 'CdnPathError';
    Object.setPrototypeOf(this, CdnPathError.prototype);
  }
}

const TENANT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;

/**
 * Asserts a tenant id is a single safe path segment (letters, digits, '-', '_').
 * @throws CdnPathError
 */
export function assertSafeTenantId(tenantId: string): void {
  if (!TENANT_ID_RE.test(tenantId)) {
    throw new CdnPathError(`Unsafe CDN tenant id: ${JSON.stringify(tenantId)}`);
  }
}

/**
 * Asserts an asset or purge path cannot traverse out of its prefix: no
 * backslashes or control characters, no malformed percent escapes, and no
 * segment that is (or decodes to) '.' or '..' or contains a separator.
 * Wildcards such as `/branding/tenant-1/*` are allowed.
 * @throws CdnPathError
 */
export function assertSafeAssetPath(path: string): void {
  const reject = (reason: string): never => {
    throw new CdnPathError(`Unsafe CDN path ${JSON.stringify(path)}: ${reason}`);
  };
  if (path.includes('\\')) reject('backslash is not allowed');
  if (CONTROL_CHAR_RE.test(path)) reject('control characters are not allowed');
  for (const segment of path.split('/')) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return reject('malformed percent escape');
    }
    if (decoded === '.' || decoded === '..') reject('dot segments are not allowed');
    if (decoded.includes('/') || decoded.includes('\\')) reject('encoded separator');
    if (CONTROL_CHAR_RE.test(decoded)) reject('encoded control character');
  }
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
 *
 * @throws CdnPathError when tenantId or path is unsafe (PRC-L580).
 */
export function buildAssetUrl(options: AssetUrlOptions, config: CdnConfig): AssetUrl {
  const base = normalizeBaseUrl(config.baseUrl);
  const categoryPrefix = getCategoryPrefix(options.category, config);

  // Build the path segments
  const segments: string[] = [categoryPrefix];

  // Add tenant segment for tenant-aware categories
  const needsTenant = config.tenantAware && options.category !== 'static';
  if (needsTenant && options.tenantId) {
    assertSafeTenantId(options.tenantId);
    segments.push(options.tenantId);
  }

  // Add the asset path
  assertSafeAssetPath(options.path);
  segments.push(options.path);

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
