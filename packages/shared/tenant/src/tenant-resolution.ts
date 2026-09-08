/**
 * Tenant Resolution Module
 *
 * Resolves the tenant ID from incoming requests using a priority chain:
 * 1. JWT claim (highest priority — authenticated requests)
 * 2. X-Tenant-ID header (API clients, mobile apps)
 * 3. Subdomain extraction (web clients)
 *
 * If no tenant can be resolved, throws an error.
 */

import type { FastifyRequest } from 'fastify';

/** UUID v4 regex for validating tenant IDs */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Error thrown when tenant cannot be resolved from the request.
 */
export class TenantResolutionError extends Error {
  public readonly statusCode = 401;
  public readonly code = 'TENANT_RESOLUTION_FAILED';

  constructor(message: string = 'Unable to resolve tenant from request') {
    super(message);
    this.name = 'TenantResolutionError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Result of tenant resolution including the source of the resolved tenant.
 */
export interface TenantResolutionResult {
  tenantId: string;
  source: 'jwt' | 'header' | 'subdomain';
}

/**
 * Options for tenant resolution behavior.
 */
export interface TenantResolutionOptions {
  /** Base domain for subdomain extraction (e.g., 'proctira.org') */
  baseDomain?: string;
  /** Header name to check for tenant ID (default: 'x-tenant-id') */
  headerName?: string;
  /** JWT claim field name for tenant ID (default: 'tenantId') */
  jwtClaimField?: string;
  /** Whether to require a valid UUID format (default: true) */
  requireUuid?: boolean;
}

const DEFAULT_OPTIONS: Required<TenantResolutionOptions> = {
  baseDomain: process.env['TENANT_BASE_DOMAIN'] || 'proctira.org',
  headerName: 'x-tenant-id',
  jwtClaimField: 'tenantId',
  requireUuid: true,
};

/**
 * Extracts tenant ID from JWT claims on the request.
 * Requires the request to have been authenticated (request.user populated).
 */
function resolveFromJwt(request: FastifyRequest, jwtClaimField: string): string | undefined {
  const user = (request as unknown as { user?: Record<string, unknown> }).user;
  if (!user) return undefined;

  const tenantId = user[jwtClaimField];
  if (typeof tenantId === 'string' && tenantId.length > 0) {
    return tenantId;
  }
  return undefined;
}

/**
 * Extracts tenant ID from the X-Tenant-ID request header.
 */
function resolveFromHeader(request: FastifyRequest, headerName: string): string | undefined {
  const headerValue = request.headers[headerName];
  if (typeof headerValue === 'string' && headerValue.length > 0) {
    return headerValue.trim();
  }
  return undefined;
}

/**
 * Extracts tenant slug from the request hostname subdomain.
 * For example, 'ministry-edu.proctira.org' → 'ministry-edu'
 *
 * Returns undefined if:
 * - No host header
 * - Host is the base domain itself (no subdomain)
 * - Host is localhost or an IP address
 */
function resolveFromSubdomain(request: FastifyRequest, baseDomain: string): string | undefined {
  const host = request.hostname || request.headers['host'];
  if (!host || typeof host !== 'string') return undefined;

  // Strip port if present
  const hostname = host.split(':')[0]!;

  // Skip localhost and IP addresses
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    /^\d+\.\d+\.\d+\.\d+$/.test(hostname)
  ) {
    return undefined;
  }

  // Check if hostname ends with the base domain
  if (!hostname.endsWith(`.${baseDomain}`)) {
    return undefined;
  }

  // Extract subdomain (everything before the base domain)
  const subdomain = hostname.slice(0, -(baseDomain.length + 1));
  if (subdomain.length > 0 && !subdomain.includes('.')) {
    return subdomain;
  }

  return undefined;
}

/**
 * Validates that a string is a valid UUID v4 format.
 */
export function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

/**
 * Resolves the tenant ID from an incoming Fastify request.
 *
 * Resolution priority:
 * 1. JWT claim `tenantId` (highest — for authenticated requests)
 * 2. `X-Tenant-ID` header (for API clients and mobile apps)
 * 3. Subdomain extraction (for web clients)
 *
 * @throws TenantResolutionError if no tenant can be resolved
 */
export function resolveTenantId(
  request: FastifyRequest,
  options?: TenantResolutionOptions,
): TenantResolutionResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Priority 1: JWT claim
  const jwtTenantId = resolveFromJwt(request, opts.jwtClaimField);
  if (jwtTenantId) {
    if (opts.requireUuid && !isValidUuid(jwtTenantId)) {
      throw new TenantResolutionError(`Invalid tenant ID format in JWT claim: ${jwtTenantId}`);
    }
    return { tenantId: jwtTenantId, source: 'jwt' };
  }

  // Priority 2: X-Tenant-ID header
  const headerTenantId = resolveFromHeader(request, opts.headerName);
  if (headerTenantId) {
    if (opts.requireUuid && !isValidUuid(headerTenantId)) {
      throw new TenantResolutionError(
        `Invalid tenant ID format in ${opts.headerName} header: ${headerTenantId}`,
      );
    }
    return { tenantId: headerTenantId, source: 'header' };
  }

  // Priority 3: Subdomain
  const subdomain = resolveFromSubdomain(request, opts.baseDomain);
  if (subdomain) {
    // Subdomain is a slug, not a UUID — skip UUID validation for subdomain source
    return { tenantId: subdomain, source: 'subdomain' };
  }

  throw new TenantResolutionError(
    'No tenant identifier found in JWT claims, X-Tenant-ID header, or request subdomain',
  );
}
