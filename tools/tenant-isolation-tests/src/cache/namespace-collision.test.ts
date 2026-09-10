/**
 * Category 6 — Cache namespace collision tests.
 *
 * Verifies that Redis-style cache keys are always namespaced per tenant
 * (`tenant:{tenantId}:{key}`) so that:
 *   • the same logical key never returns another tenant's value;
 *   • flushing one tenant cannot wipe another tenant;
 *   • raw keys leaving the cache always carry their tenant id.
 *
 * Charter: Section 39 (Tenant Isolation Verification)
 * Validates: Requirements 4.7, 24.6 (tenant-namespaced cache)
 */

import { beforeEach, describe, expect, it } from 'vitest';
import * as fc from 'fast-check';

import {
  TenantNamespacedCache,
  assertContainsTenant,
  assertNoForeignTenantInString,
  cacheKeyArb,
  distinctTenantPairArb,
} from '../helpers/index.js';

describe('Category 6 — Cache Namespace Collision', () => {
  let cache: TenantNamespacedCache;

  beforeEach(() => {
    cache = new TenantNamespacedCache();
  });

  it('same logical key for two tenants never collides', () => {
    fc.assert(
      fc.property(
        distinctTenantPairArb,
        cacheKeyArb,
        fc.string({ minLength: 1, maxLength: 80 }),
        fc.string({ minLength: 1, maxLength: 80 }),
        ({ tenantA, tenantB }, key, valueA, valueB) => {
          cache.clear();
          cache.set(tenantA, key, valueA);
          cache.set(tenantB, key, valueB);

          expect(cache.get(tenantA, key)).toBe(valueA);
          expect(cache.get(tenantB, key)).toBe(valueB);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('cache miss for tenant B when only tenant A populated the key', () => {
    fc.assert(
      fc.property(
        distinctTenantPairArb,
        cacheKeyArb,
        fc.string({ minLength: 1, maxLength: 50 }),
        ({ tenantA, tenantB }, key, value) => {
          cache.clear();
          cache.set(tenantA, key, value);
          expect(cache.get(tenantB, key)).toBeUndefined();
          expect(cache.get(tenantA, key)).toBe(value);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('deleting tenant A`s key does not affect tenant B', () => {
    fc.assert(
      fc.property(
        distinctTenantPairArb,
        cacheKeyArb,
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        ({ tenantA, tenantB }, key, valueA, valueB) => {
          cache.clear();
          cache.set(tenantA, key, valueA);
          cache.set(tenantB, key, valueB);

          cache.delete(tenantA, key);
          expect(cache.get(tenantA, key)).toBeUndefined();
          expect(cache.get(tenantB, key)).toBe(valueB);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('flushing a tenant only removes that tenant`s keys', () => {
    fc.assert(
      fc.property(
        distinctTenantPairArb,
        fc.uniqueArray(cacheKeyArb, { minLength: 1, maxLength: 6 }),
        fc.uniqueArray(cacheKeyArb, { minLength: 1, maxLength: 6 }),
        ({ tenantA, tenantB }, keysA, keysB) => {
          cache.clear();

          for (const key of keysA) cache.set(tenantA, key, `a:${key}`);
          for (const key of keysB) cache.set(tenantB, key, `b:${key}`);

          const removed = cache.flushTenant(tenantA);
          expect(removed).toBe(keysA.length);

          for (const key of keysA) expect(cache.get(tenantA, key)).toBeUndefined();
          for (const key of keysB) expect(cache.get(tenantB, key)).toBe(`b:${key}`);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('every raw cache key carries its tenant id and never the other tenant`s id', () => {
    fc.assert(
      fc.property(distinctTenantPairArb, cacheKeyArb, ({ tenantA, tenantB }, key) => {
        cache.clear();
        cache.set(tenantA, key, 'a');
        cache.set(tenantB, key, 'b');

        const rawKeys = cache.rawKeys();
        expect(rawKeys).toHaveLength(2);
        const keyA = rawKeys.find((k) => k.includes(tenantA));
        const keyB = rawKeys.find((k) => k.includes(tenantB));
        expect(keyA).toBeDefined();
        expect(keyB).toBeDefined();

        assertContainsTenant('cache:key', tenantA, keyA!);
        assertContainsTenant('cache:key', tenantB, keyB!);
        assertNoForeignTenantInString('cache:key', tenantA, keyA!, [tenantB]);
        assertNoForeignTenantInString('cache:key', tenantB, keyB!, [tenantA]);
      }),
      { numRuns: 100 },
    );
  });

  it('the cache key builder is deterministic and matches the documented format', () => {
    fc.assert(
      fc.property(fc.uuid(), cacheKeyArb, (tenantId, key) => {
        expect(TenantNamespacedCache.buildKey(tenantId, key)).toBe(`tenant:${tenantId}:${key}`);
      }),
      { numRuns: 100 },
    );
  });
});
