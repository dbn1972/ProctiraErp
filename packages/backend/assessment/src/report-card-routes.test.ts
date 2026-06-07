/**
 * Report Card Routes Tests
 *
 * Integration tests for report card HTTP endpoints including:
 * - Template CRUD endpoints
 * - Teacher comment endpoints
 * - Report card generation endpoints
 * - Job status endpoint
 *
 * Requirements: 8.7
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';

import { ReportCardService } from './report-card-service.js';
import type { TaskQueuePublisher, PdfGenerator } from './report-card-service.js';
import {
  InMemoryReportCardTemplateRepository,
  InMemoryTeacherCommentRepository,
  InMemoryInstitutionBrandingRepository,
  InMemoryReportCardJobRepository,
} from './in-memory-report-card-repository.js';
import { InMemoryAssessmentResultRepository } from './in-memory-result-repository.js';
import { InMemoryAssessmentItemRepository, InMemoryGradingSchemeRepository } from './in-memory-repository.js';
import { ResultService } from './result-service.js';
import { registerReportCardRoutes } from './report-card-routes.js';

describe('Report Card Routes', () => {
  let app: FastifyInstance;
  let templateRepo: InMemoryReportCardTemplateRepository;
  let brandingRepo: InMemoryInstitutionBrandingRepository;
  const tenantId = uuidv4();

  beforeEach(async () => {
    app = Fastify();

    templateRepo = new InMemoryReportCardTemplateRepository();
    const commentRepo = new InMemoryTeacherCommentRepository();
    brandingRepo = new InMemoryInstitutionBrandingRepository();
    const jobRepo = new InMemoryReportCardJobRepository();

    const resultRepo = new InMemoryAssessmentResultRepository();
    const itemRepo = new InMemoryAssessmentItemRepository();
    const gradingSchemeRepo = new InMemoryGradingSchemeRepository();
    const resultService = new ResultService(resultRepo, itemRepo, gradingSchemeRepo);

    const mockPublisher: TaskQueuePublisher = {
      async publish() {},
    };

    const mockPdfGenerator: PdfGenerator = {
      async generateReportCardPdf() {
        return Buffer.from('pdf');
      },
    };

    const reportCardService = new ReportCardService(
      templateRepo,
      commentRepo,
      brandingRepo,
      jobRepo,
      resultService,
      itemRepo,
      mockPublisher,
      mockPdfGenerator,
    );

    // Add tenant ID to all requests
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = tenantId;
    });

    await registerReportCardRoutes(app, { reportCardService });
    await app.ready();
  });

  // ─── Template Routes ───────────────────────────────────────────────────

  describe('POST /report-cards/templates', () => {
    it('should create a template and return 201', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/report-cards/templates',
        payload: {
          name: 'Standard Report Card',
          templateContent: '<html><body>{{student}}</body></html>',
          isDefault: true,
          includeLogo: true,
          includeGradeSummary: true,
          includeComments: true,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.name).toBe('Standard Report Card');
      expect(body.isDefault).toBe(true);
      expect(body.id).toBeDefined();
    });

    it('should return 400 for missing required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/report-cards/templates',
        payload: {
          name: '', // empty name
          templateContent: '<html></html>',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /report-cards/templates', () => {
    it('should list all templates', async () => {
      await app.inject({
        method: 'POST',
        url: '/report-cards/templates',
        payload: { name: 'Template 1', templateContent: '<html>1</html>' },
      });
      await app.inject({
        method: 'POST',
        url: '/report-cards/templates',
        payload: { name: 'Template 2', templateContent: '<html>2</html>' },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/report-cards/templates',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(2);
    });
  });

  describe('GET /report-cards/templates/:id', () => {
    it('should return a template by ID', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/report-cards/templates',
        payload: { name: 'Fetch Me', templateContent: '<html></html>' },
      });
      const created = createResponse.json();

      const response = await app.inject({
        method: 'GET',
        url: `/report-cards/templates/${created.id}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().name).toBe('Fetch Me');
    });

    it('should return 404 for non-existent template', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/report-cards/templates/${uuidv4()}`,
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /report-cards/templates/:id', () => {
    it('should delete a template and return 204', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/report-cards/templates',
        payload: { name: 'Delete Me', templateContent: '<html></html>' },
      });
      const created = createResponse.json();

      const response = await app.inject({
        method: 'DELETE',
        url: `/report-cards/templates/${created.id}`,
      });

      expect(response.statusCode).toBe(204);
    });
  });

  // ─── Teacher Comment Routes ────────────────────────────────────────────

  describe('POST /report-cards/comments', () => {
    it('should create a teacher comment and return 201', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/report-cards/comments',
        payload: {
          studentId: uuidv4(),
          subjectId: uuidv4(),
          academicPeriodId: uuidv4(),
          teacherId: uuidv4(),
          comment: 'Great work this semester!',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.comment).toBe('Great work this semester!');
    });

    it('should return 400 for comment exceeding 500 characters', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/report-cards/comments',
        payload: {
          studentId: uuidv4(),
          subjectId: uuidv4(),
          academicPeriodId: uuidv4(),
          teacherId: uuidv4(),
          comment: 'x'.repeat(501),
        },
      });

      // The schema validation catches this at 500 chars max
      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /report-cards/comments', () => {
    it('should return comments for a student and period', async () => {
      const studentId = uuidv4();
      const academicPeriodId = uuidv4();

      await app.inject({
        method: 'POST',
        url: '/report-cards/comments',
        payload: {
          studentId,
          subjectId: uuidv4(),
          academicPeriodId,
          teacherId: uuidv4(),
          comment: 'Comment 1',
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/report-cards/comments?studentId=${studentId}&academicPeriodId=${academicPeriodId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(1);
    });
  });

  // ─── Generation Routes ─────────────────────────────────────────────────

  describe('POST /report-cards/generate', () => {
    it('should queue a report card generation and return 202', async () => {
      // Create a template first
      const templateResponse = await app.inject({
        method: 'POST',
        url: '/report-cards/templates',
        payload: { name: 'Gen Template', templateContent: '<html></html>', isDefault: true },
      });
      const template = templateResponse.json();

      const response = await app.inject({
        method: 'POST',
        url: '/report-cards/generate',
        payload: {
          studentId: uuidv4(),
          academicPeriodId: uuidv4(),
          templateId: template.id,
          institutionId: uuidv4(),
        },
      });

      expect(response.statusCode).toBe(202);
      const body = response.json();
      expect(body.status).toBe('queued');
      expect(body.id).toBeDefined();
    });

    it('should return 404 for non-existent template', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/report-cards/generate',
        payload: {
          studentId: uuidv4(),
          academicPeriodId: uuidv4(),
          templateId: uuidv4(),
          institutionId: uuidv4(),
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /report-cards/generate/bulk', () => {
    it('should queue bulk generation and return 202', async () => {
      const templateResponse = await app.inject({
        method: 'POST',
        url: '/report-cards/templates',
        payload: { name: 'Bulk Template', templateContent: '<html></html>' },
      });
      const template = templateResponse.json();

      const response = await app.inject({
        method: 'POST',
        url: '/report-cards/generate/bulk',
        payload: {
          studentIds: [uuidv4(), uuidv4()],
          academicPeriodId: uuidv4(),
          templateId: template.id,
          institutionId: uuidv4(),
        },
      });

      expect(response.statusCode).toBe(202);
      const body = response.json();
      expect(body.totalStudents).toBe(2);
      expect(body.jobsCreated).toBe(2);
      expect(body.jobs).toHaveLength(2);
    });
  });

  describe('GET /report-cards/jobs/:jobId', () => {
    it('should return job status', async () => {
      const templateResponse = await app.inject({
        method: 'POST',
        url: '/report-cards/templates',
        payload: { name: 'Job Template', templateContent: '<html></html>' },
      });
      const template = templateResponse.json();

      const genResponse = await app.inject({
        method: 'POST',
        url: '/report-cards/generate',
        payload: {
          studentId: uuidv4(),
          academicPeriodId: uuidv4(),
          templateId: template.id,
          institutionId: uuidv4(),
        },
      });
      const job = genResponse.json();

      const response = await app.inject({
        method: 'GET',
        url: `/report-cards/jobs/${job.id}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('queued');
    });

    it('should return 404 for non-existent job', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/report-cards/jobs/${uuidv4()}`,
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
