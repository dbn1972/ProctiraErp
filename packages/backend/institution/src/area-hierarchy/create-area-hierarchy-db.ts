/**
 * Persistence for `GET /areas/tree` and the rest of the area hierarchy routes.
 *
 * Postgres (tenant-bound Prisma) when DATABASE_URL is set. Otherwise an
 * in-memory client so institution screens can still read labels in dev and tests.
 */
import {
  assertInMemoryFallbackAllowed,
  createPrismaClient,
  type GeographicArea,
  type Institution,
} from '@proctira/database';

import { createTenantBoundPrisma } from '../tenant-bound-prisma.js';

import type { AreaHierarchyDbClient } from './area-hierarchy.service.js';

function matchesScalar(actual: unknown, expected: unknown): boolean {
  if (expected === null && actual === null) return true;
  if (typeof expected === 'object' && expected !== null) {
    const clause = expected as Record<string, unknown>;
    if ('not' in clause) return actual !== clause.not;
    if ('startsWith' in clause) {
      return typeof actual === 'string' && actual.startsWith(String(clause.startsWith));
    }
    if ('in' in clause) {
      return Array.isArray(clause.in) && clause.in.includes(actual);
    }
    if (typeof actual === 'number') {
      if ('gte' in clause && actual < Number(clause.gte)) return false;
      if ('gt' in clause && actual <= Number(clause.gt)) return false;
      if ('lte' in clause && actual > Number(clause.lte)) return false;
      if ('lt' in clause && actual >= Number(clause.lt)) return false;
      if ('gte' in clause || 'gt' in clause || 'lte' in clause || 'lt' in clause) return true;
    }
    return false;
  }
  return actual === expected;
}

function matchesWhere(row: object, where: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (key === 'deletedAt' && value === null) {
      if ((row as { deletedAt?: Date | null }).deletedAt != null) return false;
      continue;
    }
    if (!matchesScalar((row as Record<string, unknown>)[key], value)) return false;
  }
  return true;
}

/**
 * In-memory area store. `seed` is for tests that prove tenant isolation.
 */
export class InMemoryAreaHierarchyDb implements AreaHierarchyDbClient {
  private areas: GeographicArea[] = [];
  private institutions: Institution[] = [];
  private idCounter = 0;

  seed(area: GeographicArea): void {
    this.areas.push(area);
  }

  clear(): void {
    this.areas = [];
    this.institutions = [];
    this.idCounter = 0;
  }

  geographicArea = {
    findUnique: (args: { where: { id: string } }) =>
      Promise.resolve(this.areas.find((area) => area.id === args.where.id) ?? null),

    findFirst: (args: { where: Record<string, unknown> }) =>
      Promise.resolve(this.areas.find((area) => matchesWhere(area, args.where)) ?? null),

    findMany: (args: {
      where: Record<string, unknown>;
      orderBy?: Record<string, unknown> | Record<string, unknown>[];
    }) => {
      const filtered = this.areas.filter((area) => matchesWhere(area, args.where));
      const orderBy = Array.isArray(args.orderBy) ? args.orderBy[0] : args.orderBy;
      if (orderBy) {
        const [field, dir] = Object.entries(orderBy)[0] ?? [];
        if (field) {
          filtered.sort((left, right) => {
            const lv = (left as unknown as Record<string, unknown>)[field];
            const rv = (right as unknown as Record<string, unknown>)[field];
            if (typeof lv === 'number' && typeof rv === 'number') {
              return dir === 'desc' ? rv - lv : lv - rv;
            }
            return dir === 'desc'
              ? String(rv).localeCompare(String(lv))
              : String(lv).localeCompare(String(rv));
          });
        }
      }
      return Promise.resolve(filtered);
    },

    create: (args: { data: Record<string, unknown> }) => {
      this.idCounter += 1;
      const now = new Date();
      const area: GeographicArea = {
        id: (args.data.id as string) ?? `area-${this.idCounter}`,
        tenantId: String(args.data.tenantId),
        name: String(args.data.name),
        code: String(args.data.code),
        level: Number(args.data.level),
        parentId: (args.data.parentId as string | null) ?? null,
        path: String(args.data.path ?? ''),
        lft: Number(args.data.lft),
        rgt: Number(args.data.rgt),
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      this.areas.push(area);
      return Promise.resolve(area);
    },

    update: (args: { where: { id: string }; data: Record<string, unknown> }) => {
      const area = this.areas.find((row) => row.id === args.where.id);
      if (!area) throw new Error('Area not found');
      Object.assign(area, args.data, { updatedAt: new Date() });
      return Promise.resolve(area);
    },

    updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      let count = 0;
      for (const area of this.areas) {
        if (!matchesWhere(area, args.where)) continue;
        for (const [key, value] of Object.entries(args.data)) {
          if (typeof value === 'object' && value !== null && 'increment' in value) {
            const current = (area as unknown as Record<string, unknown>)[key];
            (area as unknown as Record<string, unknown>)[key] =
              Number(current) + Number((value as { increment: number }).increment);
          } else {
            (area as unknown as Record<string, unknown>)[key] = value;
          }
        }
        count += 1;
      }
      return Promise.resolve({ count });
    },

    count: (args: { where: Record<string, unknown> }) =>
      Promise.resolve(this.areas.filter((area) => matchesWhere(area, args.where)).length),
  };

  institution = {
    findMany: (args: { where: Record<string, unknown>; skip?: number; take?: number }) => {
      const filtered = this.institutions.filter((row) => matchesWhere(row, args.where));
      const skip = args.skip ?? 0;
      const take = args.take ?? filtered.length;
      return Promise.resolve(filtered.slice(skip, skip + take));
    },
    count: (args: { where: Record<string, unknown> }) =>
      Promise.resolve(this.institutions.filter((row) => matchesWhere(row, args.where)).length),
  };
}

let memoryDb: InMemoryAreaHierarchyDb | undefined;

/** The in-memory client when DATABASE_URL is unset. Undefined in Postgres mode. */
export function inMemoryAreaHierarchyDb(): InMemoryAreaHierarchyDb | undefined {
  return memoryDb;
}

export function createAreaHierarchyDb(): AreaHierarchyDbClient {
  const databaseUrl = process.env['DATABASE_URL']?.trim();
  if (databaseUrl) {
    memoryDb = undefined;
    return createTenantBoundPrisma(
      createPrismaClient({ datasourceUrl: databaseUrl }),
    ) as unknown as AreaHierarchyDbClient;
  }
  assertInMemoryFallbackAllowed('area-hierarchy');
  memoryDb ??= new InMemoryAreaHierarchyDb();
  return memoryDb;
}
