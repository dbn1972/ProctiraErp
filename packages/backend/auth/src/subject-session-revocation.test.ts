/**
 * PRC-M027: per-subject revocation entries (SCIM deprovision) in memory and Redis.
 */
import { describe, expect, it } from 'vitest';

import {
  createSubjectSessionRevocationStore,
  isSubjectTokenRevoked,
  MemorySubjectSessionRevocationStore,
  RedisSubjectSessionRevocationStore,
  type SubjectSessionRevocationStore,
} from './subject-session-revocation.js';

class FakeRedis {
  readonly values = new Map<string, string>();
  async set(key: string, value: string): Promise<string | null> {
    this.values.set(key, value);
    return 'OK';
  }
  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }
}

const TENANT = 'tenant-a';

describe.each<[string, () => SubjectSessionRevocationStore]>([
  ['memory', () => new MemorySubjectSessionRevocationStore()],
  ['redis', () => new RedisSubjectSessionRevocationStore(new FakeRedis())],
])('subject session revocation (%s)', (_name, make) => {
  it('suspends every token, then keeps only pre-deprovision tokens dead after restore', async () => {
    const store = make();
    expect(await store.subjectRevocation(TENANT, 'ann@school.org')).toBeNull();
    await store.revokeSubject(TENANT, 'Ann@School.org ', 1_000, 60);
    const suspended = await store.subjectRevocation(TENANT, 'ann@school.org');
    expect(suspended).toEqual({ revokedAt: 1_000, suspended: true });
    expect(isSubjectTokenRevoked(2_000, suspended)).toBe(true);

    await store.restoreSubject(TENANT, 'ann@school.org', 60);
    const restored = await store.subjectRevocation(TENANT, 'ann@school.org');
    expect(restored).toEqual({ revokedAt: 1_000, suspended: false });
    expect(isSubjectTokenRevoked(999, restored)).toBe(true);
    expect(isSubjectTokenRevoked(1_000, restored)).toBe(true);
    expect(isSubjectTokenRevoked(1_001, restored)).toBe(false);
    expect(isSubjectTokenRevoked(undefined, restored)).toBe(true);
    // Another tenant with the same email is a different subject.
    expect(await store.subjectRevocation('tenant-b', 'ann@school.org')).toBeNull();
  });

  it('restore without a prior deprovision records nothing', async () => {
    const store = make();
    await store.restoreSubject(TENANT, 'bob@school.org', 60);
    expect(await store.subjectRevocation(TENANT, 'bob@school.org')).toBeNull();
  });
});

describe('createSubjectSessionRevocationStore', () => {
  it('requires Redis in production', () => {
    expect(() => createSubjectSessionRevocationStore({ NODE_ENV: 'production' })).toThrow(
      /PRC-M027/,
    );
    expect(
      createSubjectSessionRevocationStore({ NODE_ENV: 'production', redis: new FakeRedis() })
        .shared,
    ).toBe(true);
    expect(createSubjectSessionRevocationStore({ NODE_ENV: 'test' }).shared).toBe(false);
  });
});
