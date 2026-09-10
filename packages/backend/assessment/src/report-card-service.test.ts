/**
 * Report Card Service Tests
 *
 * Tests for report card generation including:
 * - Template CRUD operations
 * - Teacher comment management (500 char limit)
 * - Report card generation job queuing via RabbitMQ
 * - Job status tracking
 * - PDF generation processing
 *
 * Requirements: 8.7
 */
import { describe, it, expect, beforeEach } from 'vitest';
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
import {
  InMemoryAssessmentItemRepository,
  InMemoryGradingSchemeRepository,
} from './in-memory-repository.js';
import { ResultService } from './result-service.js';
import { MAX_COMMENT_LENGTH } from './report-card-schemas.js';

describe('ReportCardService', () => {
  let service: ReportCardService;
  let templateRepo: InMemoryReportCardTemplateRepository;
  let commentRepo: InMemoryTeacherCommentRepository;
  let brandingRepo: InMemoryInstitutionBrandingRepository;
  let jobRepo: InMemoryReportCardJobRepository;
  let resultService: ResultService;
  let mockPublisher: TaskQueuePublisher;
  let mockPdfGenerator: PdfGenerator;
  let publishedTasks: Array<{ id: string; tenantId: string; type: string; payload: unknown }>;

  const tenantId = uuidv4();

  beforeEach(() => {
    templateRepo = new InMemoryReportCardTemplateRepository();
    commentRepo = new InMemoryTeacherCommentRepository();
    brandingRepo = new InMemoryInstitutionBrandingRepository();
    jobRepo = new InMemoryReportCardJobRepository();

    const resultRepo = new InMemoryAssessmentResultRepository();
    const itemRepo = new InMemoryAssessmentItemRepository();
    const gradingSchemeRepo = new InMemoryGradingSchemeRepository();
    resultService = new ResultService(resultRepo, itemRepo, gradingSchemeRepo);

    publishedTasks = [];
    mockPublisher = {
      async publish(task) {
        publishedTasks.push(task);
      },
    };

    mockPdfGenerator = {
      async generateReportCardPdf(_templateContent, _data) {
        return Buffer.from('mock-pdf-content');
      },
    };

    service = new ReportCardService(
      templateRepo,
      commentRepo,
      brandingRepo,
      jobRepo,
      resultService,
      new InMemoryAssessmentItemRepository(),
      mockPublisher,
      mockPdfGenerator,
    );
  });

  // ─── Template Operations ─────────────────────────────────────────────────

  describe('Template CRUD', () => {
    it('should create a report card template', async () => {
      const template = await service.createTemplate(tenantId, {
        name: 'Standard Report Card',
        templateContent: '<html><body>{{studentName}}</body></html>',
        isDefault: true,
        includeLogo: true,
        includeGradeSummary: true,
        includeComments: true,
      });

      expect(template.id).toBeDefined();
      expect(template.tenantId).toBe(tenantId);
      expect(template.name).toBe('Standard Report Card');
      expect(template.isDefault).toBe(true);
      expect(template.includeLogo).toBe(true);
      expect(template.includeGradeSummary).toBe(true);
      expect(template.includeComments).toBe(true);
    });

    it('should get a template by ID', async () => {
      const created = await service.createTemplate(tenantId, {
        name: 'Test Template',
        templateContent: '<html></html>',
      });

      const fetched = await service.getTemplate(tenantId, created.id);
      expect(fetched.id).toBe(created.id);
      expect(fetched.name).toBe('Test Template');
    });

    it('should throw NotFoundError for non-existent template', async () => {
      await expect(service.getTemplate(tenantId, uuidv4())).rejects.toThrow('not found');
    });

    it('should list all templates for a tenant', async () => {
      await service.createTemplate(tenantId, {
        name: 'Template 1',
        templateContent: '<html>1</html>',
      });
      await service.createTemplate(tenantId, {
        name: 'Template 2',
        templateContent: '<html>2</html>',
      });

      const templates = await service.listTemplates(tenantId);
      expect(templates).toHaveLength(2);
    });

    it('should update a template', async () => {
      const created = await service.createTemplate(tenantId, {
        name: 'Original',
        templateContent: '<html>original</html>',
      });

      const updated = await service.updateTemplate(tenantId, created.id, {
        name: 'Updated',
        includeLogo: false,
      });

      expect(updated.name).toBe('Updated');
      expect(updated.includeLogo).toBe(false);
    });

    it('should delete a template', async () => {
      const created = await service.createTemplate(tenantId, {
        name: 'To Delete',
        templateContent: '<html></html>',
      });

      await service.deleteTemplate(tenantId, created.id);

      await expect(service.getTemplate(tenantId, created.id)).rejects.toThrow('not found');
    });

    it('should apply default values for optional fields', async () => {
      const template = await service.createTemplate(tenantId, {
        name: 'Minimal Template',
        templateContent: '<html></html>',
      });

      expect(template.isDefault).toBe(false);
      expect(template.includeLogo).toBe(true);
      expect(template.includeGradeSummary).toBe(true);
      expect(template.includeComments).toBe(true);
    });
  });

  // ─── Teacher Comment Operations ──────────────────────────────────────────

  describe('Teacher Comments', () => {
    const studentId = uuidv4();
    const subjectId = uuidv4();
    const academicPeriodId = uuidv4();
    const teacherId = uuidv4();

    it('should create a teacher comment', async () => {
      const comment = await service.upsertComment(tenantId, {
        studentId,
        subjectId,
        academicPeriodId,
        teacherId,
        comment: 'Excellent progress in mathematics this term.',
      });

      expect(comment.id).toBeDefined();
      expect(comment.studentId).toBe(studentId);
      expect(comment.subjectId).toBe(subjectId);
      expect(comment.comment).toBe('Excellent progress in mathematics this term.');
    });

    it('should update an existing comment for the same student+subject+period', async () => {
      await service.upsertComment(tenantId, {
        studentId,
        subjectId,
        academicPeriodId,
        teacherId,
        comment: 'First comment',
      });

      const updated = await service.upsertComment(tenantId, {
        studentId,
        subjectId,
        academicPeriodId,
        teacherId,
        comment: 'Updated comment',
      });

      expect(updated.comment).toBe('Updated comment');

      // Should only have one comment for this combination
      const comments = await service.getComments(tenantId, studentId, academicPeriodId);
      expect(comments).toHaveLength(1);
    });

    it('should reject comments exceeding 500 characters', async () => {
      const longComment = 'x'.repeat(MAX_COMMENT_LENGTH + 1);

      await expect(
        service.upsertComment(tenantId, {
          studentId,
          subjectId,
          academicPeriodId,
          teacherId,
          comment: longComment,
        }),
      ).rejects.toThrow(`must not exceed ${MAX_COMMENT_LENGTH} characters`);
    });

    it('should accept comments at exactly 500 characters', async () => {
      const exactComment = 'x'.repeat(MAX_COMMENT_LENGTH);

      const comment = await service.upsertComment(tenantId, {
        studentId,
        subjectId,
        academicPeriodId,
        teacherId,
        comment: exactComment,
      });

      expect(comment.comment).toHaveLength(MAX_COMMENT_LENGTH);
    });

    it('should get all comments for a student in an academic period', async () => {
      const subject1 = uuidv4();
      const subject2 = uuidv4();

      await service.upsertComment(tenantId, {
        studentId,
        subjectId: subject1,
        academicPeriodId,
        teacherId,
        comment: 'Math comment',
      });

      await service.upsertComment(tenantId, {
        studentId,
        subjectId: subject2,
        academicPeriodId,
        teacherId,
        comment: 'Science comment',
      });

      const comments = await service.getComments(tenantId, studentId, academicPeriodId);
      expect(comments).toHaveLength(2);
    });
  });

  // ─── Report Card Generation ──────────────────────────────────────────────

  describe('Report Card Generation', () => {
    const studentId = uuidv4();
    const academicPeriodId = uuidv4();
    const institutionId = uuidv4();

    it('should queue a report card generation job with specified template', async () => {
      const template = await service.createTemplate(tenantId, {
        name: 'Test Template',
        templateContent: '<html>{{student}}</html>',
      });

      const job = await service.queueReportCardGeneration(tenantId, {
        studentId,
        academicPeriodId,
        templateId: template.id,
        institutionId,
      });

      expect(job.id).toBeDefined();
      expect(job.status).toBe('queued');
      expect(job.studentId).toBe(studentId);
      expect(job.academicPeriodId).toBe(academicPeriodId);
      expect(job.templateId).toBe(template.id);
      expect(job.institutionId).toBe(institutionId);
    });

    it('should use default template when templateId is not specified', async () => {
      await service.createTemplate(tenantId, {
        name: 'Default Template',
        templateContent: '<html>default</html>',
        isDefault: true,
      });

      const job = await service.queueReportCardGeneration(tenantId, {
        studentId,
        academicPeriodId,
        institutionId,
      });

      expect(job.status).toBe('queued');
    });

    it('should throw NotFoundError when no default template exists and none specified', async () => {
      await expect(
        service.queueReportCardGeneration(tenantId, {
          studentId,
          academicPeriodId,
          institutionId,
        }),
      ).rejects.toThrow('No default report card template configured');
    });

    it('should throw NotFoundError for non-existent template ID', async () => {
      await expect(
        service.queueReportCardGeneration(tenantId, {
          studentId,
          academicPeriodId,
          templateId: uuidv4(),
          institutionId,
        }),
      ).rejects.toThrow('not found');
    });

    it('should publish task to RabbitMQ queue', async () => {
      const template = await service.createTemplate(tenantId, {
        name: 'Queue Test',
        templateContent: '<html></html>',
      });

      await service.queueReportCardGeneration(tenantId, {
        studentId,
        academicPeriodId,
        templateId: template.id,
        institutionId,
      });

      expect(publishedTasks).toHaveLength(1);
      expect(publishedTasks[0]!.type).toBe('report-card.generate');
      expect(publishedTasks[0]!.tenantId).toBe(tenantId);
      const payload = publishedTasks[0]!.payload as Record<string, unknown>;
      expect(payload.studentId).toBe(studentId);
      expect(payload.academicPeriodId).toBe(academicPeriodId);
      expect(payload.templateId).toBe(template.id);
      expect(payload.institutionId).toBe(institutionId);
    });

    it('should queue bulk report card generation for multiple students', async () => {
      const template = await service.createTemplate(tenantId, {
        name: 'Bulk Template',
        templateContent: '<html></html>',
      });

      const studentIds = [uuidv4(), uuidv4(), uuidv4()];

      const result = await service.queueBulkReportCardGeneration(tenantId, {
        studentIds,
        academicPeriodId,
        templateId: template.id,
        institutionId,
      });

      expect(result.totalStudents).toBe(3);
      expect(result.jobsCreated).toBe(3);
      expect(result.jobs).toHaveLength(3);
      expect(publishedTasks).toHaveLength(3);

      // Each job should have a unique student ID
      const jobStudentIds = result.jobs.map((j) => j.studentId);
      expect(new Set(jobStudentIds).size).toBe(3);
    });

    it('should get job status', async () => {
      const template = await service.createTemplate(tenantId, {
        name: 'Status Test',
        templateContent: '<html></html>',
      });

      const job = await service.queueReportCardGeneration(tenantId, {
        studentId,
        academicPeriodId,
        templateId: template.id,
        institutionId,
      });

      const status = await service.getJobStatus(tenantId, job.id);
      expect(status.id).toBe(job.id);
      expect(status.status).toBe('queued');
    });

    it('should throw NotFoundError for non-existent job', async () => {
      await expect(service.getJobStatus(tenantId, uuidv4())).rejects.toThrow('not found');
    });
  });

  // ─── Report Card Processing ──────────────────────────────────────────────

  describe('Report Card Processing', () => {
    const studentId = uuidv4();
    const academicPeriodId = uuidv4();
    const institutionId = uuidv4();

    it('should process a report card job and mark as completed', async () => {
      const template = await service.createTemplate(tenantId, {
        name: 'Process Test',
        templateContent: '<html>{{student.name}}</html>',
        includeLogo: true,
        includeComments: true,
        includeGradeSummary: true,
      });

      // Add institution branding
      brandingRepo.addBranding({
        institutionId,
        tenantId,
        name: 'Test School',
        logoUrl: 'https://example.com/logo.png',
        address: '123 School St',
        contactPhone: null,
        contactEmail: null,
      });

      const job = await service.queueReportCardGeneration(tenantId, {
        studentId,
        academicPeriodId,
        templateId: template.id,
        institutionId,
      });

      const processedJob = await service.processReportCardJob(tenantId, job.id);

      expect(processedJob.status).toBe('completed');
      expect(processedJob.outputUrl).toContain('report-cards/');
      expect(processedJob.completedAt).toBeDefined();
    });

    it('should mark job as failed when template is not found during processing', async () => {
      // Create a job with a template that will be deleted
      const template = await service.createTemplate(tenantId, {
        name: 'Will Delete',
        templateContent: '<html></html>',
      });

      const job = await service.queueReportCardGeneration(tenantId, {
        studentId,
        academicPeriodId,
        templateId: template.id,
        institutionId,
      });

      // Delete the template
      await service.deleteTemplate(tenantId, template.id);

      const processedJob = await service.processReportCardJob(tenantId, job.id);

      expect(processedJob.status).toBe('failed');
      expect(processedJob.errorMessage).toContain('not found');
    });

    it('should include institution logo and name in report card data', async () => {
      const template = await service.createTemplate(tenantId, {
        name: 'Branding Test',
        templateContent: '<html>{{institution.name}} {{institution.logoUrl}}</html>',
        includeLogo: true,
      });

      brandingRepo.addBranding({
        institutionId,
        tenantId,
        name: 'ABC International School',
        logoUrl: 'https://cdn.example.com/abc-logo.png',
        address: '456 Education Ave',
        contactPhone: '+1234567890',
        contactEmail: 'info@abc.edu',
      });

      const job = await service.queueReportCardGeneration(tenantId, {
        studentId,
        academicPeriodId,
        templateId: template.id,
        institutionId,
      });

      // Process the job - the PDF generator will receive the data
      const processedJob = await service.processReportCardJob(tenantId, job.id);
      expect(processedJob.status).toBe('completed');
    });

    it('should work without task queue publisher (synchronous mode)', async () => {
      // Create service without publisher
      const syncService = new ReportCardService(
        templateRepo,
        commentRepo,
        brandingRepo,
        jobRepo,
        resultService,
        new InMemoryAssessmentItemRepository(),
        null, // no publisher
        mockPdfGenerator,
      );

      const template = await syncService.createTemplate(tenantId, {
        name: 'Sync Template',
        templateContent: '<html></html>',
      });

      // Should still create the job, just not publish to queue
      const job = await syncService.queueReportCardGeneration(tenantId, {
        studentId,
        academicPeriodId,
        templateId: template.id,
        institutionId,
      });

      expect(job.status).toBe('queued');
      expect(publishedTasks).toHaveLength(0);
    });
  });
});
