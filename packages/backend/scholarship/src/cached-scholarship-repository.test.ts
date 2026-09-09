import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CacheClient } from '@proctira/cache';

import { CachedScholarshipRepository } from './cached-scholarship-repository.js';
import { InMemoryScholarshipRepository } from './in-memory-repository.js';

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

const programInput = {
  id: 'prog-1',
  tenantId: TENANT_ID,
  name: 'Merit Scholarship',
  description: null,
  applicationStartDate: '2024-01-01',
  applicationEndDate: '2024-06-30',
  totalSlots: 10,
  usedSlots: 0,
  amountPerRecipient: 5000,
  currency: 'USD',
  disbursementFrequency: 'annual' as const,
  eligibility: { minGPA: 3.0, requiredDocuments: ['transcript'] },
  status: 'open' as const,
  academicPeriodId: null,
  fundingSourceId: null,
};

describe('CachedScholarshipRepository', () => {
  let delegate: InMemoryScholarshipRepository;
  let cache: CacheClient;
  let repository: CachedScholarshipRepository;

  beforeEach(() => {
    delegate = new InMemoryScholarshipRepository();
    cache = createJsonRoundTripCache();
    repository = new CachedScholarshipRepository(delegate, cache);
  });

  it('calls the delegate once and revives Date fields on cache hit', async () => {
    const created = await delegate.createProgram(programInput);
    const spy = vi.spyOn(delegate, 'findProgramById');

    const first = await repository.findProgramById('prog-1', TENANT_ID);
    const second = await repository.findProgramById('prog-1', TENANT_ID);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(first!.createdAt.toISOString()).toBe(created.createdAt.toISOString());
    expect(second!.createdAt).toBeInstanceOf(Date);
    expect(second!.updatedAt).toBeInstanceOf(Date);
    expect(second!.updatedAt.toISOString()).toBe(created.updatedAt.toISOString());
  });

  it('passes null through on miss without caching it', async () => {
    const spy = vi.spyOn(delegate, 'findProgramById');

    const first = await repository.findProgramById('missing', TENANT_ID);
    const second = await repository.findProgramById('missing', TENANT_ID);

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('invalidates the cache entry on update', async () => {
    await delegate.createProgram(programInput);
    const spy = vi.spyOn(delegate, 'findProgramById');

    await repository.findProgramById('prog-1', TENANT_ID);
    await repository.updateProgram('prog-1', TENANT_ID, { name: 'Updated Scholarship' });
    spy.mockClear();

    const afterUpdate = await repository.findProgramById('prog-1', TENANT_ID);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(afterUpdate!.name).toBe('Updated Scholarship');
    expect(afterUpdate!.createdAt).toBeInstanceOf(Date);
  });
});
