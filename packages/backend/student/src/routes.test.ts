/**
 * Unit tests for Student Routes (Fastify plugin integration).
 *
 * Tests cover:
 * - POST /students - Create with validation
 * - PUT /students/:id - Update with validation
 * - GET /students - List with pagination/filtering
 * - GET /students/search - Full-text search
 * - GET /students/:id - Get by ID
 * - DELETE /students/:id - Delete
 * - Error responses (400, 404, 409)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import { InMemoryStudentRepository } from './in-memory-repository.js';
import { StudentService } from './student-service.js';
import { registerStudentRoutes } from './routes.js';

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
    firstName: 'John',
    lastName: 'Doe',
    dateOfBirth: '2005-03-15',
    gender: 'male',
  };
}

describe('Student Routes', () => {
  let app: FastifyInstance;
  let repository: InMemoryStudentRepository;
  let service: StudentService;

  beforeEach(async () => {
    app = Fastify();
    repository = new InMemoryStudentRepository();
    service = new StudentService(repository);

    // Add tenantId decorator to simulate tenant resolution
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = TENANT_ID;
    });

    await registerStudentRoutes(app, { studentService: service });
    await app.ready();
  });

  describe('POST /students', () => {
    it('should create a student and return 201', async () => {
      const body = validCreateBody();

      const response = await app.inject({
        method: 'POST',
        url: '/students',
        payload: body,
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.id).toBeDefined();
      expect(json.firstName).toBe('John');
      expect(json.lastName).toBe('Doe');
      expect(json.dateOfBirth).toBe('2005-03-15');
      expect(json.gender).toBe('male');
      expect(json.nationalId).toBeNull();
      expect(json.contacts).toEqual([]);
      expect(json.guardians).toEqual([]);
      expect(json.identityDocuments).toEqual([]);
      expect(json.customData).toEqual({});
      expect(json.createdAt).toBeDefined();
      expect(json.updatedAt).toBeDefined();
    });

    it('should create a student with all optional fields', async () => {
      const body = {
        ...validCreateBody(),
        nationalId: 'NID-123',
        nationality: 'British',
        contacts: [{ type: 'phone', value: '+44123456', isPrimary: true }],
        guardians: [{ firstName: 'Jane', lastName: 'Doe', relationship: 'mother' }],
        identityDocuments: [{ type: 'passport', number: 'GB123456' }],
        customData: { house: 'Gryffindor' },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/students',
        payload: body,
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.nationalId).toBe('NID-123');
      expect(json.nationality).toBe('British');
      expect(json.contacts).toHaveLength(1);
      expect(json.guardians).toHaveLength(1);
      expect(json.guardians[0].id).toBeDefined();
      expect(json.identityDocuments).toHaveLength(1);
      expect(json.customData).toEqual({ house: 'Gryffindor' });
    });

    it('should return 400 when firstName is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/students',
        payload: { lastName: 'Doe', dateOfBirth: '2005-01-01', gender: 'male' },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.code).toBe('VALIDATION_ERROR');
      expect(json.errors).toBeDefined();
    });

    it('should return 400 when lastName is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/students',
        payload: { firstName: 'John', dateOfBirth: '2005-01-01', gender: 'male' },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when dateOfBirth is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/students',
        payload: { firstName: 'John', lastName: 'Doe', gender: 'male' },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when dateOfBirth format is invalid', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/students',
        payload: { ...validCreateBody(), dateOfBirth: '15-03-2005' },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when firstName is empty string', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/students',
        payload: { ...validCreateBody(), firstName: '' },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.code).toBe('VALIDATION_ERROR');
    });

    it('should return 409 when national ID already exists', async () => {
      const body = { ...validCreateBody(), nationalId: 'NID-DUP' };

      await app.inject({ method: 'POST', url: '/students', payload: body });

      const body2 = { ...validCreateBody(), firstName: 'Jane', nationalId: 'NID-DUP' };
      const response = await app.inject({
        method: 'POST',
        url: '/students',
        payload: body2,
      });

      expect(response.statusCode).toBe(409);
      const json = response.json();
      expect(json.code).toBe('CONFLICT');
    });
  });

  describe('PUT /students/:id', () => {
    it('should update a student and return 200', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/students',
        payload: validCreateBody(),
      });
      const created = createResponse.json();

      const response = await app.inject({
        method: 'PUT',
        url: `/students/${created.id}`,
        payload: { firstName: 'Jonathan', nationality: 'Canadian' },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.firstName).toBe('Jonathan');
      expect(json.nationality).toBe('Canadian');
      expect(json.lastName).toBe('Doe');
    });

    it('should return 404 when student does not exist', async () => {
      const fakeId = uuid();
      const response = await app.inject({
        method: 'PUT',
        url: `/students/${fakeId}`,
        payload: { firstName: 'New Name' },
      });

      expect(response.statusCode).toBe(404);
      const json = response.json();
      expect(json.code).toBe('NOT_FOUND');
    });

    it('should return 400 when id is not a valid UUID', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/students/not-a-uuid',
        payload: { firstName: 'New Name' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 409 when updating national ID to an existing one', async () => {
      const body1 = { ...validCreateBody(), nationalId: 'NID-FIRST' };
      const body2 = { ...validCreateBody(), firstName: 'Jane', nationalId: 'NID-SECOND' };

      await app.inject({ method: 'POST', url: '/students', payload: body1 });
      const createResponse2 = await app.inject({
        method: 'POST',
        url: '/students',
        payload: body2,
      });
      const created2 = createResponse2.json();

      const response = await app.inject({
        method: 'PUT',
        url: `/students/${created2.id}`,
        payload: { nationalId: 'NID-FIRST' },
      });

      expect(response.statusCode).toBe(409);
    });
  });

  describe('GET /students', () => {
    it('should return paginated list of students', async () => {
      for (let i = 0; i < 3; i++) {
        await app.inject({
          method: 'POST',
          url: '/students',
          payload: { ...validCreateBody(), firstName: `Student${i}` },
        });
      }

      const response = await app.inject({
        method: 'GET',
        url: '/students',
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
          url: '/students',
          payload: { ...validCreateBody(), firstName: `Student${i}` },
        });
      }

      const response = await app.inject({
        method: 'GET',
        url: '/students?page=2&pageSize=2',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data).toHaveLength(2);
      expect(json.meta.page).toBe(2);
      expect(json.meta.pageSize).toBe(2);
      expect(json.meta.totalPages).toBe(3);
    });

    it('should filter by gender', async () => {
      await app.inject({
        method: 'POST',
        url: '/students',
        payload: { ...validCreateBody(), firstName: 'Alice', gender: 'female' },
      });
      await app.inject({
        method: 'POST',
        url: '/students',
        payload: { ...validCreateBody(), firstName: 'Bob', gender: 'male' },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/students?gender=female',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0].firstName).toBe('Alice');
    });

    it('should return empty array when no students exist', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/students',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data).toHaveLength(0);
      expect(json.meta.totalItems).toBe(0);
    });
  });

  describe('GET /students/search', () => {
    it('should search students by name', async () => {
      await app.inject({
        method: 'POST',
        url: '/students',
        payload: { ...validCreateBody(), firstName: 'Alexander', lastName: 'Hamilton' },
      });
      await app.inject({
        method: 'POST',
        url: '/students',
        payload: { ...validCreateBody(), firstName: 'Bob', lastName: 'Smith' },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/students/search?q=Alexander',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0].firstName).toBe('Alexander');
    });

    it('should search students by national ID', async () => {
      await app.inject({
        method: 'POST',
        url: '/students',
        payload: { ...validCreateBody(), firstName: 'Alice', nationalId: 'NID-FIND-ME' },
      });
      await app.inject({
        method: 'POST',
        url: '/students',
        payload: { ...validCreateBody(), firstName: 'Bob', nationalId: 'NID-OTHER' },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/students/search?q=FIND-ME',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0].nationalId).toBe('NID-FIND-ME');
    });

    it('should return 400 when search query is missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/students/search',
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /students/:id', () => {
    it('should return a single student', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/students',
        payload: validCreateBody(),
      });
      const created = createResponse.json();

      const response = await app.inject({
        method: 'GET',
        url: `/students/${created.id}`,
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.id).toBe(created.id);
      expect(json.firstName).toBe('John');
    });

    it('should return 404 when student does not exist', async () => {
      const fakeId = uuid();
      const response = await app.inject({
        method: 'GET',
        url: `/students/${fakeId}`,
      });

      expect(response.statusCode).toBe(404);
      const json = response.json();
      expect(json.code).toBe('NOT_FOUND');
    });

    it('should return 400 when id is not a valid UUID', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/students/invalid-id',
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('DELETE /students/:id', () => {
    it('should delete a student and return 204', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/students',
        payload: validCreateBody(),
      });
      const created = createResponse.json();

      const response = await app.inject({
        method: 'DELETE',
        url: `/students/${created.id}`,
      });

      expect(response.statusCode).toBe(204);

      // Verify it's gone
      const getResponse = await app.inject({
        method: 'GET',
        url: `/students/${created.id}`,
      });
      expect(getResponse.statusCode).toBe(404);
    });

    it('should return 404 when student does not exist', async () => {
      const fakeId = uuid();
      const response = await app.inject({
        method: 'DELETE',
        url: `/students/${fakeId}`,
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 400 when id is not a valid UUID', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/students/invalid-id',
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
