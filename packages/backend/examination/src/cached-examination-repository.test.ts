import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CacheClient } from '@proctira/cache';

import { CachedExaminationRepository } from './cached-examination-repository.js';
import { InMemoryExaminationRepository } from './in-memory-repository.js';

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

const examinationInput = {
  id: 'exam-1',
  tenantId: TENANT_ID,
  name: 'Final Exam',
  code: 'FIN-2024',
  description: null,
  academicPeriodId: 'period-1',
  startDate: '2024-06-01',
  endDate: '2024-06-15',
  status: 'SCHEDULED' as const,
  subjects: [],
  centers: [],
  sessions: [],
  gradingSchemes: [],
};

describe('CachedExaminationRepository', () => {
  let delegate: InMemoryExaminationRepository;
  let cache: CacheClient;
  let repository: CachedExaminationRepository;

  beforeEach(() => {
    delegate = new InMemoryExaminationRepository();
    cache = createJsonRoundTripCache();
    repository = new CachedExaminationRepository(delegate, cache);
  });

  it('calls the delegate once and revives Date fields on cache hit', async () => {
    const created = await delegate.create(examinationInput);
    const spy = vi.spyOn(delegate, 'findById');

    const first = await repository.findById('exam-1', TENANT_ID);
    const second = await repository.findById('exam-1', TENANT_ID);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(first!.createdAt.toISOString()).toBe(created.createdAt.toISOString());
    expect(second!.createdAt).toBeInstanceOf(Date);
    expect(second!.updatedAt).toBeInstanceOf(Date);
    expect(second!.updatedAt.toISOString()).toBe(created.updatedAt.toISOString());
  });

  it('passes null through on miss without caching it', async () => {
    const spy = vi.spyOn(delegate, 'findById');

    const first = await repository.findById('missing', TENANT_ID);
    const second = await repository.findById('missing', TENANT_ID);

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('invalidates the cache entry on update', async () => {
    await delegate.create(examinationInput);
    const spy = vi.spyOn(delegate, 'findById');

    await repository.findById('exam-1', TENANT_ID);
    await repository.update('exam-1', TENANT_ID, { name: 'Updated Exam' });
    spy.mockClear();

    const afterUpdate = await repository.findById('exam-1', TENANT_ID);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(afterUpdate!.name).toBe('Updated Exam');
    expect(afterUpdate!.createdAt).toBeInstanceOf(Date);
  });
});
