/**
 * Scholarship Routes Integration Tests
 *
 * Tests HTTP routes for scholarship program management, applications,
 * disbursements, compliance, and reports.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { scholarshipPlugin } from './scholarship-plugin.js';
import { InMemoryScholarshipRepository } from './in-memory-repository.js';
import type { WorkflowEngineClient } from './scholarship-service.js';

const TENANT_ID = 'tenant-001';

function createApp(): FastifyInstance {
  const app = Fastify({ logger: false });

  // Add tenant context decorator
  app.decorateRequest('tenantId', '');
  app.addHook('onRequest', async (request) => {
    (request as any).tenantId = TENANT_ID;
  });

  return app;
}

describe('Scholarship Routes', () => {
  let app: FastifyInstance;
  let repository: InMemoryScholarshipRepository;
  let mockWorkflowEngine: WorkflowEngineClient;

  beforeEach(async () => {
    repository = new InMemoryScholarshipRepository();
    mockWorkflowEngine = {
      createInstance: async () => 'workflow-instance-001',
    };

    app = createApp();
    await app.register(scholarshipPlugin, {
      repository,
      workflowEngine: mockWorkflowEngine,
    });
    await app.ready();
  });

  // ─── Program Routes ────────────────────────────────────────────────────

  describe('POST /scholarships/programs', () => {
    it('should create a scholarship program', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/scholarships/programs',
        payload: {
          name: 'Merit Scholarship 2024',
          applicationStartDate: '2024-01-01',
          applicationEndDate: '2024-06-30',
          totalSlots: 50,
          amountPerRecipient: 5000,
          eligibility: { minGPA: 3.0 },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.name).toBe('Merit Scholarship 2024');
      expect(body.totalSlots).toBe(50);
      expect(body.status).toBe('draft');
    });

    it('should return 400 for invalid date range', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/scholarships/programs',
        payload: {
          name: 'Test',
          applicationStartDate: '2024-07-01',
          applicationEndDate: '2024-01-01',
          totalSlots: 10,
          amountPerRecipient: 1000,
          eligibility: {},
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 for missing required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/scholarships/programs',
        payload: {
          name: 'Test',
          // Missing required fields
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /scholarships/programs', () => {
    it('should list scholarship programs', async () => {
      // Create a program first
      await app.inject({
        method: 'POST',
        url: '/scholarships/programs',
        payload: {
          name: 'Test Program',
          applicationStartDate: '2024-01-01',
          applicationEndDate: '2024-06-30',
          totalSlots: 10,
          amountPerRecipient: 1000,
          eligibility: {},
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/scholarships/programs',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.length).toBe(1);
      expect(body.meta.totalItems).toBe(1);
    });
  });

  describe('GET /scholarships/programs/:id', () => {
    it('should get a program by ID', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/scholarships/programs',
        payload: {
          name: 'Test Program',
          applicationStartDate: '2024-01-01',
          applicationEndDate: '2024-06-30',
          totalSlots: 10,
          amountPerRecipient: 1000,
          eligibility: {},
        },
      });
      const created = JSON.parse(createResponse.payload);

      const response = await app.inject({
        method: 'GET',
        url: `/scholarships/programs/${created.id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.id).toBe(created.id);
      expect(body.name).toBe('Test Program');
    });

    it('should return 404 for non-existent program', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/scholarships/programs/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('PUT /scholarships/programs/:id', () => {
    it('should update a program', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/scholarships/programs',
        payload: {
          name: 'Original Name',
          applicationStartDate: '2024-01-01',
          applicationEndDate: '2024-06-30',
          totalSlots: 10,
          amountPerRecipient: 1000,
          eligibility: {},
        },
      });
      const created = JSON.parse(createResponse.payload);

      const response = await app.inject({
        method: 'PUT',
        url: `/scholarships/programs/${created.id}`,
        payload: { name: 'Updated Name', status: 'open' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.name).toBe('Updated Name');
      expect(body.status).toBe('open');
    });
  });

  describe('DELETE /scholarships/programs/:id', () => {
    it('should delete a program with no applications', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/scholarships/programs',
        payload: {
          name: 'To Delete',
          applicationStartDate: '2024-01-01',
          applicationEndDate: '2024-06-30',
          totalSlots: 10,
          amountPerRecipient: 1000,
          eligibility: {},
        },
      });
      const created = JSON.parse(createResponse.payload);

      const response = await app.inject({
        method: 'DELETE',
        url: `/scholarships/programs/${created.id}`,
      });

      expect(response.statusCode).toBe(204);
    });
  });

  // ─── Application Routes ────────────────────────────────────────────────

  describe('POST /scholarships/applications', () => {
    it('should submit an application', async () => {
      // Create and open a program
      const createResponse = await app.inject({
        method: 'POST',
        url: '/scholarships/programs',
        payload: {
          name: 'Open Program',
          applicationStartDate: '2020-01-01',
          applicationEndDate: '2030-12-31',
          totalSlots: 50,
          amountPerRecipient: 5000,
          eligibility: {},
        },
      });
      const program = JSON.parse(createResponse.payload);

      await app.inject({
        method: 'PUT',
        url: `/scholarships/programs/${program.id}`,
        payload: { status: 'open' },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/scholarships/applications',
        payload: {
          programId: program.id,
          applicantId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
          institutionId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
          academicRecords: [
            { institutionName: 'Test Uni', educationLevel: 'undergraduate', gpa: 3.5 },
          ],
          financialInfo: { familyIncome: 30000 },
          documents: [],
          gender: 'female',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.programId).toBe(program.id);
      expect(body.status).toBe('under_review');
    });

    it('should return 400 for missing required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/scholarships/applications',
        payload: {
          // Missing required fields
          programId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ─── Report Routes ─────────────────────────────────────────────────────

  describe('GET /scholarships/reports/utilization', () => {
    it('should return utilization report', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/scholarships/reports/utilization?groupBy=program',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.totalPrograms).toBeDefined();
      expect(body.totalApplications).toBeDefined();
      expect(body.breakdown).toBeDefined();
      expect(body.generatedAt).toBeDefined();
    });
  });
});
