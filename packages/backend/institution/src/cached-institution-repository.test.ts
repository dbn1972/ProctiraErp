import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CacheClient } from '@proctira/cache';

import { CachedInstitutionRepository } from './cached-institution-repository.js';
import { InMemoryInstitutionRepository } from './in-memory-repository.js';

const TENANT_ID = 'tenant-001';

function createJsonRoundTripCache(): CacheClient {
  const store = new Map<string, string>();
  const mockRedis = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (...keys: string[]) => {
      let count = 0;
      for (const key of keys) {
        if (store.delete(key)) count++;
      }
      return count;
    }),
    scan: vi.fn(async () => ['0', []] as [string, string[]]),
    ping: vi.fn(async () => 'PONG'),
    quit: vi.fn(async () => 'OK'),
  };
  return new CacheClient({ redis: mockRedis as unknown as import('ioredis').default });
}

const institutionInput = {
  id: 'inst-1',
  tenantId: TENANT_ID,
  name: 'Test School',
  code: 'SCH-001',
  areaId: 'area-1',
  typeId: 'type-1',
  sectorId: 'sector-1',
  ownershipId: 'owner-1',
  status: 'ACTIVE' as const,
  latitude: null,
  longitude: null,
  address: null,
  contactPhone: null,
  contactEmail: null,
  deactivationReason: null,
};

describe('CachedInstitutionRepository', () => {
  let delegate: InMemoryInstitutionRepository;
  let cache: CacheClient;
  let repository: CachedInstitutionRepository;

  beforeEach(() => {
    delegate = new InMemoryInstitutionRepository();
    cache = createJsonRoundTripCache();
    repository = new CachedInstitutionRepository(delegate, cache);
  });

  it('calls the delegate once and revives Date fields on findById cache hit', async () => {
    const created = await delegate.create(institutionInput);
    const spy = vi.spyOn(delegate, 'findById');

    const first = await repository.findById('inst-1', TENANT_ID);
    const second = await repository.findById('inst-1', TENANT_ID);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(first!.createdAt.toISOString()).toBe(created.createdAt.toISOString());
    expect(second!.createdAt).toBeInstanceOf(Date);
    expect(second!.updatedAt).toBeInstanceOf(Date);
  });

  it('revives Date fields in cached list results', async () => {
    const created = await delegate.create(institutionInput);
    const spy = vi.spyOn(delegate, 'list');
    const pagination = { page: 1, pageSize: 10 };

    const first = await repository.list(TENANT_ID, {}, pagination);
    const second = await repository.list(TENANT_ID, {}, pagination);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(first.data[0]!.createdAt.toISOString()).toBe(created.createdAt.toISOString());
    expect(second.data[0]!.createdAt).toBeInstanceOf(Date);
    expect(second.data[0]!.updatedAt).toBeInstanceOf(Date);
  });

  it('passes null through on findById miss without caching it', async () => {
    const spy = vi.spyOn(delegate, 'findById');

    const first = await repository.findById('missing', TENANT_ID);
    const second = await repository.findById('missing', TENANT_ID);

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('invalidates the cache entry on update', async () => {
    await delegate.create(institutionInput);
    const spy = vi.spyOn(delegate, 'findById');

    await repository.findById('inst-1', TENANT_ID);
    await repository.update('inst-1', TENANT_ID, { name: 'Updated School' });
    spy.mockClear();

    const afterUpdate = await repository.findById('inst-1', TENANT_ID);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(afterUpdate!.name).toBe('Updated School');
    expect(afterUpdate!.createdAt).toBeInstanceOf(Date);
  });
});
