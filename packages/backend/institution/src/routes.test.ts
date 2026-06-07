/**
 * Unit tests for Institution Routes (Fastify plugin integration).
 *
 * Tests cover:
 * - POST /institutions - Create with validation
 * - PUT /institutions/:id - Update with validation
 * - POST /institutions/:id/deactivate - Deactivation
 * - GET /institutions - List with pagination/filtering
 * - GET /institutions/:id - Get by ID
 * - Error responses (400, 404, 409, 422)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import { InMemoryInstitutionRepository } from './in-memory-repository.js';
import { InstitutionService } from './institution-service.js';
import { registerInstitutionRoutes } from './routes.js';

// Helper to generate valid UUIDs for testing
function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const TENANT_ID = uuid();

function validCreateBody() {
  return {
    name: 'Test School',
    code: `SCH-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    areaId: uuid(),
    typeId: uuid(),
    sectorId: uuid(),
    ownershipId: uuid(),
  };
}

describe('Institution Routes', () => {
  let app: FastifyInstance;
  let repository: InMemoryInstitutionRepository;
  let service: InstitutionService;

  beforeEach(async () => {
    app = Fastify();
    repository = new InMemoryInstitutionRepository();
    service = new InstitutionService(repository);

    // Add tenantId decorator to simulate tenant resolution
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = TENANT_ID;
    });

    await registerInstitutionRoutes(app, { institutionService: service });
    await app.ready();
  });

  describe('POST /institutions', () => {
    it('should create an institution and return 201', async () => {
      const body = validCreateBody();

      const response = await app.inject({
        method: 'POST',
        url: '/institutions',
        payload: body,
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.id).toBeDefined();
      expect(json.name).toBe(body.name);
      expect(json.code).toBe(body.code);
      expect(json.status).toBe('ACTIVE');
      expect(json.createdAt).toBeDefined();
      expect(json.updatedAt).toBeDefined();
    });

    it('should return 400 when required fields are missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/institutions',
        payload: { name: 'Only Name' },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.code).toBe('VALIDATION_ERROR');
      expect(json.errors).toBeDefined();
      expect(json.errors.length).toBeGreaterThan(0);
    });

    it('should return 400 when name is empty string', async () => {
      const body = validCreateBody();
      body.name = '';

      const response = await app.inject({
        method: 'POST',
        url: '/institutions',
        payload: body,
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when areaId is not a valid UUID', async () => {
      const body = { ...validCreateBody(), areaId: 'not-a-uuid' };

      const response = await app.inject({
        method: 'POST',
        url: '/institutions',
        payload: body,
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.code).toBe('VALIDATION_ERROR');
    });

    it('should return 409 when institution code already exists', async () => {
      const body = validCreateBody();

      // Create first
      await app.inject({
        method: 'POST',
        url: '/institutions',
        payload: body,
      });

      // Try to create with same code
      const body2 = { ...validCreateBody(), code: body.code };
      const response = await app.inject({
        method: 'POST',
        url: '/institutions',
        payload: body2,
      });

      expect(response.statusCode).toBe(409);
      const json = response.json();
      expect(json.code).toBe('CONFLICT');
    });

    it('should return 409 when name already exists in same area', async () => {
      const areaId = uuid();
      const body1 = { ...validCreateBody(), name: 'Duplicate Name', areaId };

      await app.inject({
        method: 'POST',
        url: '/institutions',
        payload: body1,
      });

      const body2 = { ...validCreateBody(), name: 'Duplicate Name', areaId };
      const response = await app.inject({
        method: 'POST',
        url: '/institutions',
        payload: body2,
      });

      expect(response.statusCode).toBe(409);
      const json = response.json();
      expect(json.code).toBe('CONFLICT');
    });

    it('should return 400 when latitude is out of range', async () => {
      const body = { ...validCreateBody(), latitude: 91 };

      const response = await app.inject({
        method: 'POST',
        url: '/institutions',
        payload: body,
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 when longitude is out of range', async () => {
      const body = { ...validCreateBody(), longitude: -181 };

      const response = await app.inject({
        method: 'POST',
        url: '/institutions',
        payload: body,
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 when contactEmail is invalid', async () => {
      const body = { ...validCreateBody(), contactEmail: 'not-an-email' };

      const response = await app.inject({
        method: 'POST',
        url: '/institutions',
        payload: body,
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('PUT /institutions/:id', () => {
    it('should update an institution and return 200', async () => {
      const body = validCreateBody();
      const createResponse = await app.inject({
        method: 'POST',
        url: '/institutions',
        payload: body,
      });
      const created = createResponse.json();

      const response = await app.inject({
        method: 'PUT',
        url: `/institutions/${created.id}`,
        payload: { name: 'Updated Name' },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.name).toBe('Updated Name');
      expect(json.code).toBe(body.code);
    });

    it('should return 404 when institution does not exist', async () => {
      const fakeId = uuid();
      const response = await app.inject({
        method: 'PUT',
        url: `/institutions/${fakeId}`,
        payload: { name: 'New Name' },
      });

      expect(response.statusCode).toBe(404);
      const json = response.json();
      expect(json.code).toBe('NOT_FOUND');
    });

    it('should return 400 when id is not a valid UUID', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/institutions/not-a-uuid',
        payload: { name: 'New Name' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 409 when updating code to an existing code', async () => {
      const body1 = { ...validCreateBody(), code: 'CODE-AAA' };
      const body2 = validCreateBody();

      await app.inject({ method: 'POST', url: '/institutions', payload: body1 });
      const createResponse2 = await app.inject({
        method: 'POST',
        url: '/institutions',
        payload: body2,
      });
      const created2 = createResponse2.json();

      const response = await app.inject({
        method: 'PUT',
        url: `/institutions/${created2.id}`,
        payload: { code: 'CODE-AAA' },
      });

      expect(response.statusCode).toBe(409);
    });
  });

  describe('POST /institutions/:id/deactivate', () => {
    it('should deactivate an institution and return 200', async () => {
      const body = validCreateBody();
      const createResponse = await app.inject({
        method: 'POST',
        url: '/institutions',
        payload: body,
      });
      const created = createResponse.json();

      const response = await app.inject({
        method: 'POST',
        url: `/institutions/${created.id}/deactivate`,
        payload: { reason: 'School closing permanently' },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.status).toBe('INACTIVE');
      expect(json.deactivationReason).toBe('School closing permanently');
    });

    it('should return 404 when institution does not exist', async () => {
      const fakeId = uuid();
      const response = await app.inject({
        method: 'POST',
        url: `/institutions/${fakeId}/deactivate`,
        payload: { reason: 'Closing' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 422 when institution is already inactive', async () => {
      const body = validCreateBody();
      const createResponse = await app.inject({
        method: 'POST',
        url: '/institutions',
        payload: body,
      });
      const created = createResponse.json();

      // Deactivate once
      await app.inject({
        method: 'POST',
        url: `/institutions/${created.id}/deactivate`,
        payload: { reason: 'First time' },
      });

      // Try again
      const response = await app.inject({
        method: 'POST',
        url: `/institutions/${created.id}/deactivate`,
        payload: { reason: 'Second time' },
      });

      expect(response.statusCode).toBe(422);
      const json = response.json();
      expect(json.code).toBe('BUSINESS_RULE_ERROR');
    });

    it('should return 400 when reason is missing', async () => {
      const body = validCreateBody();
      const createResponse = await app.inject({
        method: 'POST',
        url: '/institutions',
        payload: body,
      });
      const created = createResponse.json();

      const response = await app.inject({
        method: 'POST',
        url: `/institutions/${created.id}/deactivate`,
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 when reason is empty string', async () => {
      const body = validCreateBody();
      const createResponse = await app.inject({
        method: 'POST',
        url: '/institutions',
        payload: body,
      });
      const created = createResponse.json();

      const response = await app.inject({
        method: 'POST',
        url: `/institutions/${created.id}/deactivate`,
        payload: { reason: '' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /institutions', () => {
    it('should return paginated list of institutions', async () => {
      // Create 3 institutions
      for (let i = 0; i < 3; i++) {
        await app.inject({
          method: 'POST',
          url: '/institutions',
          payload: validCreateBody(),
        });
      }

      const response = await app.inject({
        method: 'GET',
        url: '/institutions',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data).toHaveLength(3);
      expect(json.meta.totalItems).toBe(3);
      expect(json.meta.page).toBe(1);
    });

    it('should support pagination parameters', async () => {
      for (let i = 0; i < 5; i++) {
        await app.inject({
          method: 'POST',
          url: '/institutions',
          payload: { ...validCreateBody(), name: `School ${i}` },
        });
      }

      const response = await app.inject({
        method: 'GET',
        url: '/institutions?page=2&pageSize=2',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data).toHaveLength(2);
      expect(json.meta.page).toBe(2);
      expect(json.meta.pageSize).toBe(2);
      expect(json.meta.totalPages).toBe(3);
    });

    it('should filter by status', async () => {
      const body1 = validCreateBody();
      const body2 = validCreateBody();

      await app.inject({ method: 'POST', url: '/institutions', payload: body1 });
      const createResponse2 = await app.inject({
        method: 'POST',
        url: '/institutions',
        payload: body2,
      });
      const created2 = createResponse2.json();

      await app.inject({
        method: 'POST',
        url: `/institutions/${created2.id}/deactivate`,
        payload: { reason: 'Closing' },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/institutions?status=ACTIVE',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0].status).toBe('ACTIVE');
    });

    it('should return empty array when no institutions exist', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/institutions',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data).toHaveLength(0);
      expect(json.meta.totalItems).toBe(0);
    });
  });

  describe('GET /institutions/:id', () => {
    it('should return a single institution', async () => {
      const body = validCreateBody();
      const createResponse = await app.inject({
        method: 'POST',
        url: '/institutions',
        payload: body,
      });
      const created = createResponse.json();

      const response = await app.inject({
        method: 'GET',
        url: `/institutions/${created.id}`,
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.id).toBe(created.id);
      expect(json.name).toBe(body.name);
      expect(json.code).toBe(body.code);
    });

    it('should return 404 when institution does not exist', async () => {
      const fakeId = uuid();
      const response = await app.inject({
        method: 'GET',
        url: `/institutions/${fakeId}`,
      });

      expect(response.statusCode).toBe(404);
      const json = response.json();
      expect(json.code).toBe('NOT_FOUND');
    });

    it('should return 400 when id is not a valid UUID', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/institutions/invalid-id',
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
