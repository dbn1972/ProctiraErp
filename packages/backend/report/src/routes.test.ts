/**
 * Report Routes Integration Tests
 *
 * Tests the Fastify routes for the report engine.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import { ReportService } from './report-service.js';
import { InMemoryReportRepository } from './in-memory-repository.js';
import { registerReportRoutes } from './routes.js';
import type {
  ReportDataSource,
  ReportUserContext,
  ReportDataResult,
} from './report-repository.js';
import type { AggregationConfig } from './schemas.js';

// ─── Test Helpers ────────────────────────────────────────────────────────────

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

class MockDataSource implements ReportDataSource {
  async fetchData(
    _tenantId: string,
    _reportType: string,
    _filters: Record<string, unknown>,
    _groupBy: string[] | null,
    _aggregations: AggregationConfig[] | null,
    _userContext: ReportUserContext,
  ): Promise<ReportDataResult> {
    return {
      rows: [
        { name: 'Student A', score: 85 },
        { name: 'Student B', score: 72 },
      ],
      columns: [
        { name: 'name', type: 'string', label: 'Name' },
        { name: 'score', type: 'number', label: 'Score' },
      ],
      totalRows: 2,
    };
  }
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  const repository = new InMemoryReportRepository();
  const dataSource = new MockDataSource();
  const service = new ReportService(repository, dataSource);

  // Add tenant context decorator
  app.decorateRequest('tenantId', '');
  app.addHook('onRequest', async (request) => {
    (request as typeof request & { tenantId: string }).tenantId = TENANT_ID;
  });

  // Add user context
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (request) => {
    (request as typeof request & { user: unknown }).user = {
      sub: '22222222-2222-4222-8222-222222222222',
      roles: [{ roleId: 'admin', areaId: 'area-1' }],
      areas: ['area-1'],
      institutions: ['inst-1'],
    };
  });

  await registerReportRoutes(app, { reportService: service });
  return app;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Report Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
  });

  describe('POST /reports/generate', () => {
    it('should generate a report and return 202', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/reports/generate',
        payload: {
          reportType: 'student_enrollment',
          format: 'csv',
          filters: { status: 'enrolled' },
        },
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);
      expect(body.id).toBeDefined();
      expect(body.reportType).toBe('student_enrollment');
      expect(body.format).toBe('csv');
      expect(body.status).toBe('completed');
    });

    it('should return 400 for invalid format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/reports/generate',
        payload: {
          reportType: 'test',
          format: 'invalid',
          filters: {},
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for missing reportType', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/reports/generate',
        payload: {
          format: 'csv',
          filters: {},
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /reports/jobs/:jobId', () => {
    it('should return job status', async () => {
      // First generate a report
      const genResponse = await app.inject({
        method: 'POST',
        url: '/reports/generate',
        payload: {
          reportType: 'test',
          format: 'csv',
          filters: {},
        },
      });
      const job = JSON.parse(genResponse.body);

      // Then check status
      const response = await app.inject({
        method: 'GET',
        url: `/reports/jobs/${job.id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe(job.id);
      expect(body.status).toBe('completed');
    });

    it('should return 404 for non-existent job', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/reports/jobs/99999999-9999-4999-8999-999999999999',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /reports/templates', () => {
    it('should create a template and return 201', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/reports/templates',
        payload: {
          name: 'Student Report Card',
          type: 'report_card',
          format: 'pdf',
          layout: '<h1>{{title}}</h1>',
          mergeFields: [{ name: 'title', source: 'title' }],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.name).toBe('Student Report Card');
      expect(body.type).toBe('report_card');
    });

    it('should return 400 for missing required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/reports/templates',
        payload: {
          name: 'Incomplete',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /reports/templates', () => {
    it('should list templates', async () => {
      // Create a template first
      await app.inject({
        method: 'POST',
        url: '/reports/templates',
        payload: {
          name: 'Template 1',
          type: 'report_card',
          format: 'pdf',
          layout: 'x',
          mergeFields: [],
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/reports/templates',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(1);
    });
  });

  describe('POST /reports/schedules', () => {
    it('should create a scheduled report and return 201', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/reports/schedules',
        payload: {
          name: 'Weekly Report',
          reportType: 'attendance_summary',
          format: 'xlsx',
          filters: {},
          cronExpression: '0 8 * * 1',
          deliveryMethod: 'email',
          recipientEmails: ['admin@school.org'],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.name).toBe('Weekly Report');
      expect(body.isActive).toBe(true);
      expect(body.cronExpression).toBe('0 8 * * 1');
    });

    it('should return 400 for email delivery without recipients', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/reports/schedules',
        payload: {
          name: 'No Recipients',
          reportType: 'test',
          format: 'csv',
          filters: {},
          cronExpression: '0 8 * * 1',
          deliveryMethod: 'email',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('DELETE /reports/templates/:templateId', () => {
    it('should delete a template and return 204', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/reports/templates',
        payload: {
          name: 'To Delete',
          type: 'report_card',
          format: 'pdf',
          layout: 'x',
          mergeFields: [],
        },
      });
      const template = JSON.parse(createResponse.body);

      const response = await app.inject({
        method: 'DELETE',
        url: `/reports/templates/${template.id}`,
      });

      expect(response.statusCode).toBe(204);
    });

    it('should return 404 for non-existent template', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/reports/templates/99999999-9999-4999-8999-999999999999',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /reports/schedules/:scheduleId', () => {
    it('should delete a schedule and return 204', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/reports/schedules',
        payload: {
          name: 'To Delete',
          reportType: 'test',
          format: 'csv',
          filters: {},
          cronExpression: '0 8 * * 1',
          deliveryMethod: 'in_app',
        },
      });
      const schedule = JSON.parse(createResponse.body);

      const response = await app.inject({
        method: 'DELETE',
        url: `/reports/schedules/${schedule.id}`,
      });

      expect(response.statusCode).toBe(204);
    });
  });
});
