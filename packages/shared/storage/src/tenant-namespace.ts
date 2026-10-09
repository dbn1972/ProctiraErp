/**
 * Tenant-aware object key namespacing utilities.
 * Enforces the convention: tenants/{tenantId}/{key}
 *
 * W1-SEC-11: builders and accessors fail closed when tenant is missing or
 * keys are unscoped (not under tenants/{id}/).
 */

import { isProductionNodeEnv } from '@proctira/common/node-env';

const TENANT_PREFIX = 'tenants';

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantScopeError';
  }
}

export function isProductionEnv(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return isProductionNodeEnv(nodeEnv);
}

/**
 * PRC-M542 — presigned URLs grant unauthenticated, time-boxed access to a tenant
 * object. An uncapped lifetime (whatever a caller passes) is a standing data-exfil
 * window. Clamp every signed URL to at most 7 days (the S3 SigV4 maximum) and a
 * sane floor so a 0/negative value cannot mint a non-expiring URL.
 */
export const MAX_SIGNED_URL_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 604800 (S3 SigV4 max)
export const MIN_SIGNED_URL_EXPIRY_SECONDS = 1;

/** Clamp a requested signed-URL lifetime into [MIN, MAX]; non-finite falls back to `fallback`. */
export function clampSignedUrlExpiry(requested: number | undefined, fallback: number): number {
  const base =
    Number.isFinite(requested) && (requested as number) > 0 ? (requested as number) : fallback;
  return Math.min(MAX_SIGNED_URL_EXPIRY_SECONDS, Math.max(MIN_SIGNED_URL_EXPIRY_SECONDS, base));
}

export function isUnscopedTenantNamespaceAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.ALLOW_UNSCOPED_TENANT_NAMESPACES?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** Whether object key operations must reject unscoped keys. */
export function shouldRequireTenantScopedObjectKeys(
  env: NodeJS.ProcessEnv = process.env,
  explicit?: boolean,
): boolean {
  if (typeof explicit === 'boolean') return explicit;
  if (isUnscopedTenantNamespaceAllowed(env)) return false;
  // PRC-M634: previously prod-only, so a non-prod misuse (unscoped raw key) was
  // silently accepted and only caught in production. Fail closed in every
  // environment unless the explicit emergency hatch is set, matching the
  // queue-abstraction subscribe posture.
  return true;
}

export function assertTenantId(
  tenantId: string | null | undefined,
  surface = 'storage',
): asserts tenantId is string {
  if (typeof tenantId !== 'string' || tenantId.trim().length === 0) {
    throw new TenantScopeError(
      `${surface}: tenantId is required for tenant-scoped namespaces (W1-SEC-11)`,
    );
  }
}

/** True when key is under tenants/{nonEmptyTenantId}/... */
export function isTenantScopedObjectKey(key: string): boolean {
  if (!key || key.trim().length === 0) return false;
  const parts = key.replace(/^\/+/, '').split('/');
  return parts.length >= 3 && parts[0] === TENANT_PREFIX && Boolean(parts[1]?.trim());
}

/**
 * Reject object keys / list prefixes that are not tenant-scoped.
 * Always enforced for write path builders; raw download/delete/list use this
 * when production fail-closed (or explicit require).
 */
export function assertTenantScopedObjectKey(key: string, surface = 'storage'): void {
  if (!isTenantScopedObjectKey(key)) {
    throw new TenantScopeError(
      `${surface}: unscoped object key/prefix rejected — expected tenants/{tenantId}/... (W1-SEC-11): "${key}"`,
    );
  }
}

/**
 * Optional production gate for raw key operations (download/delete/list/signed URL).
 */
export function assertTenantScopedObjectKeyIfRequired(
  key: string,
  options: { env?: NodeJS.ProcessEnv; requireTenantScope?: boolean; surface?: string } = {},
): void {
  const required = shouldRequireTenantScopedObjectKeys(
    options.env ?? process.env,
    options.requireTenantScope,
  );
  if (required) {
    assertTenantScopedObjectKey(key, options.surface ?? 'storage');
  }
}

/**
 * PRC-M634 — ownership guard for raw-key operations. The previous scope check was
 * shape-only ("is this key under *some* tenants/{id}/ prefix"), so one tenant
 * could pass another tenant's well-formed key to download/delete/sign/list and the
 * check still passed. When the caller supplies its own tenantId, assert the key is
 * owned by that tenant (key segment === caller tenant), not merely scoped.
 */
export function assertTenantOwnedObjectKey(
  key: string,
  tenantId: string | undefined,
  surface = 'storage',
): void {
  // When no caller tenant is supplied we fall back to the shape check elsewhere;
  // ownership can only be enforced against a known caller identity.
  if (tenantId === undefined) return;
  assertTenantId(tenantId, surface);
  if (!validateTenantOwnership(key, tenantId)) {
    throw new TenantScopeError(
      `${surface}: object key "${key}" is not owned by tenant "${tenantId}" (PRC-M634)`,
    );
  }
}

/** PRC-L149 — tenant ids are opaque tokens (UUID or slug): no '/', '.', whitespace or control chars. */
const SAFE_TENANT_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;
// eslint-disable-next-line no-control-regex
const UNSAFE_PATH_CHARS = /[\\\u0000-\u001f\u007f]/;

export function assertSafeTenantSegment(tenantId: string, surface = 'storage'): void {
  if (!SAFE_TENANT_SEGMENT.test(tenantId)) {
    throw new TenantScopeError(
      `${surface}: tenantId must match ${SAFE_TENANT_SEGMENT.source} (PRC-L149)`,
    );
  }
}

/**
 * PRC-L149 — reject traversal ('.'/'..' segments), backslashes, control chars and
 * empty interior segments ('a//b'). A single trailing '/' (folder marker) is allowed.
 */
export function assertSafeObjectPath(path: string, surface = 'storage'): void {
  const body = path.endsWith('/') ? path.slice(0, -1) : path;
  if (UNSAFE_PATH_CHARS.test(path)) {
    throw new TenantScopeError(
      `${surface}: key contains backslash or control characters (PRC-L149)`,
    );
  }
  if (body.length === 0) return;
  for (const segment of body.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new TenantScopeError(
        `${surface}: key must not contain empty, '.' or '..' segments (PRC-L149)`,
      );
    }
  }
}

/**
 * Build a tenant-namespaced object key.
 * Ensures all objects are stored under tenants/{tenantId}/ prefix.
 *
 * @param tenantId - The tenant identifier
 * @param key - The object key (relative path within tenant namespace)
 * @returns The full namespaced key
 * @throws TenantScopeError if tenantId or key is empty
 */
export function buildTenantKey(tenantId: string, key: string): string {
  assertTenantId(tenantId, 'storage.buildTenantKey');
  if (!key || key.trim().length === 0) {
    throw new TenantScopeError('storage.buildTenantKey: key must not be empty');
  }

  // Normalize: remove leading slashes from key
  const normalizedKey = key.replace(/^\/+/, '');
  // Remove trailing slashes from tenantId
  const normalizedTenantId = tenantId.replace(/\/+$/, '').trim();

  assertSafeTenantSegment(normalizedTenantId, 'storage.buildTenantKey');
  assertSafeObjectPath(normalizedKey, 'storage.buildTenantKey');
  const result = `${TENANT_PREFIX}/${normalizedTenantId}/${normalizedKey}`;
  assertTenantScopedObjectKey(result, 'storage.buildTenantKey');
  return result;
}

/**
 * Build a tenant-namespaced prefix for listing objects.
 *
 * @param tenantId - The tenant identifier
 * @param prefix - Optional sub-prefix within the tenant namespace
 * @returns The full namespaced prefix
 */
export function buildTenantPrefix(tenantId: string, prefix?: string): string {
  assertTenantId(tenantId, 'storage.buildTenantPrefix');

  const normalizedTenantId = tenantId.replace(/\/+$/, '').trim();
  assertSafeTenantSegment(normalizedTenantId, 'storage.buildTenantPrefix');
  const base = `${TENANT_PREFIX}/${normalizedTenantId}/`;

  if (!prefix || prefix.trim().length === 0) {
    return base;
  }

  const normalizedPrefix = prefix.replace(/^\/+/, '');
  assertSafeObjectPath(normalizedPrefix, 'storage.buildTenantPrefix');
  return `${base}${normalizedPrefix}`;
}

/**
 * Extract the tenant ID from a namespaced key.
 *
 * @param namespacedKey - The full key (e.g., 'tenants/abc-123/documents/file.pdf')
 * @returns The tenant ID, or null if the key doesn't follow the convention
 */
export function extractTenantId(namespacedKey: string): string | null {
  const parts = namespacedKey.split('/');
  if (parts.length < 3 || parts[0] !== TENANT_PREFIX) {
    return null;
  }
  return parts[1] ?? null;
}

/**
 * Validate that a key belongs to the expected tenant.
 *
 * @param key - The full namespaced key
 * @param expectedTenantId - The tenant ID to validate against
 * @returns true if the key belongs to the expected tenant
 */
export function validateTenantOwnership(key: string, expectedTenantId: string): boolean {
  const tenantId = extractTenantId(key);
  return tenantId === expectedTenantId;
}
