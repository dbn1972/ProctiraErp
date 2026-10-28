import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';

import type { TenantEntity, TenantRepository } from './tenant-repository.js';

const TENANT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Trusted hostname-only tenant lookup used by anonymous public applications. */
export interface PublicTenantResolver {
  resolveHostname(hostHeader: string | undefined): Promise<string | null>;
  /** PRC-L369: drop cached host mappings (one hostname, or all). */
  invalidate?(hostname?: string): void;
}

export interface PublicTenantResolverOptions {
  repository: TenantRepository;
  baseDomain: string;
  /** PRC-L369: per-replica host -> tenant cache TTL (default 30 s; 0 disables). */
  cacheTtlMs?: number;
  /** PRC-L369: bound on cached hostnames (default 1000, LRU). */
  cacheMaxEntries?: number;
  /** Clock (tests). */
  now?: () => number;
}

/** PRC-L369 defaults. */
export const PUBLIC_RESOLVER_CACHE_TTL_MS = 30_000;
export const PUBLIC_RESOLVER_CACHE_MAX_ENTRIES = 1000;

/**
 * PRC-L369: every live resolver in this process, so a domain change made through this process's
 * TenantService invalidates the host cache at once. Other replicas converge within the TTL;
 * tenant status (suspension) is never cached — it is re-read by primary key on every request.
 */
const liveResolvers = new Set<WeakRef<{ invalidate(hostname?: string): void }>>();

/** PRC-L369: invalidate cached host mappings in every resolver of this process. */
export function invalidatePublicHostCaches(hostname?: string): void {
  const normalized = hostname ? (normalizePublicHostname(hostname) ?? undefined) : undefined;
  for (const ref of liveResolvers) {
    const resolver = ref.deref();
    if (resolver) resolver.invalidate(normalized);
    else liveResolvers.delete(ref);
  }
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
  cacheTtlMs = PUBLIC_RESOLVER_CACHE_TTL_MS,
  cacheMaxEntries = PUBLIC_RESOLVER_CACHE_MAX_ENTRIES,
  now = Date.now,
}: PublicTenantResolverOptions): PublicTenantResolver {
  const normalizedBaseDomain = normalizePublicHostname(baseDomain);
  if (!normalizedBaseDomain || normalizedBaseDomain.includes(':')) {
    throw new TypeError('Public tenant baseDomain must be a valid DNS hostname');
  }

  // PRC-L369: hostname -> candidate tenant id (null = no mapping), bounded LRU with a short TTL.
  const cache = new Map<string, { tenantId: string | null; expiresAt: number }>();
  const cacheGet = (hostname: string): { tenantId: string | null } | undefined => {
    const entry = cache.get(hostname);
    if (!entry) return undefined;
    if (entry.expiresAt <= now()) {
      cache.delete(hostname);
      return undefined;
    }
    cache.delete(hostname);
    cache.set(hostname, entry);
    return entry;
  };
  const cacheSet = (hostname: string, tenantId: string | null) => {
    if (cacheTtlMs <= 0) return;
    cache.delete(hostname);
    while (cache.size >= cacheMaxEntries) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    cache.set(hostname, { tenantId, expiresAt: now() + cacheTtlMs });
  };

  /** Index-backed host -> candidate tenant id (no status decision here). */
  const lookupCandidate = async (hostname: string): Promise<string | null> => {
    if (hostname.endsWith(`.${normalizedBaseDomain}`)) {
      const slug = hostname.slice(0, -(normalizedBaseDomain.length + 1));
      if (!DNS_LABEL.test(slug) || slug.includes('.')) return null;
      const tenant = repository.findTenantBySlugExact
        ? await repository.findTenantBySlugExact(slug)
        : await repository.findTenantBySlug(slug);
      return tenant && TENANT_UUID.test(tenant.id) ? tenant.id : null;
    }
    const rows = repository.findDomainsByHostname
      ? await repository.findDomainsByHostname(hostname)
      : [await repository.findDomainByName(hostname)].filter(
          (d): d is NonNullable<typeof d> => d !== null,
        );
    const verified = rows.find((d) => d.verified);
    return verified ? verified.tenantId : null;
  };

  const resolver = {
    invalidate(hostname?: string): void {
      if (hostname) cache.delete(hostname);
      else cache.clear();
    },
    async resolveHostname(hostHeader: string | undefined): Promise<string | null> {
      const hostname = normalizePublicHostname(hostHeader);
      if (!hostname) return null;
      if (hostname === normalizedBaseDomain) return null;

      let candidate: string | null;
      const cached = cacheGet(hostname);
      if (cached) {
        candidate = cached.tenantId;
      } else {
        candidate = await lookupCandidate(hostname);
        cacheSet(hostname, candidate);
      }
      if (!candidate) return null;
      // Status is re-read on every request (primary-key lookup), so a suspension or
      // decommission takes effect immediately on every replica, cache or not.
      const tenant = await repository.findTenantById(candidate);
      return isActiveCanonicalTenant(tenant) ? tenant.id : null;
    },
  };
  liveResolvers.add(new WeakRef(resolver));
  return resolver;
}
