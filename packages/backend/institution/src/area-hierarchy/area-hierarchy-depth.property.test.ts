/**
 * Property-based tests for Area Hierarchy Depth Constraint.
 *
 * Property 9: Area Hierarchy Depth Constraint
 *
 * For any sequence of area node creation operations, the system rejects any
 * node that would exceed 10 levels of nesting depth.
 *
 * **Validates: Requirements 5.2**
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { BusinessRuleError, ConflictError, NotFoundError } from '@proctira/common';

import { AreaHierarchyService, MAX_AREA_DEPTH } from './area-hierarchy.service.js';
import type { AreaHierarchyDbClient } from './area-hierarchy.service.js';
import type { GeographicArea, Institution } from '@proctira/database';

const TENANT_ID = 'tenant-pbt-001';

// --- In-Memory Mock DB for Property Tests ---

/**
 * In-memory mock of the AreaHierarchyDbClient for property-based testing.
 * Faithfully simulates the nested set model and materialized path behavior.
 */
function createMockDb() {
  let areas: GeographicArea[] = [];
  let idCounter = 0;

  function generateId(): string {
    idCounter++;
    return `pbt-area-${String(idCounter).padStart(4, '0')}`;
  }

  function matchesWhere(area: GeographicArea, where: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(where)) {
      if (key === 'deletedAt' && value === null) {
        if (area.deletedAt !== null) return false;
        continue;
      }
      if (key === 'id' && typeof value === 'object' && value !== null && 'not' in value) {
        if (area.id === (value as { not: string }).not) return false;
        continue;
      }
      if (typeof value === 'object' && value !== null) {
        if ('startsWith' in value) {
          const str = (area as Record<string, unknown>)[key] as string;
          if (!str.startsWith((value as { startsWith: string }).startsWith)) return false;
          continue;
        }
        if ('gte' in value && 'lte' in (value as object)) {
          const num = (area as Record<string, unknown>)[key] as number;
          const v = value as { gte: number; lte: number };
          if (num < v.gte || num > v.lte) return false;
          continue;
        }
        if ('gte' in value) {
          const num = (area as Record<string, unknown>)[key] as number;
          if (num < (value as { gte: number }).gte) return false;
          continue;
        }
        if ('lte' in value) {
          const num = (area as Record<string, unknown>)[key] as number;
          if (num > (value as { lte: number }).lte) return false;
          continue;
        }
        if ('gt' in value) {
          const num = (area as Record<string, unknown>)[key] as number;
          if (num <= (value as { gt: number }).gt) return false;
          continue;
        }
        if ('in' in value) {
          const arr = (value as { in: string[] }).in;
          if (!arr.includes((area as Record<string, unknown>)[key] as string)) return false;
          continue;
        }
      }
      if ((area as Record<string, unknown>)[key] !== value) return false;
    }
    return true;
  }

  function filterAreas(where: Record<string, unknown>): GeographicArea[] {
    return areas.filter((a) => matchesWhere(a, where));
  }

  function sortAreas(
    list: GeographicArea[],
    orderBy: Record<string, unknown> | Record<string, unknown>[],
  ): GeographicArea[] {
    const sorted = [...list];
    const orderByObj = Array.isArray(orderBy) ? orderBy[0] : orderBy;
    if (!orderByObj) return sorted;
    const [field, dir] = Object.entries(orderByObj)[0]!;
    sorted.sort((x, y) => {
      const xv = (x as Record<string, unknown>)[field] as number;
      const yv = (y as Record<string, unknown>)[field] as number;
      return dir === 'desc' ? yv - xv : xv - yv;
    });
    return sorted;
  }

  const db: AreaHierarchyDbClient & { getAreas: () => GeographicArea[]; clear: () => void } = {
    getAreas: () => [...areas],
    clear: () => {
      areas = [];
      idCounter = 0;
    },
    geographicArea: {
      findUnique: async (args: { where: { id: string } }) => {
        return areas.find((a) => a.id === args.where.id) ?? null;
      },

      findFirst: async (args: {
        where: Record<string, unknown>;
        orderBy?: Record<string, unknown> | Record<string, unknown>[];
      }) => {
        let filtered = filterAreas(args.where);
        if (args.orderBy) {
          filtered = sortAreas(filtered, args.orderBy);
        }
        return filtered[0] ?? null;
      },

      findMany: async (args: {
        where: Record<string, unknown>;
        orderBy?: Record<string, unknown> | Record<string, unknown>[];
      }) => {
        let filtered = filterAreas(args.where);
        if (args.orderBy) {
          filtered = sortAreas(filtered, args.orderBy);
        }
        return filtered;
      },

      create: async (args: { data: Record<string, unknown> }) => {
        const id = generateId();
        const now = new Date();
        const area: GeographicArea = {
          id,
          tenantId: args.data.tenantId as string,
          name: args.data.name as string,
          code: args.data.code as string,
          level: args.data.level as number,
          parentId: (args.data.parentId as string) ?? null,
          path: args.data.path as string,
          lft: args.data.lft as number,
          rgt: args.data.rgt as number,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        areas.push(area);
        return area;
      },

      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const idx = areas.findIndex((a) => a.id === args.where.id);
        if (idx === -1) throw new Error('Area not found');
        const area = areas[idx]!;
        for (const [key, value] of Object.entries(args.data)) {
          (area as Record<string, unknown>)[key] = value;
        }
        area.updatedAt = new Date();
        return area;
      },

      updateMany: async (args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        let count = 0;
        for (const area of areas) {
          if (matchesWhere(area, args.where)) {
            for (const [key, value] of Object.entries(args.data)) {
              if (typeof value === 'object' && value !== null && 'increment' in value) {
                (area as Record<string, unknown>)[key] =
                  ((area as Record<string, unknown>)[key] as number) +
                  (value as { increment: number }).increment;
              } else {
                (area as Record<string, unknown>)[key] = value;
              }
            }
            count++;
          }
        }
        return { count };
      },

      count: async (args: { where: Record<string, unknown> }) => {
        return filterAreas(args.where).length;
      },
    },

    institution: {
      findMany: async () => [] as Institution[],
      count: async () => 0,
    },
  };

  return db;
}

// --- Arbitraries ---

/**
 * Represents a "create area" operation in a sequence.
 * parentIndex: if null, create as root; otherwise, index into previously created areas.
 */
interface CreateAreaOp {
  name: string;
  code: string;
  parentIndex: number | null;
}

/**
 * Generates a sequence of area creation operations that builds a random tree.
 * Each new node picks a random existing node as its parent (or is a root).
 * Uses unique codes per operation to avoid ConflictError noise.
 */
const randomTreeOpsArb: fc.Arbitrary<CreateAreaOp[]> = fc
  .integer({ min: 5, max: 20 })
  .chain((numOps) => {
    return fc.array(fc.nat(), { minLength: numOps, maxLength: numOps }).map((parentSeeds) => {
      const ops: CreateAreaOp[] = [];
      for (let i = 0; i < parentSeeds.length; i++) {
        const parentSeed = parentSeeds[i]!;
        let parentIndex: number | null = null;
        if (i > 0) {
          // 80% chance of picking an existing parent, 20% chance of being a root
          if (parentSeed % 5 !== 0) {
            parentIndex = parentSeed % i;
          }
        }
        ops.push({
          name: `Area_${i}`,
          code: `CODE_${i}`,
          parentIndex,
        });
      }
      return ops;
    });
  });

/**
 * Generates a linear chain of a specific target depth (between 1 and 14).
 * This tests both valid chains (depth <= 10) and invalid chains (depth > 10).
 */
const linearChainArb: fc.Arbitrary<{ targetDepth: number; ops: CreateAreaOp[] }> = fc
  .integer({ min: 1, max: 14 })
  .map((targetDepth) => {
    const ops: CreateAreaOp[] = [];
    // First node is always a root
    ops.push({ name: 'Root', code: 'R0', parentIndex: null });
    // Each subsequent node is a child of the previous
    for (let i = 1; i < targetDepth; i++) {
      ops.push({ name: `Level${i}`, code: `L${i}`, parentIndex: i - 1 });
    }
    return { targetDepth, ops };
  });

// --- Property 9: Area Hierarchy Depth Constraint ---

describe('Property 9: Area Hierarchy Depth Constraint', () => {
  // **Validates: Requirements 5.2**

  it('no area node in the hierarchy ever exceeds MAX_AREA_DEPTH (10) levels after any sequence of creations', async () => {
    await fc.assert(
      fc.asyncProperty(randomTreeOpsArb, async (ops) => {
        const db = createMockDb();
        const service = new AreaHierarchyService(db);
        const createdIds: (string | null)[] = [];

        for (const op of ops) {
          // Resolve parent ID from index, skipping rejected/failed entries
          let parentId: string | undefined;
          if (op.parentIndex !== null && op.parentIndex < createdIds.length) {
            const resolvedId = createdIds[op.parentIndex];
            if (resolvedId !== null) {
              parentId = resolvedId;
            }
          }

          try {
            const area = await service.create({
              tenantId: TENANT_ID,
              name: op.name,
              code: op.code,
              parentId,
            });
            createdIds.push(area.id);

            // Invariant: any successfully created area must have level < MAX_AREA_DEPTH
            expect(area.level).toBeLessThan(MAX_AREA_DEPTH);
          } catch (error) {
            if (error instanceof BusinessRuleError) {
              // Expected: depth constraint violation — node was correctly rejected
              createdIds.push(null);
            } else if (error instanceof ConflictError) {
              // Duplicate code — not relevant to depth constraint
              createdIds.push(null);
            } else if (error instanceof NotFoundError) {
              // Parent not found — not relevant to depth constraint
              createdIds.push(null);
            } else {
              throw error;
            }
          }
        }

        // Final invariant: verify all areas in the store have level < MAX_AREA_DEPTH
        const allAreas = db.getAreas();
        for (const area of allAreas) {
          expect(area.level).toBeLessThan(MAX_AREA_DEPTH);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('a linear chain of exactly MAX_AREA_DEPTH levels succeeds, but the next level is rejected', async () => {
    await fc.assert(
      fc.asyncProperty(linearChainArb, async ({ targetDepth, ops }) => {
        const db = createMockDb();
        const service = new AreaHierarchyService(db);
        const createdIds: string[] = [];
        let rejectedAtLevel: number | null = null;

        for (let i = 0; i < ops.length; i++) {
          const op = ops[i]!;
          const parentId = op.parentIndex !== null ? createdIds[op.parentIndex] : undefined;

          try {
            const area = await service.create({
              tenantId: TENANT_ID,
              name: op.name,
              code: op.code,
              parentId,
            });
            createdIds.push(area.id);
          } catch (error) {
            if (error instanceof BusinessRuleError) {
              rejectedAtLevel = i;
              break; // Stop after first rejection in a linear chain
            } else {
              throw error;
            }
          }
        }

        if (targetDepth <= MAX_AREA_DEPTH) {
          // All operations should succeed — no rejection
          expect(rejectedAtLevel).toBeNull();
          // The deepest node should be at level targetDepth - 1 (0-indexed)
          const allAreas = db.getAreas();
          if (allAreas.length > 0) {
            const maxLevel = Math.max(...allAreas.map((a) => a.level));
            expect(maxLevel).toBe(targetDepth - 1);
          }
        } else {
          // The operation at index MAX_AREA_DEPTH should be rejected
          // (that's the 11th node, which would be at level 10)
          expect(rejectedAtLevel).toBe(MAX_AREA_DEPTH);
        }

        // Invariant: no stored area exceeds the depth limit
        const allAreas = db.getAreas();
        for (const area of allAreas) {
          expect(area.level).toBeLessThan(MAX_AREA_DEPTH);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('moving a subtree that would exceed MAX_AREA_DEPTH is rejected', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 8 }),
        fc.integer({ min: 2, max: 8 }),
        fc.nat(),
        async (chainADepth, chainBDepth, seed) => {
          const db = createMockDb();
          const service = new AreaHierarchyService(db);

          // Build chain A: root -> a1 -> a2 -> ... -> a(chainADepth-1)
          const chainAIds: string[] = [];
          for (let i = 0; i < chainADepth; i++) {
            const parentId = i > 0 ? chainAIds[i - 1] : undefined;
            const area = await service.create({
              tenantId: TENANT_ID,
              name: `ChainA_${seed}_${i}`,
              code: `A${seed}_${i}`,
              parentId,
            });
            chainAIds.push(area.id);
          }

          // Build chain B: root -> b1 -> b2 -> ... -> b(chainBDepth-1)
          const chainBIds: string[] = [];
          for (let i = 0; i < chainBDepth; i++) {
            const parentId = i > 0 ? chainBIds[i - 1] : undefined;
            const area = await service.create({
              tenantId: TENANT_ID,
              name: `ChainB_${seed}_${i}`,
              code: `B${seed}_${i}`,
              parentId,
            });
            chainBIds.push(area.id);
          }

          // Try to move chain B's root under chain A's deepest node.
          // After the move, chain B's deepest node would be at level:
          //   (chainADepth - 1) + 1 + (chainBDepth - 1) = chainADepth + chainBDepth - 1
          const deepestA = chainAIds[chainAIds.length - 1]!;
          const chainBRoot = chainBIds[0]!;
          const resultingMaxLevel = chainADepth + chainBDepth - 1;

          try {
            await service.move(TENANT_ID, chainBRoot, { newParentId: deepestA });

            // If move succeeded, the combined depth must be within limits
            expect(resultingMaxLevel).toBeLessThan(MAX_AREA_DEPTH);
          } catch (error) {
            if (error instanceof BusinessRuleError) {
              // Move was correctly rejected — combined depth would exceed limit
              expect(resultingMaxLevel).toBeGreaterThanOrEqual(MAX_AREA_DEPTH);
            } else {
              throw error;
            }
          }

          // Invariant: no stored area exceeds the depth limit
          const allAreas = db.getAreas();
          for (const area of allAreas) {
            expect(area.level).toBeLessThan(MAX_AREA_DEPTH);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
