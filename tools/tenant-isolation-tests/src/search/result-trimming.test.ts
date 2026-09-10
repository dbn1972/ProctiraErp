/**
 * Category 5 — Search result trimming tests.
 *
 * Verifies that the search index always trims results down to the requesting
 * tenant. The simulator deliberately stores documents from every tenant in
 * one index: tenant filtering is the only thing that prevents leaks.
 *
 * Charter: Section 39 (Tenant Isolation Verification)
 * Validates: Requirements 4.7, 24.5 (tenant-scoped search)
 */

import { beforeEach, describe, expect, it } from 'vitest';
import * as fc from 'fast-check';

import {
  TenantScopedSearchIndex,
  assertNoForeignTenant,
  distinctTenantPairArb,
  entityNameArb,
} from '../helpers/index.js';

describe('Category 5 — Search Result Trimming', () => {
  let index: TenantScopedSearchIndex;

  beforeEach(() => {
    index = new TenantScopedSearchIndex();
  });

  it('search results contain only documents from the requesting tenant', () => {
    fc.assert(
      fc.property(
        distinctTenantPairArb,
        fc.array(entityNameArb, { minLength: 1, maxLength: 5 }),
        fc.array(entityNameArb, { minLength: 1, maxLength: 5 }),
        ({ tenantA, tenantB }, namesA, namesB) => {
          index.clear();
          const term = 'school';

          namesA.forEach((n, i) =>
            index.index({ id: `a-${i}`, tenantId: tenantA, content: `${n} ${term}` }),
          );
          namesB.forEach((n, i) =>
            index.index({ id: `b-${i}`, tenantId: tenantB, content: `${n} ${term}` }),
          );

          const hitsA = index.search(tenantA, term);
          assertNoForeignTenant('search:hit', tenantA, hitsA);
          expect(hitsA).toHaveLength(namesA.length);

          const hitsB = index.search(tenantB, term);
          assertNoForeignTenant('search:hit', tenantB, hitsB);
          expect(hitsB).toHaveLength(namesB.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('terms unique to tenant B are invisible to tenant A', () => {
    fc.assert(
      fc.property(distinctTenantPairArb, entityNameArb, ({ tenantA, tenantB }, term) => {
        index.clear();
        index.index({ id: 'b-1', tenantId: tenantB, content: term });
        expect(index.search(tenantA, term)).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });

  it('tenant A result count is independent of tenant B index growth', () => {
    fc.assert(
      fc.property(
        distinctTenantPairArb,
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 1, max: 8 }),
        ({ tenantA, tenantB }, countA, countB) => {
          index.clear();
          const term = 'institution';

          for (let i = 0; i < countA; i += 1) {
            index.index({ id: `a-${i}`, tenantId: tenantA, content: `${term} ${i}` });
          }
          for (let i = 0; i < countB; i += 1) {
            index.index({ id: `b-${i}`, tenantId: tenantB, content: `${term} ${i}` });
          }

          expect(index.search(tenantA, term)).toHaveLength(countA);

          // Adding more docs to tenant B must not move tenant A's result count.
          for (let i = countB; i < countB + 5; i += 1) {
            index.index({
              id: `b-${i}`,
              tenantId: tenantB,
              content: `${term} extra ${i}`,
            });
          }
          expect(index.search(tenantA, term)).toHaveLength(countA);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('search across multiple tenants never returns documents from foreign tenants', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.tuple(entityNameArb, fc.uuid()), {
          minLength: 3,
          maxLength: 6,
          selector: ([, id]) => id,
        }),
        (entries) => {
          index.clear();
          const term = 'common-term';
          for (const [name, tenantId] of entries) {
            index.index({ id: `${tenantId}-1`, tenantId, content: `${name} ${term}` });
          }

          for (const [, tenantId] of entries) {
            const hits = index.search(tenantId, term);
            assertNoForeignTenant('search:multi', tenantId, hits);
            expect(hits.every((h) => h.id.startsWith(tenantId))).toBe(true);
          }
        },
      ),
      { numRuns: 30 },
    );
  });
});
