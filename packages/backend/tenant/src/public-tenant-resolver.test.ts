import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryTenantRepository } from './in-memory-repository.js';
import { createPublicTenantResolver, normalizePublicHostname } from './public-tenant-resolver.js';
import type { TenantEntity } from './tenant-repository.js';

function tenant(id: string, slug: string, status: TenantEntity['status'] = 'active') {
  return {
    id,
    name: slug,
    slug,
    status,
    plan: null,
    region: null,
    config: {},
    suspendedAt: null,
    suspendedReason: null,
    decommissionedAt: null,
    dataRetentionUntil: null,
    legalHold: false,
  } as Omit<TenantEntity, 'createdAt' | 'updatedAt'>;
}

describe('trusted public tenant resolver', () => {
  let repository: InMemoryTenantRepository;

  beforeEach(() => {
    repository = new InMemoryTenantRepository();
  });

  it('returns the canonical UUID for an active canonical slug host', async () => {
    const id = randomUUID();
    await repository.createTenant(tenant(id, 'north-district'));
    const resolver = createPublicTenantResolver({ repository, baseDomain: 'apply.example.edu' });

    await expect(resolver.resolveHostname('NORTH-DISTRICT.apply.example.edu:443')).resolves.toBe(
      id,
    );
  });

  it('returns the canonical UUID only for a verified custom domain', async () => {
    const id = randomUUID();
    await repository.createTenant(tenant(id, 'north-district'));
    await repository.addDomain({
      id: randomUUID(),
      tenantId: id,
      domain: 'admissions.north.example',
      primary: true,
      verified: true,
      createdAt: new Date(),
    });
    const resolver = createPublicTenantResolver({ repository, baseDomain: 'apply.example.edu' });

    await expect(resolver.resolveHostname('admissions.north.example')).resolves.toBe(id);
  });

  it('denies unknown, unverified, suspended, base, nested, local, and missing hosts', async () => {
    const activeId = randomUUID();
    const suspendedId = randomUUID();
    await repository.createTenant(tenant(activeId, 'active-school'));
    await repository.createTenant(tenant(suspendedId, 'suspended-school', 'suspended'));
    await repository.addDomain({
      id: randomUUID(),
      tenantId: activeId,
      domain: 'unverified.example.edu',
      primary: false,
      verified: false,
      createdAt: new Date(),
    });
    const resolver = createPublicTenantResolver({ repository, baseDomain: 'apply.example.edu' });

    for (const host of [
      undefined,
      'unknown.apply.example.edu',
      'unverified.example.edu',
      'suspended-school.apply.example.edu',
      'apply.example.edu',
      'nested.active-school.apply.example.edu',
      'localhost:3000',
      '127.0.0.1',
    ]) {
      await expect(resolver.resolveHostname(host)).resolves.toBeNull();
    }
  });

  it('reserves canonical base-domain hosts even if a conflicting custom domain exists', async () => {
    const canonicalId = randomUUID();
    const conflictingId = randomUUID();
    await repository.createTenant(tenant(canonicalId, 'school'));
    await repository.createTenant(tenant(conflictingId, 'other'));
    await repository.addDomain({
      id: randomUUID(),
      tenantId: conflictingId,
      domain: 'school.apply.example.edu',
      primary: true,
      verified: true,
      createdAt: new Date(),
    });
    const resolver = createPublicTenantResolver({ repository, baseDomain: 'apply.example.edu' });

    await expect(resolver.resolveHostname('school.apply.example.edu')).resolves.toBe(canonicalId);
  });
});

describe('normalizePublicHostname', () => {
  it('normalizes case, a terminal dot, and a numeric port', () => {
    expect(normalizePublicHostname('Admissions.Example.EDU.:443')).toBe('admissions.example.edu');
  });

  it.each([
    '',
    'a.example,b.example',
    'user@example.edu',
    'example.edu/path',
    'example.edu?x=1',
    'bad label.example.edu',
    '[::1]:3000',
  ])('rejects unsafe Host value %j', (value) => {
    expect(normalizePublicHostname(value)).toBeNull();
  });
});
