/**
 * PRC-L369 — the public resolver must not scan every tenant/domain document per anonymous
 * request: index-backed lookups, a bounded short-TTL per-replica cache, and immediate
 * enforcement of suspension and domain removal.
 */
import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryTenantRepository } from './in-memory-repository.js';
import { createPublicTenantResolver } from './public-tenant-resolver.js';
import type { TenantEntity } from './tenant-repository.js';
import { TenantService } from './tenant-service.js';

const BASE = 'apply.example.edu';

function tenant(id: string, slug: string): Omit<TenantEntity, 'createdAt' | 'updatedAt'> {
  return {
    id,
    name: slug,
    slug,
    status: 'active',
    plan: null,
    region: null,
    config: {} as TenantEntity['config'],
    suspendedAt: null,
    suspendedReason: null,
    decommissionedAt: null,
    dataRetentionUntil: null,
    legalHold: false,
  };
}

function verifiedDomain(tenantId: string, domain: string) {
  const verifiedAt = new Date();
  return {
    id: randomUUID(),
    tenantId,
    domain,
    primary: true,
    verified: true,
    verifiedAt,
    verificationExpiresAt: new Date(verifiedAt.getTime() + 30 * 24 * 3600 * 1000),
    createdAt: new Date(),
  };
}

describe('PRC-L369: cached, index-backed public tenant resolution', () => {
  let repository: InMemoryTenantRepository;
  let tenantId: string;

  beforeEach(async () => {
    repository = new InMemoryTenantRepository();
    tenantId = randomUUID();
    await repository.createTenant(tenant(tenantId, 'north-district'));
  });

  it('never scans all domains and looks a hostname up once per TTL', async () => {
    await repository.addDomain(verifiedDomain(tenantId, 'admissions.north.example'));
    const scan = vi.spyOn(repository, 'findDomainByName');
    const resolver = createPublicTenantResolver({ repository, baseDomain: BASE });
    for (let i = 0; i < 20; i += 1) {
      await expect(resolver.resolveHostname('admissions.north.example')).resolves.toBe(tenantId);
    }
    expect(scan).not.toHaveBeenCalled();
    expect(repository.hostnameLookups).toBe(1);
  });

  it('uses the exact slug index, not the slug scan, for canonical hosts', async () => {
    const scan = vi.spyOn(repository, 'findTenantBySlug');
    const exact = vi.spyOn(repository, 'findTenantBySlugExact');
    const resolver = createPublicTenantResolver({ repository, baseDomain: BASE });
    await resolver.resolveHostname(`north-district.${BASE}`);
    await resolver.resolveHostname(`north-district.${BASE}`);
    expect(exact).toHaveBeenCalledTimes(1);
    expect(scan).not.toHaveBeenCalled();
  });

  it('a suspension is enforced immediately even with a warm cache', async () => {
    await repository.addDomain(verifiedDomain(tenantId, 'admissions.north.example'));
    const resolver = createPublicTenantResolver({ repository, baseDomain: BASE });
    await expect(resolver.resolveHostname('admissions.north.example')).resolves.toBe(tenantId);
    await repository.updateTenant(tenantId, { status: 'suspended' });
    await expect(resolver.resolveHostname('admissions.north.example')).resolves.toBeNull();
    await expect(resolver.resolveHostname(`north-district.${BASE}`)).resolves.toBeNull();
  });

  it('removing a domain through TenantService stops resolution at once', async () => {
    const domain = verifiedDomain(tenantId, 'admissions.north.example');
    await repository.addDomain(domain);
    const resolver = createPublicTenantResolver({ repository, baseDomain: BASE });
    await expect(resolver.resolveHostname('admissions.north.example')).resolves.toBe(tenantId);
    await new TenantService(repository).removeDomain(tenantId, domain.id);
    await expect(resolver.resolveHostname('admissions.north.example')).resolves.toBeNull();
  });

  it('entries expire after the TTL and the cache is bounded', async () => {
    let clock = 1_000_000;
    await repository.addDomain(verifiedDomain(tenantId, 'a.north.example'));
    const resolver = createPublicTenantResolver({
      repository,
      baseDomain: BASE,
      cacheTtlMs: 1000,
      cacheMaxEntries: 2,
      now: () => clock,
    });
    await resolver.resolveHostname('a.north.example');
    await resolver.resolveHostname('a.north.example');
    expect(repository.hostnameLookups).toBe(1);
    clock += 1001;
    await resolver.resolveHostname('a.north.example');
    expect(repository.hostnameLookups).toBe(2);
    // Two other hosts evict the first (LRU bound 2).
    await resolver.resolveHostname('b.unknown.example');
    await resolver.resolveHostname('c.unknown.example');
    await resolver.resolveHostname('a.north.example');
    expect(repository.hostnameLookups).toBe(5);
  });
});
