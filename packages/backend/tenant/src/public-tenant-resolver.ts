import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';

import type { TenantEntity, TenantRepository } from './tenant-repository.js';

const TENANT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Trusted hostname-only tenant lookup used by anonymous public applications. */
export interface PublicTenantResolver {
  resolveHostname(hostHeader: string | undefined): Promise<string | null>;
}

export interface PublicTenantResolverOptions {
  repository: TenantRepository;
  baseDomain: string;
}

/**
 * Normalize an HTTP Host value without consulting forwarding headers.
 * Invalid, local, IP, multi-value, or non-DNS hosts are rejected.
 */
export function normalizePublicHostname(raw: string | undefined): string | null {
  if (!raw) return null;
  const candidate = raw.trim();
  if (candidate.length === 0 || candidate.length > 300 || /[\s,/@?#\\]/.test(candidate)) {
    return null;
  }

  let hostname: string;
  try {
    hostname = new URL(`http://${candidate}`).hostname;
  } catch {
    return null;
  }

  hostname = domainToASCII(hostname).toLowerCase().replace(/\.$/, '');
  if (
    hostname.length === 0 ||
    hostname.length > 253 ||
    hostname === 'localhost' ||
    isIP(hostname) !== 0
  ) {
    return null;
  }
  const labels = hostname.split('.');
  if (labels.length < 2 || labels.some((label) => !DNS_LABEL.test(label))) return null;
  return hostname;
}

function isActiveCanonicalTenant(tenant: TenantEntity | null): tenant is TenantEntity {
  return tenant?.status === 'active' && TENANT_UUID.test(tenant.id);
}

/**
 * Resolve either `<canonical-slug>.<base-domain>` or an explicitly verified
 * custom domain through the durable tenant repository. The base domain is
 * reserved for canonical slugs and can never be captured by a custom-domain row.
 */
export function createPublicTenantResolver({
  repository,
  baseDomain,
}: PublicTenantResolverOptions): PublicTenantResolver {
  const normalizedBaseDomain = normalizePublicHostname(baseDomain);
  if (!normalizedBaseDomain || normalizedBaseDomain.includes(':')) {
    throw new TypeError('Public tenant baseDomain must be a valid DNS hostname');
  }

  return {
    async resolveHostname(hostHeader: string | undefined): Promise<string | null> {
      const hostname = normalizePublicHostname(hostHeader);
      if (!hostname) return null;

      if (hostname === normalizedBaseDomain) return null;
      if (hostname.endsWith(`.${normalizedBaseDomain}`)) {
        const slug = hostname.slice(0, -(normalizedBaseDomain.length + 1));
        if (!DNS_LABEL.test(slug) || slug.includes('.')) return null;
        const tenant = await repository.findTenantBySlug(slug);
        return isActiveCanonicalTenant(tenant) ? tenant.id : null;
      }

      const domain = await repository.findDomainByName(hostname);
      if (!domain?.verified) return null;
      const tenant = await repository.findTenantById(domain.tenantId);
      return isActiveCanonicalTenant(tenant) ? tenant.id : null;
    },
  };
}
