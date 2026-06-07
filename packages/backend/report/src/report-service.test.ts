/**
 * Report Service Unit Tests
 *
 * Tests for:
 * - Report generation with filters, grouping, aggregation
 * - Multi-format export (XLSX, PDF, CSV)
 * - Report card template rendering with merge fields and conditional sections
 * - Background processing via queue
 * - RBAC-scoped data filtering
 * - Scheduled report management
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { NotFoundError, ValidationError, BusinessRuleError } from '@proctira/common';

import { ReportService } from './report-service.js';
import { InMemoryReportRepository } from './in-memory-repository.js';
import type {
  ReportDataSource,
  ReportUserContext,
  ReportDataResult,
  ReportJobEntity,
  ReportTemplateEntity,
} from './report-repository.js';
import type { AggregationConfig } from './schemas.js';

// ─── Test Helpers ────────────────────────────────────────────────────────────

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const TEMPLATE_ID = '33333333-3333-4333-8333-333333333333';

function createUserContext(overrides?: Partial<ReportUserContext>): ReportUserContext {
  return {
    userId: USER_ID,
    tenantId: TENANT_ID,
    roleId: 'admin-role',
    areaId: 'area-1',
    institutionIds: ['inst-1'],
    accessibleAreaIds: ['area-1', 'area-2'],
    ...overrides,
  };
}

class MockDataSource implements ReportDataSource {
  public lastCall: {
    tenantId: string;
    reportType: string;
    filters: Record<string, unknown>;
    groupBy: string[] | null;
    aggregations: AggregationConfig[] | null;
    userContext: ReportUserContext;
  } | null = null;

  private result: ReportDataResult = {
    rows: [
      { name: 'Student A', score: 85, grade: 'A' },
      { name: 'Student B', score: 72, grade: 'B' },
    ],
    columns: [
      { name: 'name', type: 'string', label: 'Name' },
      { name: 'score', type: 'number', label: 'Score' },
      { name: 'grade', type: 'string', label: 'Grade' },
    ],
    totalRows: 2,
  };

  setResult(result: ReportDataResult): void {
    this.result = result;
  }

  async fetchData(
    tenantId: string,
    reportType: string,
    filters: Record<string, unknown>,
    groupBy: string[] | null,
    aggregations: AggregationConfig[] | null,
    userContext: ReportUserContext,
  ): Promise<ReportDataResult> {
    this.lastCall = { tenantId, reportType, filters, groupBy, aggregations, userContext };
    return this.result;
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ReportService', () => {
  let repository: InMemoryReportRepository;
  let dataSource: MockDataSource;
  let service: ReportService;

  beforeEach(() => {
    repository = new InMemoryReportRepository();
    dataSource = new MockDataSource();
    service = new ReportService(repository, dataSource);
  });

  describe('generateReport', () => {
    it('should create a report job and process it synchronously when no queue', async () => {
      const userContext = createUserContext();
      const job = await service.generateReport(
        TENANT_ID,
        {
          reportType: 'student_enrollment',
          format: 'csv',
          filters: { status: 'enrolled' },
          groupBy: ['grade'],
        },
        userContext,
      );

      expect(job.id).toBeDefined();
      expect(job.tenantId).toBe(TENANT_ID);
      expect(job.reportType).toBe('student_enrollment');
      expect(job.format).toBe('csv');
      expect(job.status).toBe('completed');
      expect(job.requestedBy).toBe(USER_ID);
      expect(job.rowCount).toBe(2);
    });

    it('should pass filters and groupBy to data source', async () => {
      const userContext = createUserContext();
      await service.generateReport(
        TENANT_ID,
        {
          reportType: 'attendance_summary',
          format: 'xlsx',
          filters: { institutionId: 'inst-1', period: '2024' },
          groupBy: ['class', 'month'],
          aggregations: [{ field: 'attendance', type: 'avg' }],
        },
        userContext,
      );

      expect(dataSource.lastCall).not.toBeNull();
      expect(dataSource.lastCall!.reportType).toBe('attendance_summary');
      expect(dataSource.lastCall!.filters).toEqual({ institutionId: 'inst-1', period: '2024' });
      expect(dataSource.lastCall!.groupBy).toEqual(['class', 'month']);
      expect(dataSource.lastCall!.aggregations).toEqual([{ field: 'attendance', type: 'avg' }]);
      expect(dataSource.lastCall!.userContext).toEqual(userContext);
    });

    it('should throw NotFoundError if templateId does not exist', async () => {
      const userContext = createUserContext();
      await expect(
        service.generateReport(
          TENANT_ID,
          {
            reportType: 'report_card',
            format: 'pdf',
            filters: {},
            templateId: '99999999-9999-4999-8999-999999999999',
          },
          userContext,
        ),
      ).rejects.toThrow(NotFoundError);
    });

    it('should queue report when queuePublisher is provided', async () => {
      const queued: ReportJobEntity[] = [];
      const queuePublisher = {
        queueReportJob: async (job: ReportJobEntity) => { queued.push(job); },
        queueScheduledReport: async () => {},
      };

      const serviceWithQueue = new ReportService(
        repository,
        dataSource,
        undefined,
        undefined,
        undefined,
        queuePublisher,
      );

      const userContext = createUserContext();
      const job = await serviceWithQueue.generateReport(
        TENANT_ID,
        {
          reportType: 'student_enrollment',
          format: 'xlsx',
          filters: {},
        },
        userContext,
      );

      expect(job.status).toBe('queued');
      expect(queued).toHaveLength(1);
      expect(queued[0]!.id).toBe(job.id);
    });

    it('should handle data source errors gracefully', async () => {
      const failingDataSource: ReportDataSource = {
        async fetchData() {
          throw new Error('Database connection failed');
        },
      };

      const serviceWithFailure = new ReportService(repository, failingDataSource);
      const userContext = createUserContext();

      const job = await serviceWithFailure.generateReport(
        TENANT_ID,
        { reportType: 'test', format: 'csv', filters: {} },
        userContext,
      );

      expect(job.status).toBe('failed');
      expect(job.errorMessage).toBe('Database connection failed');
    });
  });

  describe('CSV export', () => {
    it('should generate valid CSV output', async () => {
      const userContext = createUserContext();
      const job = await service.generateReport(
        TENANT_ID,
        { reportType: 'test', format: 'csv', filters: {} },
        userContext,
      );

      expect(job.status).toBe('completed');
      expect(job.fileSize).toBeGreaterThan(0);
    });
  });

  describe('XLSX export', () => {
    it('should generate XLSX output (default TSV placeholder)', async () => {
      const userContext = createUserContext();
      const job = await service.generateReport(
        TENANT_ID,
        { reportType: 'test', format: 'xlsx', filters: {} },
        userContext,
      );

      expect(job.status).toBe('completed');
      expect(job.fileSize).toBeGreaterThan(0);
    });
  });

  describe('PDF export', () => {
    it('should generate PDF output (default text placeholder)', async () => {
      const userContext = createUserContext();
      const job = await service.generateReport(
        TENANT_ID,
        { reportType: 'test', format: 'pdf', filters: {} },
        userContext,
      );

      expect(job.status).toBe('completed');
      expect(job.fileSize).toBeGreaterThan(0);
    });
  });

  describe('Template rendering', () => {
    let template: ReportTemplateEntity;

    beforeEach(async () => {
      template = await repository.createTemplate({
        id: TEMPLATE_ID,
        tenantId: TENANT_ID,
        name: 'Student Report Card',
        type: 'report_card',
        format: 'pdf',
        layout: 'Name: {{studentName}}\nScore: {{score}}\n{{#section honors}}Honors Student{{/section honors}}',
        mergeFields: [
          { name: 'studentName', source: 'name' },
          { name: 'score', source: 'score' },
        ],
        conditionalSections: [
          { name: 'honors', condition: 'score >= 80', content: 'Honors Student' },
        ],
        branding: { institutionName: 'Test School', logoUrl: 'https://example.com/logo.png' },
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it('should render merge fields in template', () => {
      const rendered = service.renderTemplate(
        'Hello {{name}}, your score is {{score}}',
        { name: 'Alice', score: 95 },
        template,
      );
      expect(rendered).toBe('Hello Alice, your score is 95');
    });

    it('should render conditional sections when condition is met', () => {
      const rendered = service.renderTemplate(
        'Report\n{{#section honors}}Congratulations!{{/section honors}}\nEnd',
        { score: 90 },
        template,
      );
      expect(rendered).toContain('Congratulations!');
    });

    it('should remove conditional sections when condition is not met', () => {
      const rendered = service.renderTemplate(
        'Report\n{{#section honors}}Congratulations!{{/section honors}}\nEnd',
        { score: 50 },
        template,
      );
      expect(rendered).not.toContain('Congratulations!');
      expect(rendered).toContain('Report');
      expect(rendered).toContain('End');
    });

    it('should handle missing merge field values gracefully', () => {
      const rendered = service.renderTemplate(
        'Hello {{name}}, age: {{age}}',
        { name: 'Bob' },
        template,
      );
      expect(rendered).toBe('Hello Bob, age: ');
    });
  });

  describe('evaluateCondition', () => {
    it('should evaluate >= correctly', () => {
      expect(service.evaluateCondition('score >= 80', { score: 85 })).toBe(true);
      expect(service.evaluateCondition('score >= 80', { score: 80 })).toBe(true);
      expect(service.evaluateCondition('score >= 80', { score: 79 })).toBe(false);
    });

    it('should evaluate <= correctly', () => {
      expect(service.evaluateCondition('score <= 50', { score: 50 })).toBe(true);
      expect(service.evaluateCondition('score <= 50', { score: 51 })).toBe(false);
    });

    it('should evaluate == correctly for strings', () => {
      expect(service.evaluateCondition('status == "active"', { status: 'active' })).toBe(true);
      expect(service.evaluateCondition('status == "active"', { status: 'inactive' })).toBe(false);
    });

    it('should evaluate != correctly', () => {
      expect(service.evaluateCondition('grade != F', { grade: 'A' })).toBe(true);
      expect(service.evaluateCondition('grade != F', { grade: 'F' })).toBe(false);
    });

    it('should return false for missing fields', () => {
      expect(service.evaluateCondition('score >= 80', {})).toBe(false);
    });

    it('should return false for invalid condition format', () => {
      expect(service.evaluateCondition('invalid', { score: 80 })).toBe(false);
    });
  });

  describe('Template management', () => {
    it('should create a template', async () => {
      const template = await service.createTemplate(TENANT_ID, {
        name: 'Test Template',
        type: 'report_card',
        format: 'pdf',
        layout: '<h1>{{title}}</h1>',
        mergeFields: [{ name: 'title', source: 'title' }],
      });

      expect(template.id).toBeDefined();
      expect(template.name).toBe('Test Template');
      expect(template.tenantId).toBe(TENANT_ID);
    });

    it('should update a template', async () => {
      const template = await service.createTemplate(TENANT_ID, {
        name: 'Original',
        type: 'report_card',
        format: 'pdf',
        layout: '<h1>{{title}}</h1>',
        mergeFields: [{ name: 'title', source: 'title' }],
      });

      const updated = await service.updateTemplate(TENANT_ID, template.id, {
        name: 'Updated',
      });

      expect(updated.name).toBe('Updated');
    });

    it('should throw NotFoundError when updating non-existent template', async () => {
      await expect(
        service.updateTemplate(TENANT_ID, '99999999-9999-4999-8999-999999999999', { name: 'X' }),
      ).rejects.toThrow(NotFoundError);
    });

    it('should delete a template', async () => {
      const template = await service.createTemplate(TENANT_ID, {
        name: 'To Delete',
        type: 'report_card',
        format: 'pdf',
        layout: 'x',
        mergeFields: [],
      });

      await service.deleteTemplate(TENANT_ID, template.id);
      await expect(service.getTemplate(TENANT_ID, template.id)).rejects.toThrow(NotFoundError);
    });

    it('should list templates for a tenant', async () => {
      await service.createTemplate(TENANT_ID, {
        name: 'Template 1',
        type: 'report_card',
        format: 'pdf',
        layout: 'x',
        mergeFields: [],
      });
      await service.createTemplate(TENANT_ID, {
        name: 'Template 2',
        type: 'transcript',
        format: 'pdf',
        layout: 'y',
        mergeFields: [],
      });

      const templates = await service.listTemplates(TENANT_ID);
      expect(templates).toHaveLength(2);
    });
  });

  describe('Scheduled reports', () => {
    it('should create a scheduled report', async () => {
      const schedule = await service.createSchedule(TENANT_ID, {
        name: 'Weekly Attendance',
        reportType: 'attendance_summary',
        format: 'xlsx',
        filters: { period: '2024' },
        cronExpression: '0 8 * * 1',
        deliveryMethod: 'email',
        recipientEmails: ['admin@school.org'],
      });

      expect(schedule.id).toBeDefined();
      expect(schedule.name).toBe('Weekly Attendance');
      expect(schedule.isActive).toBe(true);
      expect(schedule.nextRunAt).toBeDefined();
    });

    it('should require recipients for email delivery', async () => {
      await expect(
        service.createSchedule(TENANT_ID, {
          name: 'No Recipients',
          reportType: 'test',
          format: 'csv',
          filters: {},
          cronExpression: '0 8 * * 1',
          deliveryMethod: 'email',
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('should allow in_app delivery without email recipients', async () => {
      const schedule = await service.createSchedule(TENANT_ID, {
        name: 'In-App Report',
        reportType: 'test',
        format: 'csv',
        filters: {},
        cronExpression: '0 8 * * 1',
        deliveryMethod: 'in_app',
      });

      expect(schedule.deliveryMethod).toBe('in_app');
    });

    it('should update a scheduled report', async () => {
      const schedule = await service.createSchedule(TENANT_ID, {
        name: 'Original',
        reportType: 'test',
        format: 'csv',
        filters: {},
        cronExpression: '0 8 * * 1',
        deliveryMethod: 'in_app',
      });

      const updated = await service.updateSchedule(TENANT_ID, schedule.id, {
        name: 'Updated',
        isActive: false,
      });

      expect(updated.name).toBe('Updated');
      expect(updated.isActive).toBe(false);
    });

    it('should delete a scheduled report', async () => {
      const schedule = await service.createSchedule(TENANT_ID, {
        name: 'To Delete',
        reportType: 'test',
        format: 'csv',
        filters: {},
        cronExpression: '0 8 * * 1',
        deliveryMethod: 'in_app',
      });

      await service.deleteSchedule(TENANT_ID, schedule.id);
      await expect(service.getSchedule(TENANT_ID, schedule.id)).rejects.toThrow(NotFoundError);
    });
  });

  describe('getReportStatus', () => {
    it('should return job status', async () => {
      const userContext = createUserContext();
      const job = await service.generateReport(
        TENANT_ID,
        { reportType: 'test', format: 'csv', filters: {} },
        userContext,
      );

      const status = await service.getReportStatus(TENANT_ID, job.id);
      expect(status.id).toBe(job.id);
      expect(status.status).toBe('completed');
    });

    it('should throw NotFoundError for non-existent job', async () => {
      await expect(
        service.getReportStatus(TENANT_ID, '99999999-9999-4999-8999-999999999999'),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('downloadReport', () => {
    it('should throw BusinessRuleError when job is not completed', async () => {
      // Create a job that stays queued (with queue publisher)
      const queuePublisher = {
        queueReportJob: async () => {},
        queueScheduledReport: async () => {},
      };
      const serviceWithQueue = new ReportService(
        repository,
        dataSource,
        undefined,
        undefined,
        undefined,
        queuePublisher,
      );

      const userContext = createUserContext();
      const job = await serviceWithQueue.generateReport(
        TENANT_ID,
        { reportType: 'test', format: 'csv', filters: {} },
        userContext,
      );

      await expect(
        serviceWithQueue.downloadReport(TENANT_ID, job.id),
      ).rejects.toThrow(BusinessRuleError);
    });
  });
});
