/**
 * Tenant Resolution Module
 *
 * Authenticated tenant routes are bound only to the verified JWT tenant UUID.
 * Client-provided tenant headers and supported tenant subdomains are comparison
 * candidates, never alternative authorities for an authenticated principal.
 */

import type { FastifyRequest } from 'fastify';

/** UUID v4 regex for validating tenant IDs. */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type TenantResolutionErrorCode =
  | 'TENANT_RESOLUTION_FAILED'
  | 'TENANT_CONTEXT_MISMATCH';

/** Error thrown when tenant context is missing or malformed. */
export class TenantResolutionError extends Error {
  public readonly statusCode: number;
  public readonly code: TenantResolutionErrorCode;

  constructor(
    message: string = 'Unable to resolve tenant from request',
    options: {
      statusCode?: number;
      code?: TenantResolutionErrorCode;
    } = {},
  ) {
    super(message);
    this.name = 'TenantResolutionError';
    this.statusCode = options.statusCode ?? 401;
    this.code = options.code ?? 'TENANT_RESOLUTION_FAILED';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** A verified JWT tenant disagrees with another recognized request context. */
export class TenantContextMismatchError extends TenantResolutionError {
  constructor(message: string = 'Authenticated tenant context does not match request context') {
    super(message, {
      statusCode: 403,
      code: 'TENANT_CONTEXT_MISMATCH',
    });
    this.name = 'TenantContextMismatchError';
  }
}

/** Result of tenant resolution including the selected source. */
export interface TenantResolutionResult {
  tenantId: string;
  source: 'jwt' | 'header' | 'subdomain';
}

/** Options for tenant resolution behavior. */
export interface TenantResolutionOptions {
  /** Base domain for subdomain extraction (e.g., `proctira.org`). */
  baseDomain?: string;
  /** Header name to compare for tenant ID (default: `x-tenant-id`). */
  headerName?: string;
  /** JWT claim field name for tenant ID (default: `tenantId`). */
  jwtClaimField?: string;
  /** Whether to require a UUID v4 tenant ID (default: true). */
  requireUuid?: boolean;
  /**
   * When `request.user` is bound, require a verified JWT tenant UUID. The
   * client header and hostname can only corroborate that identity. Default:
   * true.
   */
  requireJwtTenantWhenAuthenticated?: boolean;
}

const DEFAULT_OPTIONS: Required<TenantResolutionOptions> = {
  baseDomain: process.env['TENANT_BASE_DOMAIN'] || 'proctira.org',
  headerName: 'x-tenant-id',
  jwtClaimField: 'tenantId',
  requireUuid: true,
  requireJwtTenantWhenAuthenticated: true,
};

function resolveFromJwt(request: FastifyRequest, jwtClaimField: string): string | undefined {
  const user = (request as unknown as { user?: Record<string, unknown> }).user;
  if (!user) return undefined;

  const tenantId = user[jwtClaimField];
  if (typeof tenantId === 'string' && tenantId.length > 0) {
    return tenantId.trim();
  }
  return undefined;
}

/** True when authentication has bound a verified principal to the request. */
export function isAuthenticatedRequest(request: FastifyRequest): boolean {
  const user = (request as unknown as { user?: unknown }).user;
  return user !== undefined && user !== null;
}

function resolveFromHeader(request: FastifyRequest, headerName: string): string | undefined {
  const headerValue = request.headers[headerName.toLowerCase()];
  if (typeof headerValue === 'string' && headerValue.length > 0) {
    return headerValue.trim();
  }
  return undefined;
}

/**
 * Extract a supported single-label tenant slug from the request hostname.
 * The returned value is only a candidate and must be resolved through a
 * trusted server-side lookup before it can be compared with a JWT tenant.
 */
export function resolveTenantSlugFromHostname(
  request: FastifyRequest,
  baseDomain: string,
): string | undefined {
  const host = request.hostname || request.headers['host'];
  if (!host || typeof host !== 'string') return undefined;

  const hostname = host.split(':')[0]!.toLowerCase();
  const normalizedBaseDomain = baseDomain.toLowerCase();

  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    /^\d+\.\d+\.\d+\.\d+$/.test(hostname)
  ) {
    return undefined;
  }

  if (!hostname.endsWith(`.${normalizedBaseDomain}`)) {
    return undefined;
  }

  const subdomain = hostname.slice(0, -(normalizedBaseDomain.length + 1));
  if (subdomain.length > 0 && !subdomain.includes('.')) {
    return subdomain;
  }

  return undefined;
}

/** Validate a UUID v4 tenant ID. */
export function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

function canonicalTenantId(value: string): string {
  return isValidUuid(value) ? value.toLowerCase() : value;
}

/**
 * Resolve the authoritative tenant ID for a request.
 *
 * Authenticated requests:
 * - require a verified UUID JWT claim;
 * - compare, but never trust, a supplied tenant header;
 * - leave hostname comparison to the async plugin's trusted slug lookup.
 *
 * Unauthenticated resolver consumers retain the legacy header/subdomain
 * sources. The gateway excludes its public routes from this resolver, so a
 * client header is never authority for gateway tenant data routes.
 */
export function resolveTenantId(
  request: FastifyRequest,
  options?: TenantResolutionOptions,
): TenantResolutionResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const authenticated = isAuthenticatedRequest(request);

  const jwtTenantId = resolveFromJwt(request, opts.jwtClaimField);
  const headerTenantId = resolveFromHeader(request, opts.headerName);
  const subdomain = resolveTenantSlugFromHostname(request, opts.baseDomain);

  if (authenticated && opts.requireJwtTenantWhenAuthenticated) {
    if (!jwtTenantId) {
      throw new TenantResolutionError(
        'Authenticated request requires a verified UUID tenantId claim',
      );
    }

    if (opts.requireUuid && !isValidUuid(jwtTenantId)) {
      throw new TenantResolutionError('Invalid tenant ID format in JWT claim');
    }

    const canonicalJwtTenantId = canonicalTenantId(jwtTenantId);
    if (
      headerTenantId &&
      canonicalTenantId(headerTenantId) !== canonicalJwtTenantId
    ) {
      throw new TenantContextMismatchError(
        `Verified JWT tenant does not match ${opts.headerName} request context`,
      );
    }

    return { tenantId: canonicalJwtTenantId, source: 'jwt' };
  }

  if (jwtTenantId) {
    if (opts.requireUuid && !isValidUuid(jwtTenantId)) {
      throw new TenantResolutionError('Invalid tenant ID format in JWT claim');
    }
    return { tenantId: canonicalTenantId(jwtTenantId), source: 'jwt' };
  }

  if (headerTenantId) {
    if (opts.requireUuid && !isValidUuid(headerTenantId)) {
      throw new TenantResolutionError(`Invalid tenant ID format in ${opts.headerName} header`);
    }
    return { tenantId: canonicalTenantId(headerTenantId), source: 'header' };
  }

  if (subdomain) {
    return { tenantId: subdomain, source: 'subdomain' };
  }

  throw new TenantResolutionError(
    'No tenant identifier found in JWT claims, tenant header, or request subdomain',
  );
}
