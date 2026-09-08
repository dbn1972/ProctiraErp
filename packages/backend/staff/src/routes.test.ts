/**
 * Unit tests for Staff Routes (Fastify plugin integration).
 *
 * Tests cover:
 * - POST /staff - Create with validation
 * - PUT /staff/:id - Update with validation
 * - GET /staff - List with pagination/filtering/search
 * - GET /staff/:id - Get by ID
 * - DELETE /staff/:id - Delete
 * - Error responses (400, 404, 409)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import { InMemoryStaffRepository } from './in-memory-repository.js';
import { StaffService } from './staff-service.js';
import { registerStaffRoutes } from './routes.js';

// Helper to generate valid UUIDs for testing
function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const TENANT_ID = uuid();

function validCreateBody(overrides: Record<string, unknown> = {}) {
  return {
    firstName: 'John',
    lastName: 'Doe',
    dateOfBirth: '1985-06-15',
    identityNumber: `ID-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    contactPhone: '+1234567890',
    position: 'Teacher',
    ...overrides,
  };
}

describe('Staff Routes', () => {
  let app: FastifyInstance;
  let repository: InMemoryStaffRepository;
  let service: StaffService;

  beforeEach(async () => {
    app = Fastify();
    repository = new InMemoryStaffRepository();
    service = new StaffService(repository);

    // Add tenantId decorator to simulate tenant resolution
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = TENANT_ID;
    });

    await registerStaffRoutes(app, { staffService: service });
    await app.ready();
  });

  describe('POST /staff', () => {
    it('should create a staff record and return 201', async () => {
      const body = validCreateBody();

      const response = await app.inject({
        method: 'POST',
        url: '/staff',
        payload: body,
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.id).toBeDefined();
      expect(json.firstName).toBe(body.firstName);
      expect(json.lastName).toBe(body.lastName);
      expect(json.dateOfBirth).toBe(body.dateOfBirth);
      expect(json.identityNumber).toBe(body.identityNumber);
      expect(json.contactPhone).toBe(body.contactPhone);
      expect(json.position).toBe(body.position);
      expect(json.status).toBe('ACTIVE');
      expect(json.createdAt).toBeDefined();
      expect(json.updatedAt).toBeDefined();
    });

    it('should create a staff record with custom data', async () => {
      const body = validCreateBody({ customData: { department: 'Science', level: 3 } });

      const response = await app.inject({
        method: 'POST',
        url: '/staff',
        payload: body,
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.customData).toEqual({ department: 'Science', level: 3 });
    });

    it('should return 400 when required fields are missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/staff',
        payload: { firstName: 'Only First Name' },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.code).toBe('VALIDATION_ERROR');
      expect(json.errors).toBeDefined();
      expect(json.errors.length).toBeGreaterThan(0);
    });

    it('should return 400 when firstName is empty string', async () => {
      const body = validCreateBody({ firstName: '' });

      const response = await app.inject({
        method: 'POST',
        url: '/staff',
        payload: body,
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when dateOfBirth is not in YYYY-MM-DD format', async () => {
      const body = validCreateBody({ dateOfBirth: '15/06/1985' });

      const response = await app.inject({
        method: 'POST',
        url: '/staff',
        payload: body,
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when contactEmail is invalid', async () => {
      const body = validCreateBody({ contactEmail: 'not-an-email' });

      const response = await app.inject({
        method: 'POST',
        url: '/staff',
        payload: body,
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.code).toBe('VALIDATION_ERROR');
    });

    it('should return 409 when identity number already exists', async () => {
      const identityNumber = 'DUPLICATE-ID-001';
      const body1 = validCreateBody({ identityNumber });

      await app.inject({
        method: 'POST',
        url: '/staff',
        payload: body1,
      });

      const body2 = validCreateBody({ identityNumber });
      const response = await app.inject({
        method: 'POST',
        url: '/staff',
        payload: body2,
      });

      expect(response.statusCode).toBe(409);
      const json = response.json();
      expect(json.code).toBe('CONFLICT');
    });
  });

  describe('PUT /staff/:id', () => {
    it('should update a staff record and return 200', async () => {
      const body = validCreateBody();
      const createResponse = await app.inject({
        method: 'POST',
        url: '/staff',
        payload: body,
      });
      const created = createResponse.json();

      const response = await app.inject({
        method: 'PUT',
        url: `/staff/${created.id}`,
        payload: { firstName: 'Jane', position: 'Principal' },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.firstName).toBe('Jane');
      expect(json.position).toBe('Principal');
      expect(json.lastName).toBe(body.lastName);
    });

    it('should return 404 when staff does not exist', async () => {
      const fakeId = uuid();
      const response = await app.inject({
        method: 'PUT',
        url: `/staff/${fakeId}`,
        payload: { firstName: 'New Name' },
      });

      expect(response.statusCode).toBe(404);
      const json = response.json();
      expect(json.code).toBe('NOT_FOUND');
    });

    it('should return 400 when id is not a valid UUID', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/staff/not-a-uuid',
        payload: { firstName: 'New Name' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 409 when updating identity number to an existing one', async () => {
      const body1 = validCreateBody({ identityNumber: 'ID-AAA' });
      const body2 = validCreateBody({ identityNumber: 'ID-BBB' });

      await app.inject({ method: 'POST', url: '/staff', payload: body1 });
      const createResponse2 = await app.inject({
        method: 'POST',
        url: '/staff',
        payload: body2,
      });
      const created2 = createResponse2.json();

      const response = await app.inject({
        method: 'PUT',
        url: `/staff/${created2.id}`,
        payload: { identityNumber: 'ID-AAA' },
      });

      expect(response.statusCode).toBe(409);
    });
  });

  describe('GET /staff', () => {
    it('should return paginated list of staff', async () => {
      for (let i = 0; i < 3; i++) {
        await app.inject({
          method: 'POST',
          url: '/staff',
          payload: validCreateBody({ identityNumber: `ID-LIST-${i}` }),
        });
      }

      const response = await app.inject({
        method: 'GET',
        url: '/staff',
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
          url: '/staff',
          payload: validCreateBody({ firstName: `Staff${i}`, identityNumber: `ID-PAGE-${i}` }),
        });
      }

      const response = await app.inject({
        method: 'GET',
        url: '/staff?page=2&pageSize=2',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data).toHaveLength(2);
      expect(json.meta.page).toBe(2);
      expect(json.meta.pageSize).toBe(2);
      expect(json.meta.totalPages).toBe(3);
    });

    it('should filter by position', async () => {
      await app.inject({
        method: 'POST',
        url: '/staff',
        payload: validCreateBody({ position: 'Teacher', identityNumber: 'ID-TEACH' }),
      });
      await app.inject({
        method: 'POST',
        url: '/staff',
        payload: validCreateBody({ position: 'Principal', identityNumber: 'ID-PRINC' }),
      });

      const response = await app.inject({
        method: 'GET',
        url: '/staff?position=Teacher',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0].position).toBe('Teacher');
    });

    it('should search by name (full-text search)', async () => {
      await app.inject({
        method: 'POST',
        url: '/staff',
        payload: validCreateBody({
          firstName: 'Alice',
          lastName: 'Wonder',
          identityNumber: 'ID-AW',
        }),
      });
      await app.inject({
        method: 'POST',
        url: '/staff',
        payload: validCreateBody({
          firstName: 'Bob',
          lastName: 'Builder',
          identityNumber: 'ID-BB',
        }),
      });

      const response = await app.inject({
        method: 'GET',
        url: '/staff?search=alice',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0].firstName).toBe('Alice');
    });

    it('should search by identity number', async () => {
      await app.inject({
        method: 'POST',
        url: '/staff',
        payload: validCreateBody({ identityNumber: 'NAT-99999' }),
      });
      await app.inject({
        method: 'POST',
        url: '/staff',
        payload: validCreateBody({ identityNumber: 'NAT-11111' }),
      });

      const response = await app.inject({
        method: 'GET',
        url: '/staff?search=99999',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0].identityNumber).toBe('NAT-99999');
    });

    it('should return empty array when no staff exist', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/staff',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data).toHaveLength(0);
      expect(json.meta.totalItems).toBe(0);
    });
  });

  describe('GET /staff/:id', () => {
    it('should return a single staff record', async () => {
      const body = validCreateBody();
      const createResponse = await app.inject({
        method: 'POST',
        url: '/staff',
        payload: body,
      });
      const created = createResponse.json();

      const response = await app.inject({
        method: 'GET',
        url: `/staff/${created.id}`,
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.id).toBe(created.id);
      expect(json.firstName).toBe(body.firstName);
      expect(json.lastName).toBe(body.lastName);
    });

    it('should return 404 when staff does not exist', async () => {
      const fakeId = uuid();
      const response = await app.inject({
        method: 'GET',
        url: `/staff/${fakeId}`,
      });

      expect(response.statusCode).toBe(404);
      const json = response.json();
      expect(json.code).toBe('NOT_FOUND');
    });

    it('should return 400 when id is not a valid UUID', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/staff/invalid-id',
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('DELETE /staff/:id', () => {
    it('should delete a staff record and return 204', async () => {
      const body = validCreateBody();
      const createResponse = await app.inject({
        method: 'POST',
        url: '/staff',
        payload: body,
      });
      const created = createResponse.json();

      const response = await app.inject({
        method: 'DELETE',
        url: `/staff/${created.id}`,
      });

      expect(response.statusCode).toBe(204);

      // Verify it's gone
      const getResponse = await app.inject({
        method: 'GET',
        url: `/staff/${created.id}`,
      });
      expect(getResponse.statusCode).toBe(404);
    });

    it('should return 404 when staff does not exist', async () => {
      const fakeId = uuid();
      const response = await app.inject({
        method: 'DELETE',
        url: `/staff/${fakeId}`,
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 400 when id is not a valid UUID', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/staff/invalid-id',
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
