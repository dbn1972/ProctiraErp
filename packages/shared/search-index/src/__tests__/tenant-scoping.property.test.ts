/**
 * Property tests mirroring tenant-isolation gate Category 5 (search trimming).
 */

import { describe, expect, it, beforeEach } from 'vitest';
import * as fc from 'fast-check';

import { TenantScopedSearchIndex } from '../adapters/in-memory-search-index.js';

const entityNameArb = fc.string({ minLength: 2, maxLength: 24 }).filter((s) => s.trim().length >= 2);

const distinctTenantPairArb = fc
  .tuple(fc.uuid(), fc.uuid())
  .filter(([a, b]) => a !== b)
  .map(([tenantA, tenantB]) => ({ tenantA, tenantB }));

function assertNoForeignTenant(
  tenantId: string,
  hits: Array<{ tenantId: string }>,
): void {
  for (const hit of hits) {
    expect(hit.tenantId).toBe(tenantId);
  }
}

describe('TenantScopedSearchIndex — tenant trimming', () => {
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
          assertNoForeignTenant(tenantA, hitsA);
          expect(hitsA).toHaveLength(namesA.length);

          const hitsB = index.search(tenantB, term);
          assertNoForeignTenant(tenantB, hitsB);
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
});
