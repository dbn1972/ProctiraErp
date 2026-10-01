/**
 * Server-side tenant resolution for BFF route handlers (PRC-H027).
 *
 * The tenant is derived from the request Host (set by the ingress / trusted
 * proxy), never from a client-supplied `X-Tenant-ID` header. When the host
 * does not map to a tenant subdomain, an operator-configured
 * `TENANT_FALLBACK_SLUG` (server env, for single-tenant or local deployments)
 * is used. Otherwise the tenant is unresolved and callers must fail closed
 * rather than silently using a shared `'default'` tenant.
 */

/** Base domain for subdomain extraction. */
function baseDomain(): string {
  return process.env.TENANT_BASE_DOMAIN || 'proctira.io';
}

/**
 * Extracts the tenant slug from a hostname like `school1.proctira.io`.
 * Returns `null` for localhost, IP addresses, the bare base domain, or
 * nested subdomains.
 */
export function resolveTenantFromSubdomain(hostname: string): string | null {
  const host = hostname.split(':')[0] || '';
  if (host === 'localhost' || host === '127.0.0.1' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return null;
  }
  const domain = baseDomain();
  if (!host.endsWith(`.${domain}`)) {
    return null;
  }
  const subdomain = host.slice(0, -(domain.length + 1));
  if (subdomain.length > 0 && !subdomain.includes('.')) {
    return subdomain;
  }
  return null;
}

function requestHost(request: Request): string {
  const header = request.headers.get('host');
  if (header) return header;
  try {
    return new URL(request.url).host;
  } catch {
    return '';
  }
}

/**
 * Resolves the tenant for a BFF request from the Host header, falling back to
 * the server-configured `TENANT_FALLBACK_SLUG`. Client `X-Tenant-ID` is
 * deliberately ignored. Returns `null` when no tenant can be resolved.
 */
export function resolveTenantForRequest(request: Request): string | null {
  const fromHost = resolveTenantFromSubdomain(requestHost(request));
  if (fromHost) return fromHost;
  const fallback = process.env.TENANT_FALLBACK_SLUG?.trim();
  return fallback ? fallback : null;
}

/** Standard 400 body when the tenant cannot be resolved for a request. */
export const TENANT_UNRESOLVED_BODY = {
  code: 'TENANT_REQUIRED',
  message: 'Tenant could not be determined from this address.',
} as const;
