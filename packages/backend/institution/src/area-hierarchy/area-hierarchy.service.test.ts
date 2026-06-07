/**
 * Unit tests for AreaHierarchyService
 *
 * Tests CRUD operations, depth enforcement, tree traversal,
 * and area-based institution filtering with mocked Prisma client.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { BusinessRuleError, ConflictError, NotFoundError } from '@proctira/common';

import { AreaHierarchyService, MAX_AREA_DEPTH } from './area-hierarchy.service.js';
import type { AreaHierarchyDbClient } from './area-hierarchy.service.js';
import type { GeographicArea, Institution } from '@proctira/database';

const TENANT_ID = 'tenant-001';

/**
 * In-memory mock of the AreaHierarchyDbClient for testing.
 */
class MockAreaHierarchyDb implements AreaHierarchyDbClient {
  private areas: GeographicArea[] = [];
  private institutions: Institution[] = [];
  private idCounter = 0;

  private generateId(): string {
    this.idCounter++;
    return `area-${String(this.idCounter).padStart(3, '0')}`;
  }

  addArea(area: GeographicArea): void {
    this.areas.push(area);
  }

  addInstitution(inst: Institution): void {
    this.institutions.push(inst);
  }

  clear(): void {
    this.areas = [];
    this.institutions = [];
    this.idCounter = 0;
  }

  geographicArea = {
    findUnique: async (args: { where: { id: string } }) => {
      return this.areas.find((a) => a.id === args.where.id) ?? null;
    },

    findFirst: async (args: { where: Record<string, unknown>; orderBy?: Record<string, unknown> | Record<string, unknown>[] }) => {
      let filtered = this.areas.filter((a) => {
        for (const [key, value] of Object.entries(args.where)) {
          if (key === 'deletedAt' && value === null) {
            if (a.deletedAt !== null) return false;
            continue;
          }
          if (key === 'id' && typeof value === 'object' && value !== null && 'not' in value) {
            if (a.id === (value as { not: string }).not) return false;
            continue;
          }
          if ((a as Record<string, unknown>)[key] !== value) return false;
        }
        return true;
      });

      if (args.orderBy) {
        const orderBy = Array.isArray(args.orderBy) ? args.orderBy[0] : args.orderBy;
        const [field, dir] = Object.entries(orderBy!)[0]!;
        filtered.sort((x, y) => {
          const xv = (x as Record<string, unknown>)[field] as number;
          const yv = (y as Record<string, unknown>)[field] as number;
          return dir === 'desc' ? yv - xv : xv - yv;
        });
      }

      return filtered[0] ?? null;
    },

    findMany: async (args: { where: Record<string, unknown>; orderBy?: Record<string, unknown> | Record<string, unknown>[] }) => {
      let filtered = this.areas.filter((a) => {
        for (const [key, value] of Object.entries(args.where)) {
          if (key === 'deletedAt' && value === null) {
            if (a.deletedAt !== null) return false;
            continue;
          }
          if (typeof value === 'object' && value !== null) {
            if ('startsWith' in value) {
              const str = (a as Record<string, unknown>)[key] as string;
              if (!str.startsWith((value as { startsWith: string }).startsWith)) return false;
              continue;
            }
            if ('gte' in value && 'lte' in (value as object)) {
              const num = (a as Record<string, unknown>)[key] as number;
              const v = value as { gte: number; lte: number };
              if (num < v.gte || num > v.lte) return false;
              continue;
            }
            if ('gte' in value) {
              const num = (a as Record<string, unknown>)[key] as number;
              if (num < (value as { gte: number }).gte) return false;
              continue;
            }
            if ('lte' in value) {
              const num = (a as Record<string, unknown>)[key] as number;
              if (num > (value as { lte: number }).lte) return false;
              continue;
            }
            if ('gt' in value) {
              const num = (a as Record<string, unknown>)[key] as number;
              if (num <= (value as { gt: number }).gt) return false;
              continue;
            }
            if ('in' in value) {
              const arr = (value as { in: string[] }).in;
              if (!arr.includes((a as Record<string, unknown>)[key] as string)) return false;
              continue;
            }
          }
          if ((a as Record<string, unknown>)[key] !== value) return false;
        }
        return true;
      });

      if (args.orderBy) {
        const orderBy = Array.isArray(args.orderBy) ? args.orderBy[0] : args.orderBy;
        const [field, dir] = Object.entries(orderBy!)[0]!;
        filtered.sort((x, y) => {
          const xv = (x as Record<string, unknown>)[field] as number;
          const yv = (y as Record<string, unknown>)[field] as number;
          return dir === 'desc' ? yv - xv : xv - yv;
        });
      }

      return filtered;
    },

    create: async (args: { data: Record<string, unknown> }) => {
      const id = this.generateId();
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
      this.areas.push(area);
      return area;
    },

    update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      const idx = this.areas.findIndex((a) => a.id === args.where.id);
      if (idx === -1) throw new Error('Area not found');
      const area = this.areas[idx]!;
      for (const [key, value] of Object.entries(args.data)) {
        (area as Record<string, unknown>)[key] = value;
      }
      area.updatedAt = new Date();
      return area;
    },

    updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      let count = 0;
      for (const area of this.areas) {
        let matches = true;
        for (const [key, value] of Object.entries(args.where)) {
          if (typeof value === 'object' && value !== null) {
            if ('gte' in value) {
              if ((area as Record<string, unknown>)[key] as number < (value as { gte: number }).gte) {
                matches = false;
                break;
              }
              continue;
            }
            if ('gt' in value) {
              if ((area as Record<string, unknown>)[key] as number <= (value as { gt: number }).gt) {
                matches = false;
                break;
              }
              continue;
            }
          }
          if ((area as Record<string, unknown>)[key] !== value) {
            matches = false;
            break;
          }
        }
        if (matches) {
          for (const [key, value] of Object.entries(args.data)) {
            if (typeof value === 'object' && value !== null && 'increment' in value) {
              (area as Record<string, unknown>)[key] =
                ((area as Record<string, unknown>)[key] as number) + (value as { increment: number }).increment;
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
      return this.areas.filter((a) => {
        for (const [key, value] of Object.entries(args.where)) {
          if (key === 'deletedAt' && value === null) {
            if (a.deletedAt !== null) return false;
            continue;
          }
          if ((a as Record<string, unknown>)[key] !== value) return false;
        }
        return true;
      }).length;
    },
  };

  institution = {
    findMany: async (args: { where: Record<string, unknown>; orderBy?: Record<string, unknown>; skip?: number; take?: number }) => {
      let filtered = this.institutions.filter((inst) => {
        for (const [key, value] of Object.entries(args.where)) {
          if (key === 'deletedAt' && value === null) {
            if ((inst as Record<string, unknown>).deletedAt !== null) return false;
            continue;
          }
          if (typeof value === 'object' && value !== null && 'in' in value) {
            const arr = (value as { in: string[] }).in;
            if (!arr.includes((inst as Record<string, unknown>)[key] as string)) return false;
            continue;
          }
          if ((inst as Record<string, unknown>)[key] !== value) return false;
        }
        return true;
      });

      if (args.orderBy) {
        const [field, dir] = Object.entries(args.orderBy)[0]!;
        filtered.sort((x, y) => {
          const xv = String((x as Record<string, unknown>)[field] ?? '');
          const yv = String((y as Record<string, unknown>)[field] ?? '');
          return dir === 'asc' ? xv.localeCompare(yv) : yv.localeCompare(xv);
        });
      }

      const skip = args.skip ?? 0;
      const take = args.take ?? filtered.length;
      return filtered.slice(skip, skip + take) as Institution[];
    },

    count: async (args: { where: Record<string, unknown> }) => {
      return this.institutions.filter((inst) => {
        for (const [key, value] of Object.entries(args.where)) {
          if (key === 'deletedAt' && value === null) {
            if ((inst as Record<string, unknown>).deletedAt !== null) return false;
            continue;
          }
          if (typeof value === 'object' && value !== null && 'in' in value) {
            const arr = (value as { in: string[] }).in;
            if (!arr.includes((inst as Record<string, unknown>)[key] as string)) return false;
            continue;
          }
          if ((inst as Record<string, unknown>)[key] !== value) return false;
        }
        return true;
      }).length;
    },
  };
}

/** Helper to create a GeographicArea entity for seeding the mock DB */
function makeArea(overrides: Partial<GeographicArea> & { id: string }): GeographicArea {
  return {
    tenantId: TENANT_ID,
    name: `Area ${overrides.id}`,
    code: overrides.id,
    level: 0,
    parentId: null,
    path: '',
    lft: 1,
    rgt: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

/** Helper to create an Institution entity for seeding the mock DB */
function makeInstitution(overrides: Partial<Institution> & { id: string; areaId: string }): Institution {
  return {
    tenantId: TENANT_ID,
    name: `Institution ${overrides.id}`,
    code: overrides.id,
    boardId: null,
    type: 'school',
    sector: 'public',
    ownership: 'government',
    status: 'active',
    customData: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  } as Institution;
}

describe('AreaHierarchyService', () => {
  let db: MockAreaHierarchyDb;
  let service: AreaHierarchyService;

  beforeEach(() => {
    db = new MockAreaHierarchyDb();
    service = new AreaHierarchyService(db);
  });

  describe('create', () => {
    it('should create a root area node', async () => {
      const area = await service.create({
        tenantId: TENANT_ID,
        name: 'Country',
        code: 'CTY',
      });

      expect(area.name).toBe('Country');
      expect(area.code).toBe('CTY');
      expect(area.level).toBe(0);
      expect(area.parentId).toBeNull();
      expect(area.path).toBe('');
      expect(area.lft).toBe(1);
      expect(area.rgt).toBe(2);
    });

    it('should create a child area under a parent', async () => {
      const parent = makeArea({
        id: 'parent-1',
        name: 'Country',
        code: 'CTY',
        level: 0,
        path: '',
        lft: 1,
        rgt: 2,
      });
      db.addArea(parent);

      const child = await service.create({
        tenantId: TENANT_ID,
        name: 'Region North',
        code: 'RGN',
        parentId: 'parent-1',
      });

      expect(child.level).toBe(1);
      expect(child.parentId).toBe('parent-1');
      expect(child.path).toBe('/parent-1');
    });

    it('should throw ConflictError for duplicate code within tenant', async () => {
      db.addArea(makeArea({ id: 'existing', code: 'DUP', tenantId: TENANT_ID }));

      await expect(
        service.create({ tenantId: TENANT_ID, name: 'New Area', code: 'DUP' }),
      ).rejects.toThrow(ConflictError);
    });

    it('should throw NotFoundError if parent does not exist', async () => {
      await expect(
        service.create({
          tenantId: TENANT_ID,
          name: 'Child',
          code: 'CHD',
          parentId: 'non-existent',
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it('should enforce maximum nesting depth of 10 levels', async () => {
      // Build a chain of 9 levels (0-8), then try to add level 9 (which is the 10th)
      // Level 9 should succeed (0-indexed, so 10 levels total = levels 0-9)
      // Level 10 should fail
      let parentId: string | null = null;
      for (let i = 0; i < MAX_AREA_DEPTH; i++) {
        const id = `level-${i}`;
        const path = parentId
          ? (db['areas'].find((a) => a.id === parentId)?.path ?? '') + `/${parentId}`
          : '';
        db.addArea(
          makeArea({
            id,
            code: `L${i}`,
            level: i,
            parentId,
            path,
            lft: i * 2 + 1,
            rgt: (MAX_AREA_DEPTH - i) * 2,
          }),
        );
        parentId = id;
      }

      // Trying to create at level MAX_AREA_DEPTH (10) should fail
      await expect(
        service.create({
          tenantId: TENANT_ID,
          name: 'Too Deep',
          code: 'DEEP',
          parentId: `level-${MAX_AREA_DEPTH - 1}`,
        }),
      ).rejects.toThrow(BusinessRuleError);
    });
  });

  describe('update', () => {
    it('should update area name', async () => {
      db.addArea(makeArea({ id: 'area-1', name: 'Old Name', code: 'A1' }));

      const updated = await service.update(TENANT_ID, 'area-1', { name: 'New Name' });
      expect(updated.name).toBe('New Name');
    });

    it('should update area code', async () => {
      db.addArea(makeArea({ id: 'area-1', name: 'Area', code: 'OLD' }));

      const updated = await service.update(TENANT_ID, 'area-1', { code: 'NEW' });
      expect(updated.code).toBe('NEW');
    });

    it('should throw NotFoundError for non-existent area', async () => {
      await expect(
        service.update(TENANT_ID, 'non-existent', { name: 'Test' }),
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw ConflictError for duplicate code on update', async () => {
      db.addArea(makeArea({ id: 'area-1', code: 'A1' }));
      db.addArea(makeArea({ id: 'area-2', code: 'A2' }));

      await expect(
        service.update(TENANT_ID, 'area-1', { code: 'A2' }),
      ).rejects.toThrow(ConflictError);
    });

    it('should throw NotFoundError for area in different tenant', async () => {
      db.addArea(makeArea({ id: 'area-1', code: 'A1', tenantId: 'other-tenant' }));

      await expect(
        service.update(TENANT_ID, 'area-1', { name: 'Test' }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('move', () => {
    it('should move an area to a new parent', async () => {
      db.addArea(makeArea({ id: 'root', code: 'ROOT', level: 0, path: '', lft: 1, rgt: 6 }));
      db.addArea(makeArea({ id: 'child-a', code: 'CA', level: 1, parentId: 'root', path: '/root', lft: 2, rgt: 3 }));
      db.addArea(makeArea({ id: 'child-b', code: 'CB', level: 1, parentId: 'root', path: '/root', lft: 4, rgt: 5 }));

      const moved = await service.move(TENANT_ID, 'child-a', { newParentId: 'child-b' });
      expect(moved.parentId).toBe('child-b');
      expect(moved.level).toBe(2);
    });

    it('should throw BusinessRuleError when moving to self', async () => {
      db.addArea(makeArea({ id: 'area-1', code: 'A1' }));

      await expect(
        service.move(TENANT_ID, 'area-1', { newParentId: 'area-1' }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('should throw BusinessRuleError when moving to own descendant', async () => {
      db.addArea(makeArea({ id: 'parent', code: 'P', level: 0, path: '', lft: 1, rgt: 4 }));
      db.addArea(makeArea({ id: 'child', code: 'C', level: 1, parentId: 'parent', path: '/parent', lft: 2, rgt: 3 }));

      await expect(
        service.move(TENANT_ID, 'parent', { newParentId: 'child' }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('should throw NotFoundError for non-existent area', async () => {
      await expect(
        service.move(TENANT_ID, 'non-existent', { newParentId: null }),
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw BusinessRuleError when move would exceed max depth', async () => {
      // Create a deep chain: root -> l1 -> l2 -> ... -> l8
      db.addArea(makeArea({ id: 'root', code: 'ROOT', level: 0, path: '', lft: 1, rgt: 20 }));
      let parentId = 'root';
      for (let i = 1; i <= 8; i++) {
        const id = `l${i}`;
        const prevPath = db['areas'].find((a) => a.id === parentId)!.path;
        const path = prevPath ? `${prevPath}/${parentId}` : `/${parentId}`;
        db.addArea(makeArea({ id, code: `L${i}`, level: i, parentId, path, lft: i * 2, rgt: i * 2 + 1 }));
        parentId = id;
      }

      // Create a separate subtree with depth 2: branch -> branch-child
      db.addArea(makeArea({ id: 'branch', code: 'BR', level: 0, path: '', lft: 21, rgt: 24 }));
      db.addArea(makeArea({ id: 'branch-child', code: 'BRC', level: 1, parentId: 'branch', path: '/branch', lft: 22, rgt: 23 }));

      // Moving 'branch' under 'l8' (level 8) would make branch at level 9 and branch-child at level 10
      // That exceeds MAX_AREA_DEPTH (10) since branch-child would be at level 10 (0-indexed)
      await expect(
        service.move(TENANT_ID, 'branch', { newParentId: 'l8' }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('should allow moving to root (null parent)', async () => {
      db.addArea(makeArea({ id: 'root', code: 'ROOT', level: 0, path: '', lft: 1, rgt: 4 }));
      db.addArea(makeArea({ id: 'child', code: 'C', level: 1, parentId: 'root', path: '/root', lft: 2, rgt: 3 }));

      const moved = await service.move(TENANT_ID, 'child', { newParentId: null });
      expect(moved.parentId).toBeNull();
      expect(moved.level).toBe(0);
    });
  });

  describe('getTree', () => {
    it('should return the full tree for a tenant', async () => {
      db.addArea(makeArea({ id: 'root', code: 'ROOT', level: 0, path: '', lft: 1, rgt: 6 }));
      db.addArea(makeArea({ id: 'child-a', code: 'CA', level: 1, parentId: 'root', path: '/root', lft: 2, rgt: 3 }));
      db.addArea(makeArea({ id: 'child-b', code: 'CB', level: 1, parentId: 'root', path: '/root', lft: 4, rgt: 5 }));

      const tree = await service.getTree(TENANT_ID);
      expect(tree).toHaveLength(1);
      expect(tree[0]!.id).toBe('root');
      expect(tree[0]!.children).toHaveLength(2);
    });

    it('should return subtree from a specific root', async () => {
      db.addArea(makeArea({ id: 'root', code: 'ROOT', level: 0, path: '', lft: 1, rgt: 8 }));
      db.addArea(makeArea({ id: 'child-a', code: 'CA', level: 1, parentId: 'root', path: '/root', lft: 2, rgt: 5 }));
      db.addArea(makeArea({ id: 'grandchild', code: 'GC', level: 2, parentId: 'child-a', path: '/root/child-a', lft: 3, rgt: 4 }));
      db.addArea(makeArea({ id: 'child-b', code: 'CB', level: 1, parentId: 'root', path: '/root', lft: 6, rgt: 7 }));

      const tree = await service.getTree(TENANT_ID, 'child-a');
      expect(tree).toHaveLength(1);
      expect(tree[0]!.id).toBe('child-a');
      expect(tree[0]!.children).toHaveLength(1);
      expect(tree[0]!.children[0]!.id).toBe('grandchild');
    });

    it('should throw NotFoundError for non-existent root', async () => {
      await expect(
        service.getTree(TENANT_ID, 'non-existent'),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('getDescendantIds', () => {
    it('should return the area itself and all descendants', async () => {
      db.addArea(makeArea({ id: 'root', code: 'ROOT', level: 0, path: '', lft: 1, rgt: 8 }));
      db.addArea(makeArea({ id: 'child-a', code: 'CA', level: 1, parentId: 'root', path: '/root', lft: 2, rgt: 5 }));
      db.addArea(makeArea({ id: 'grandchild', code: 'GC', level: 2, parentId: 'child-a', path: '/root/child-a', lft: 3, rgt: 4 }));
      db.addArea(makeArea({ id: 'child-b', code: 'CB', level: 1, parentId: 'root', path: '/root', lft: 6, rgt: 7 }));

      const ids = await service.getDescendantIds(TENANT_ID, 'root');
      expect(ids).toContain('root');
      expect(ids).toContain('child-a');
      expect(ids).toContain('grandchild');
      expect(ids).toContain('child-b');
      expect(ids).toHaveLength(4);
    });

    it('should return only the area itself if it has no children', async () => {
      db.addArea(makeArea({ id: 'leaf', code: 'LEAF', level: 2, path: '/root/parent', lft: 3, rgt: 4 }));

      const ids = await service.getDescendantIds(TENANT_ID, 'leaf');
      expect(ids).toEqual(['leaf']);
    });

    it('should throw NotFoundError for non-existent area', async () => {
      await expect(
        service.getDescendantIds(TENANT_ID, 'non-existent'),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('getAncestorIds', () => {
    it('should return ancestors from root to the area', async () => {
      db.addArea(makeArea({ id: 'root', code: 'ROOT', level: 0, path: '', lft: 1, rgt: 8 }));
      db.addArea(makeArea({ id: 'child', code: 'C', level: 1, parentId: 'root', path: '/root', lft: 2, rgt: 5 }));
      db.addArea(makeArea({ id: 'grandchild', code: 'GC', level: 2, parentId: 'child', path: '/root/child', lft: 3, rgt: 4 }));

      const ancestors = await service.getAncestorIds(TENANT_ID, 'grandchild');
      expect(ancestors).toEqual(['root', 'child', 'grandchild']);
    });

    it('should return only itself for a root area', async () => {
      db.addArea(makeArea({ id: 'root', code: 'ROOT', level: 0, path: '', lft: 1, rgt: 2 }));

      const ancestors = await service.getAncestorIds(TENANT_ID, 'root');
      expect(ancestors).toEqual(['root']);
    });
  });

  describe('getInstitutionsByArea', () => {
    it('should return institutions in the area and all descendant areas', async () => {
      db.addArea(makeArea({ id: 'root', code: 'ROOT', level: 0, path: '', lft: 1, rgt: 6 }));
      db.addArea(makeArea({ id: 'child', code: 'C', level: 1, parentId: 'root', path: '/root', lft: 2, rgt: 3 }));

      db.addInstitution(makeInstitution({ id: 'inst-1', areaId: 'root', name: 'School A' }));
      db.addInstitution(makeInstitution({ id: 'inst-2', areaId: 'child', name: 'School B' }));
      db.addInstitution(makeInstitution({ id: 'inst-3', areaId: 'other-area', name: 'School C' }));

      const result = await service.getInstitutionsByArea(TENANT_ID, 'root', { page: 1, pageSize: 10 });
      expect(result.data).toHaveLength(2);
      expect(result.meta.totalItems).toBe(2);
    });

    it('should paginate results correctly', async () => {
      db.addArea(makeArea({ id: 'root', code: 'ROOT', level: 0, path: '', lft: 1, rgt: 2 }));

      for (let i = 0; i < 5; i++) {
        db.addInstitution(makeInstitution({ id: `inst-${i}`, areaId: 'root', name: `School ${i}` }));
      }

      const page1 = await service.getInstitutionsByArea(TENANT_ID, 'root', { page: 1, pageSize: 2 });
      expect(page1.data).toHaveLength(2);
      expect(page1.meta.totalItems).toBe(5);
      expect(page1.meta.totalPages).toBe(3);

      const page2 = await service.getInstitutionsByArea(TENANT_ID, 'root', { page: 2, pageSize: 2 });
      expect(page2.data).toHaveLength(2);
    });

    it('should throw NotFoundError for non-existent area', async () => {
      await expect(
        service.getInstitutionsByArea(TENANT_ID, 'non-existent', { page: 1, pageSize: 10 }),
      ).rejects.toThrow(NotFoundError);
    });
  });
});
