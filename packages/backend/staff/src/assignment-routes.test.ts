/**
 * Unit tests for Staff Assignment Routes (Fastify plugin integration).
 *
 * Tests cover:
 * - POST /staff/assignments - Create with validation
 * - PUT /staff/assignments/:id - Update with validation
 * - GET /staff/assignments - List with pagination/filtering
 * - GET /staff/assignments/:id - Get by ID
 * - DELETE /staff/assignments/:id - Delete
 * - Error responses (400, 404, 409, 422)
 *
 * Requirements:
 * - 7.2: Prevent overlapping assignments
 * - 7.5: Enforce allocation ≤ 100%
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import { InMemoryAssignmentRepository } from './in-memory-assignment-repository.js';
import { StaffAssignmentService } from './assignment-service.js';
import { registerAssignmentRoutes } from './assignment-routes.js';

// Helper to generate valid UUIDs for testing
function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const TENANT_ID = uuid();
const STAFF_ID = uuid();
const INSTITUTION_ID = uuid();
const SUBJECT_ID = uuid();
const CLASS_ID = uuid();

function validCreateBody(overrides: Record<string, unknown> = {}) {
  return {
    staffId: STAFF_ID,
    institutionId: INSTITUTION_ID,
    subjectId: SUBJECT_ID,
    classId: CLASS_ID,
    role: 'Teacher',
    allocationPercentage: 50,
    startDate: '2024-01-01',
    endDate: '2024-06-30',
    ...overrides,
  };
}

describe('Staff Assignment Routes', () => {
  let app: FastifyInstance;
  let repository: InMemoryAssignmentRepository;
  let service: StaffAssignmentService;

  beforeEach(async () => {
    app = Fastify();
    repository = new InMemoryAssignmentRepository();
    service = new StaffAssignmentService(repository);

    // Add tenantId decorator to simulate tenant resolution
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = TENANT_ID;
      (request as unknown as { user: { roles: string[] } }).user = { roles: ['hr_officer'] };
    });

    await registerAssignmentRoutes(app, { assignmentService: service });
    await app.ready();
  });

  describe('POST /staff/assignments', () => {
    it('should create an assignment and return 201', async () => {
      const body = validCreateBody();

      const response = await app.inject({
        method: 'POST',
        url: '/staff/assignments',
        payload: body,
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.id).toBeDefined();
      expect(json.staffId).toBe(body.staffId);
      expect(json.institutionId).toBe(body.institutionId);
      expect(json.subjectId).toBe(body.subjectId);
      expect(json.classId).toBe(body.classId);
      expect(json.role).toBe(body.role);
      expect(json.allocationPercentage).toBe(body.allocationPercentage);
      expect(json.startDate).toBe(body.startDate);
      expect(json.endDate).toBe(body.endDate);
      expect(json.status).toBe('ACTIVE');
    });

    it('should return 400 when required fields are missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/staff/assignments',
        payload: { staffId: STAFF_ID },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.code).toBe('VALIDATION_ERROR');
      expect(json.errors).toBeDefined();
    });

    it('should return 400 when staffId is not a valid UUID', async () => {
      const body = validCreateBody({ staffId: 'not-a-uuid' });

      const response = await app.inject({
        method: 'POST',
        url: '/staff/assignments',
        payload: body,
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 when allocationPercentage is 0', async () => {
      const body = validCreateBody({ allocationPercentage: 0 });

      const response = await app.inject({
        method: 'POST',
        url: '/staff/assignments',
        payload: body,
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 when allocationPercentage exceeds 100', async () => {
      const body = validCreateBody({ allocationPercentage: 101 });

      const response = await app.inject({
        method: 'POST',
        url: '/staff/assignments',
        payload: body,
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 when startDate is not in YYYY-MM-DD format', async () => {
      const body = validCreateBody({ startDate: '01/01/2024' });

      const response = await app.inject({
        method: 'POST',
        url: '/staff/assignments',
        payload: body,
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 409 for overlapping assignment', async () => {
      const body = validCreateBody();

      await app.inject({
        method: 'POST',
        url: '/staff/assignments',
        payload: body,
      });

      // Same institution-subject-class with overlapping dates
      const overlapping = validCreateBody({
        startDate: '2024-03-01',
        endDate: '2024-09-30',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/staff/assignments',
        payload: overlapping,
      });

      expect(response.statusCode).toBe(409);
      const json = response.json();
      expect(json.code).toBe('CONFLICT');
    });

    it('should return 422 when total allocation would exceed 100%', async () => {
      // Create first assignment with 70%
      await app.inject({
        method: 'POST',
        url: '/staff/assignments',
        payload: validCreateBody({ allocationPercentage: 70 }),
      });

      // Try to create second with 40% (total = 110%)
      const response = await app.inject({
        method: 'POST',
        url: '/staff/assignments',
        payload: validCreateBody({
          allocationPercentage: 40,
          institutionId: uuid(),
          subjectId: uuid(),
        }),
      });

      expect(response.statusCode).toBe(422);
      const json = response.json();
      expect(json.code).toBe('BUSINESS_RULE_ERROR');
    });

    it('should return 422 when end date is before start date', async () => {
      const body = validCreateBody({
        startDate: '2024-06-01',
        endDate: '2024-01-01',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/staff/assignments',
        payload: body,
      });

      expect(response.statusCode).toBe(422);
    });
  });

  describe('PUT /staff/assignments/:id', () => {
    it('should update an assignment and return 200', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/staff/assignments',
        payload: validCreateBody(),
      });
      const created = createResponse.json();

      const response = await app.inject({
        method: 'PUT',
        url: `/staff/assignments/${created.id}`,
        payload: { role: 'Senior Teacher', allocationPercentage: 60 },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.role).toBe('Senior Teacher');
      expect(json.allocationPercentage).toBe(60);
    });

    it('should return 404 when assignment does not exist', async () => {
      const fakeId = uuid();
      const response = await app.inject({
        method: 'PUT',
        url: `/staff/assignments/${fakeId}`,
        payload: { role: 'New Role' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 400 when id is not a valid UUID', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/staff/assignments/not-a-uuid',
        payload: { role: 'New Role' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /staff/assignments', () => {
    it('should return paginated list of assignments', async () => {
      for (let i = 0; i < 3; i++) {
        await app.inject({
          method: 'POST',
          url: '/staff/assignments',
          payload: validCreateBody({
            institutionId: uuid(),
            subjectId: uuid(),
            classId: uuid(),
            allocationPercentage: 10,
          }),
        });
      }

      const response = await app.inject({
        method: 'GET',
        url: '/staff/assignments',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data).toHaveLength(3);
      expect(json.meta.totalItems).toBe(3);
    });

    it('should filter by staffId', async () => {
      const otherStaffId = uuid();

      await app.inject({
        method: 'POST',
        url: '/staff/assignments',
        payload: validCreateBody({ allocationPercentage: 30 }),
      });
      await app.inject({
        method: 'POST',
        url: '/staff/assignments',
        payload: validCreateBody({
          staffId: otherStaffId,
          institutionId: uuid(),
          subjectId: uuid(),
          allocationPercentage: 30,
        }),
      });

      const response = await app.inject({
        method: 'GET',
        url: `/staff/assignments?staffId=${STAFF_ID}`,
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0].staffId).toBe(STAFF_ID);
    });

    it('should return empty array when no assignments exist', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/staff/assignments',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data).toHaveLength(0);
      expect(json.meta.totalItems).toBe(0);
    });
  });

  describe('GET /staff/assignments/:id', () => {
    it('should return a single assignment', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/staff/assignments',
        payload: validCreateBody(),
      });
      const created = createResponse.json();

      const response = await app.inject({
        method: 'GET',
        url: `/staff/assignments/${created.id}`,
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.id).toBe(created.id);
    });

    it('should return 404 when assignment does not exist', async () => {
      const fakeId = uuid();
      const response = await app.inject({
        method: 'GET',
        url: `/staff/assignments/${fakeId}`,
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 400 when id is not a valid UUID', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/staff/assignments/invalid-id',
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('DELETE /staff/assignments/:id', () => {
    it('should delete an assignment and return 204', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/staff/assignments',
        payload: validCreateBody(),
      });
      const created = createResponse.json();

      const response = await app.inject({
        method: 'DELETE',
        url: `/staff/assignments/${created.id}`,
      });

      expect(response.statusCode).toBe(204);

      // Verify it's gone
      const getResponse = await app.inject({
        method: 'GET',
        url: `/staff/assignments/${created.id}`,
      });
      expect(getResponse.statusCode).toBe(404);
    });

    it('should return 404 when assignment does not exist', async () => {
      const fakeId = uuid();
      const response = await app.inject({
        method: 'DELETE',
        url: `/staff/assignments/${fakeId}`,
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 400 when id is not a valid UUID', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/staff/assignments/invalid-id',
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
