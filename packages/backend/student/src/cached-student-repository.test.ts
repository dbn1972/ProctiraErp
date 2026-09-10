import { describe, expect, it, vi } from 'vitest';

import type { CacheClient } from '@proctira/cache';

import { CachedStudentRepository } from './cached-student-repository.js';
import type { StudentEntity, StudentRepository } from './student-repository.js';

const TENANT = 'tenant-a';

function entity(): StudentEntity {
  return {
    id: 'stu-1',
    tenantId: TENANT,
    firstName: 'Ada',
    lastName: 'Lovelace',
    dateOfBirth: '2012-05-01',
    gender: 'female',
    nationalId: null,
    nationality: null,
    contacts: [],
    guardians: [],
    identityDocuments: [],
    customData: {},
    createdAt: new Date('2026-09-01T10:00:00.000Z'),
    updatedAt: new Date('2026-09-02T11:00:00.000Z'),
  };
}

/**
 * Mirrors the real CacheClient: values round-trip through JSON, so a cache hit
 * hands back ISO strings where the delegate returned Date objects.
 */
function jsonCache(): { cache: CacheClient; store: Map<string, string> } {
  const store = new Map<string, string>();
  const cache = {
    async getOrSet<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
      const hit = store.get(key);
      if (hit !== undefined) return JSON.parse(hit) as T;
      const value = await fetcher();
      store.set(key, JSON.stringify(value));
      return value;
    },
    async del(key: string) {
      store.delete(key);
      return 1;
    },
  } as unknown as CacheClient;
  return { cache, store };
}

describe('CachedStudentRepository', () => {
  it('revives Date fields on a cache hit so formatters can call toISOString()', async () => {
    const delegate = {
      findById: vi.fn(async () => entity()),
    } as unknown as StudentRepository;
    const { cache } = jsonCache();
    const repo = new CachedStudentRepository(delegate, cache);

    const first = await repo.findById('stu-1', TENANT);
    const second = await repo.findById('stu-1', TENANT);

    expect(delegate.findById).toHaveBeenCalledTimes(1);
    expect(first?.createdAt).toBeInstanceOf(Date);
    expect(second?.createdAt).toBeInstanceOf(Date);
    expect(second?.updatedAt).toBeInstanceOf(Date);
    expect(second?.createdAt.toISOString()).toBe('2026-09-01T10:00:00.000Z');
    expect(second?.updatedAt.toISOString()).toBe('2026-09-02T11:00:00.000Z');
  });

  it('passes through null for unknown students', async () => {
    const delegate = {
      findById: vi.fn(async () => null),
    } as unknown as StudentRepository;
    const { cache } = jsonCache();
    const repo = new CachedStudentRepository(delegate, cache);

    expect(await repo.findById('missing', TENANT)).toBeNull();
  });

  it('invalidates the cached entry on update', async () => {
    const delegate = {
      findById: vi.fn(async () => entity()),
      update: vi.fn(async () => entity()),
    } as unknown as StudentRepository;
    const { cache, store } = jsonCache();
    const repo = new CachedStudentRepository(delegate, cache);

    await repo.findById('stu-1', TENANT);
    expect(store.size).toBe(1);
    await repo.update('stu-1', TENANT, { firstName: 'Augusta' });
    expect(store.size).toBe(0);
  });
});
