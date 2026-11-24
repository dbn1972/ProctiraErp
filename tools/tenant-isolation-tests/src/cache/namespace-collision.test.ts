/**
 * Category 6 — Cache namespace collision tests.
 *
 * PRC-M614: drives the product cache (`@proctira/cache`): the key builders
 * (`tenantKey`, `listKey`, `configKey`) and `CacheClient` with tenant-scope
 * enforcement on, over an in-process Redis stand-in. It verifies that:
 *   • the same logical key never returns another tenant's value;
 *   • invalidating one tenant's keys cannot wipe another tenant;
 *   • raw keys leaving the cache always carry their tenant id;
 *   • unscoped keys and tenant-wildcard patterns are refused.
 *
 * Charter: Section 39 (Tenant Isolation Verification)
 * Validates: Requirements 4.7, 24.6 (tenant-namespaced cache)
 */
import {
  CacheClient,
  type CacheClientOptions,
  configKey,
  listKey,
  tenantKey,
} from '@proctira/cache';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  assertContainsTenant,
  assertNoForeignTenantInString,
  distinctTenantPairArb,
} from '../helpers/index.js';

/** In-process stand-in for the ioredis calls CacheClient makes. */
class FakeRedis {
  readonly store = new Map<string, string>();
  async get(key: string) {
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.store.set(key, value);
    return 'OK';
  }
  async del(...keys: string[]) {
    let removed = 0;
    for (const key of keys) if (this.store.delete(key)) removed += 1;
    return removed;
  }
  async scan(_cursor: string, _match: 'MATCH', pattern: string) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    const matcher = new RegExp(`^${escaped}$`);
    return ['0', [...this.store.keys()].filter((key) => matcher.test(key))] as [string, string[]];
  }
}

function productCache() {
  const redis = new FakeRedis();
  const cache = new CacheClient({
    redis: redis as unknown as CacheClientOptions['redis'],
    requireTenantScope: true,
    defaultTtlSeconds: 60,
  });
  return { redis, cache };
}

const entityArb = fc.constantFrom('student', 'staff', 'institution', 'attendance');
const idArb = fc.stringMatching(/^[a-z0-9-]{1,24}$/);

describe('Category 6 — Cache Namespace Collision (product @proctira/cache)', () => {
  it('same logical key for two tenants never collides', async () => {
    await fc.assert(
      fc.asyncProperty(
        distinctTenantPairArb,
        entityArb,
        idArb,
        fc.string({ minLength: 1, maxLength: 80 }),
        fc.string({ minLength: 1, maxLength: 80 }),
        async ({ tenantA, tenantB }, entity, id, valueA, valueB) => {
          const { cache } = productCache();
          await cache.set(tenantKey(tenantA, entity, id), valueA);
          await cache.set(tenantKey(tenantB, entity, id), valueB);
          expect(await cache.get(tenantKey(tenantA, entity, id))).toBe(valueA);
          expect(await cache.get(tenantKey(tenantB, entity, id))).toBe(valueB);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('cache miss for tenant B when only tenant A populated the key', async () => {
    await fc.assert(
      fc.asyncProperty(
        distinctTenantPairArb,
        entityArb,
        idArb,
        async ({ tenantA, tenantB }, entity, id) => {
          const { cache } = productCache();
          await cache.set(tenantKey(tenantA, entity, id), { owner: tenantA });
          expect(await cache.get(tenantKey(tenantB, entity, id))).toBeNull();
          let fetched = 0;
          const value = await cache.getOrSet(
            listKey(tenantB, entity, 'page-1'),
            async () => {
              fetched += 1;
              return { owner: tenantB };
            },
            60,
          );
          expect(fetched).toBe(1);
          expect(value).toEqual({ owner: tenantB });
        },
      ),
      { numRuns: 100 },
    );
  });

  it('invalidating tenant A`s keys does not affect tenant B', async () => {
    await fc.assert(
      fc.asyncProperty(
        distinctTenantPairArb,
        fc.uniqueArray(idArb, { minLength: 1, maxLength: 6 }),
        fc.uniqueArray(idArb, { minLength: 1, maxLength: 6 }),
        async ({ tenantA, tenantB }, idsA, idsB) => {
          const { cache } = productCache();
          for (const id of idsA) await cache.set(tenantKey(tenantA, 'student', id), `a:${id}`);
          for (const id of idsB) await cache.set(tenantKey(tenantB, 'student', id), `b:${id}`);
          const removed = await cache.invalidatePattern(`t:${tenantA}:student:*`);
          expect(removed).toBe(idsA.length);
          for (const id of idsA)
            expect(await cache.get(tenantKey(tenantA, 'student', id))).toBeNull();
          for (const id of idsB) {
            expect(await cache.get(tenantKey(tenantB, 'student', id))).toBe(`b:${id}`);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it('every raw cache key carries its tenant id and never the other tenant`s id', async () => {
    await fc.assert(
      fc.asyncProperty(distinctTenantPairArb, idArb, async ({ tenantA, tenantB }, id) => {
        const { redis, cache } = productCache();
        await cache.set(tenantKey(tenantA, 'student', id), 'a');
        await cache.set(tenantKey(tenantB, 'student', id), 'b');
        await cache.set(configKey(tenantA, 'grading-scale'), 'a');
        const rawKeys = [...redis.store.keys()];
        expect(rawKeys).toHaveLength(3);
        for (const key of rawKeys) {
          const owner = key.includes(tenantA) ? tenantA : tenantB;
          const other = owner === tenantA ? tenantB : tenantA;
          assertContainsTenant('cache:key', owner, key);
          assertNoForeignTenantInString('cache:key', owner, key, [other]);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('the key builders match the documented formats and refuse a missing tenant', () => {
    fc.assert(
      fc.property(fc.uuid(), entityArb, idArb, (tenantId, entity, id) => {
        expect(tenantKey(tenantId, entity, id)).toBe(`t:${tenantId}:${entity}:${id}`);
        expect(listKey(tenantId, entity, id)).toBe(`lst:${tenantId}:${entity}:${id}`);
        expect(configKey(tenantId, entity)).toBe(`cfg:${tenantId}:${entity}`);
      }),
      { numRuns: 100 },
    );
    expect(() => tenantKey('', 'student', '1')).toThrow();
    expect(() => tenantKey('  ', 'student', '1')).toThrow();
  });

  it('refuses unscoped keys and tenant-wildcard invalidation', async () => {
    const { redis, cache } = productCache();
    await cache.set(tenantKey('00000000-0000-4000-8000-0000000000a1', 'student', '1'), 'a');
    await cache.set(tenantKey('00000000-0000-4000-8000-0000000000b2', 'student', '1'), 'b');
    await expect(cache.get('student:1')).rejects.toThrow();
    await expect(cache.set('student:1', 'x')).rejects.toThrow();
    await expect(cache.invalidatePattern('t:*:student:*')).rejects.toThrow();
    expect(redis.store.size).toBe(2);
  });
});
