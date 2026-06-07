/**
 * Unit tests for Area Hierarchy Routes
 *
 * Tests the Fastify route handlers for area hierarchy CRUD operations.
 * Uses a real Fastify instance with the area hierarchy service backed by a mock DB.
 */
import Fastify from 'fastify';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { registerAreaHierarchyRoutes } from './area-hierarchy.routes.js';
import { AreaHierarchyService } from './area-hierarchy.service.js';
import type { AreaHierarchyDbClient } from './area-hierarchy.service.js';
import type { GeographicArea, Institution } from '@proctira/database';

const TENANT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

/**
 * Simple in-memory mock for the AreaHierarchyDbClient used in route tests.
 */
class SimpleAreaDb implements AreaHierarchyDbClient {
  areas: GeographicArea[] = [];
  institutions: Institution[] = [];
  private idCounter = 0;

  geographicArea = {
    findUnique: async (args: { where: { id: string } }) => {
      return this.areas.find((a) => a.id === args.where.id) ?? null;
    },
    findFirst: async (args: { where: Record<string, unknown>; orderBy?: any }) => {
      const filtered = this.areas.filter((a) => {
        for (const [key, value] of Object.entries(args.where)) {
          if (key === 'deletedAt' && value === null) {
            if (a.deletedAt !== null) return false;
            continue;
          }
          if (key === 'id' && typeof value === 'object' && value !== null && 'not' in value) {
            if (a.id === (value as any).not) return false;
            continue;
          }
          if ((a as any)[key] !== value) return false;
        }
        return true;
      });
      return filtered[0] ?? null;
    },
    findMany: async (args: { where: Record<string, unknown>; orderBy?: any }) => {
      return this.areas.filter((a) => {
        for (const [key, value] of Object.entries(args.where)) {
          if (key === 'deletedAt' && value === null) {
            if (a.deletedAt !== null) return false;
            continue;
          }
          if (typeof value === 'object' && value !== null) {
            if ('startsWith' in value) {
              if (!(a as any)[key].startsWith((value as any).startsWith)) return false;
              continue;
            }
            if ('gte' in value && 'lte' in value) {
              const num = (a as any)[key];
              if (num < (value as any).gte || num > (value as any).lte) return false;
              continue;
            }
            if ('gte' in value) {
              if ((a as any)[key] < (value as any).gte) return false;
              continue;
            }
            if ('lte' in value) {
              if ((a as any)[key] > (value as any).lte) return false;
              continue;
            }
            if ('in' in value) {
              if (!(value as any).in.includes((a as any)[key])) return false;
              continue;
            }
          }
          if ((a as any)[key] !== value) return false;
        }
        return true;
      });
    },
    create: async (args: { data: Record<string, unknown> }) => {
      this.idCounter++;
      const id = `area-${String(this.idCounter).padStart(3, '0')}`;
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
      const area = this.areas.find((a) => a.id === args.where.id);
      if (!area) throw new Error('Not found');
      Object.assign(area, args.data, { updatedAt: new Date() });
      return area;
    },
    updateMany: async (_args: any) => ({ count: 0 }),
    count: async (args: { where: Record<string, unknown> }) => {
      return this.areas.filter((a) => {
        for (const [key, value] of Object.entries(args.where)) {
          if (key === 'deletedAt' && value === null) {
            if (a.deletedAt !== null) return false;
            continue;
          }
          if ((a as any)[key] !== value) return false;
        }
        return true;
      }).length;
    },
  };

  institution = {
    findMany: async (args: { where: Record<string, unknown>; orderBy?: any; skip?: number; take?: number }) => {
      let filtered = this.institutions.filter((inst) => {
        for (const [key, value] of Object.entries(args.where)) {
          if (key === 'deletedAt' && value === null) continue;
          if (typeof value === 'object' && value !== null && 'in' in value) {
            if (!(value as any).in.includes((inst as any)[key])) return false;
            continue;
          }
          if ((inst as any)[key] !== value) return false;
        }
        return true;
      });
      const skip = args.skip ?? 0;
      const take = args.take ?? filtered.length;
      return filtered.slice(skip, skip + take) as Institution[];
    },
    count: async (args: { where: Record<string, unknown> }) => {
      return this.institutions.filter((inst) => {
        for (const [key, value] of Object.entries(args.where)) {
          if (key === 'deletedAt' && value === null) continue;
          if (typeof value === 'object' && value !== null && 'in' in value) {
            if (!(value as any).in.includes((inst as any)[key])) return false;
            continue;
          }
          if ((inst as any)[key] !== value) return false;
        }
        return true;
      }).length;
    },
  };
}

function createTestApp(db: SimpleAreaDb) {
  const app = Fastify();
  const service = new AreaHierarchyService(db);

  // Add tenantId decorator to simulate tenant resolution middleware
  app.decorateRequest('tenantId', '');
  app.addHook('onRequest', async (request) => {
    (request as any).tenantId = TENANT_ID;
  });

  return { app, service };
}

describe('Area Hierarchy Routes', () => {
  let app: ReturnType<typeof Fastify>;
  let db: SimpleAreaDb;

  beforeEach(async () => {
    db = new SimpleAreaDb();
    const testApp = createTestApp(db);
    app = testApp.app;
    await registerAreaHierarchyRoutes(app, {
      areaHierarchyService: testApp.service,
      prefix: '/areas',
    });
    await app.ready();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  describe('POST /areas', () => {
    it('should create a root area and return 201', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/areas',
        payload: { name: 'Country', code: 'CTY' },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.name).toBe('Country');
      expect(body.code).toBe('CTY');
      expect(body.level).toBe(0);
      expect(body.parentId).toBeNull();
    });

    it('should return 400 for missing required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/areas',
        payload: { name: '' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('should return 409 for duplicate code', async () => {
      db.areas.push({
        id: 'existing',
        tenantId: TENANT_ID,
        name: 'Existing',
        code: 'DUP',
        level: 0,
        parentId: null,
        path: '',
        lft: 1,
        rgt: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/areas',
        payload: { name: 'New Area', code: 'DUP' },
      });

      expect(response.statusCode).toBe(409);
    });
  });

  describe('PUT /areas/:areaId', () => {
    it('should update an area name and return 200', async () => {
      db.areas.push({
        id: 'a1b2c3d4-0000-0000-0000-000000000001',
        tenantId: TENANT_ID,
        name: 'Old Name',
        code: 'A1',
        level: 0,
        parentId: null,
        path: '',
        lft: 1,
        rgt: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      });

      const response = await app.inject({
        method: 'PUT',
        url: '/areas/a1b2c3d4-0000-0000-0000-000000000001',
        payload: { name: 'New Name' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.name).toBe('New Name');
    });

    it('should return 404 for non-existent area', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/areas/a1b2c3d4-0000-0000-0000-000000000099',
        payload: { name: 'Test' },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /areas/:areaId/move', () => {
    it('should move an area to a new parent', async () => {
      db.areas.push(
        {
          id: 'a1b2c3d4-0000-0000-0000-000000000001',
          tenantId: TENANT_ID,
          name: 'Root',
          code: 'ROOT',
          level: 0,
          parentId: null,
          path: '',
          lft: 1,
          rgt: 6,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
        {
          id: 'a1b2c3d4-0000-0000-0000-000000000002',
          tenantId: TENANT_ID,
          name: 'Child A',
          code: 'CA',
          level: 1,
          parentId: 'a1b2c3d4-0000-0000-0000-000000000001',
          path: '/a1b2c3d4-0000-0000-0000-000000000001',
          lft: 2,
          rgt: 3,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
        {
          id: 'a1b2c3d4-0000-0000-0000-000000000003',
          tenantId: TENANT_ID,
          name: 'Child B',
          code: 'CB',
          level: 1,
          parentId: 'a1b2c3d4-0000-0000-0000-000000000001',
          path: '/a1b2c3d4-0000-0000-0000-000000000001',
          lft: 4,
          rgt: 5,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
      );

      const response = await app.inject({
        method: 'POST',
        url: '/areas/a1b2c3d4-0000-0000-0000-000000000002/move',
        payload: { newParentId: 'a1b2c3d4-0000-0000-0000-000000000003' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.parentId).toBe('a1b2c3d4-0000-0000-0000-000000000003');
    });
  });

  describe('GET /areas/tree', () => {
    it('should return the full tree', async () => {
      db.areas.push(
        {
          id: 'a1b2c3d4-0000-0000-0000-000000000001',
          tenantId: TENANT_ID,
          name: 'Root',
          code: 'ROOT',
          level: 0,
          parentId: null,
          path: '',
          lft: 1,
          rgt: 4,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
        {
          id: 'a1b2c3d4-0000-0000-0000-000000000002',
          tenantId: TENANT_ID,
          name: 'Child',
          code: 'C',
          level: 1,
          parentId: 'a1b2c3d4-0000-0000-0000-000000000001',
          path: '/a1b2c3d4-0000-0000-0000-000000000001',
          lft: 2,
          rgt: 3,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
      );

      const response = await app.inject({
        method: 'GET',
        url: '/areas/tree',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe('a1b2c3d4-0000-0000-0000-000000000001');
      expect(body[0].children).toHaveLength(1);
    });
  });

  describe('GET /areas/:areaId', () => {
    it('should return a single area', async () => {
      db.areas.push({
        id: 'a1b2c3d4-0000-0000-0000-000000000001',
        tenantId: TENANT_ID,
        name: 'Test Area',
        code: 'TA',
        level: 0,
        parentId: null,
        path: '',
        lft: 1,
        rgt: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/areas/a1b2c3d4-0000-0000-0000-000000000001',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.name).toBe('Test Area');
      expect(body.code).toBe('TA');
    });

    it('should return 404 for non-existent area', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/areas/a1b2c3d4-0000-0000-0000-000000000099',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /areas/:areaId/descendants', () => {
    it('should return descendant area IDs', async () => {
      db.areas.push(
        {
          id: 'a1b2c3d4-0000-0000-0000-000000000001',
          tenantId: TENANT_ID,
          name: 'Root',
          code: 'ROOT',
          level: 0,
          parentId: null,
          path: '',
          lft: 1,
          rgt: 4,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
        {
          id: 'a1b2c3d4-0000-0000-0000-000000000002',
          tenantId: TENANT_ID,
          name: 'Child',
          code: 'C',
          level: 1,
          parentId: 'a1b2c3d4-0000-0000-0000-000000000001',
          path: '/a1b2c3d4-0000-0000-0000-000000000001',
          lft: 2,
          rgt: 3,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
      );

      const response = await app.inject({
        method: 'GET',
        url: '/areas/a1b2c3d4-0000-0000-0000-000000000001/descendants',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.areaIds).toContain('a1b2c3d4-0000-0000-0000-000000000001');
      expect(body.areaIds).toContain('a1b2c3d4-0000-0000-0000-000000000002');
    });
  });

  describe('GET /areas/:areaId/institutions', () => {
    it('should return institutions in the area and descendants', async () => {
      db.areas.push(
        {
          id: 'a1b2c3d4-0000-0000-0000-000000000001',
          tenantId: TENANT_ID,
          name: 'Root',
          code: 'ROOT',
          level: 0,
          parentId: null,
          path: '',
          lft: 1,
          rgt: 4,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
        {
          id: 'a1b2c3d4-0000-0000-0000-000000000002',
          tenantId: TENANT_ID,
          name: 'Child',
          code: 'C',
          level: 1,
          parentId: 'a1b2c3d4-0000-0000-0000-000000000001',
          path: '/a1b2c3d4-0000-0000-0000-000000000001',
          lft: 2,
          rgt: 3,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
      );

      db.institutions.push(
        {
          id: 'inst-1',
          tenantId: TENANT_ID,
          name: 'School A',
          code: 'SA',
          boardId: null,
          areaId: 'a1b2c3d4-0000-0000-0000-000000000001',
          type: 'school',
          sector: 'public',
          ownership: 'government',
          status: 'active',
          customData: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        } as Institution,
        {
          id: 'inst-2',
          tenantId: TENANT_ID,
          name: 'School B',
          code: 'SB',
          boardId: null,
          areaId: 'a1b2c3d4-0000-0000-0000-000000000002',
          type: 'school',
          sector: 'public',
          ownership: 'government',
          status: 'active',
          customData: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        } as Institution,
      );

      const response = await app.inject({
        method: 'GET',
        url: '/areas/a1b2c3d4-0000-0000-0000-000000000001/institutions?page=1&pageSize=10',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(2);
      expect(body.meta.totalItems).toBe(2);
    });
  });
});
