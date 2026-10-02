/**
 * PRC-H036 — report-card jobs resolve real names and fail (not complete) for
 * a student that does not exist in the tenant, or when no directory is wired.
 */
import { v4 as uuidv4 } from 'uuid';
import { describe, expect, it } from 'vitest';
import {
  InMemoryAssessmentItemRepository,
  InMemoryGradingSchemeRepository,
} from './in-memory-repository.js';
import {
  InMemoryInstitutionBrandingRepository,
  InMemoryReportCardJobRepository,
  InMemoryReportCardTemplateRepository,
  InMemoryTeacherCommentRepository,
} from './in-memory-report-card-repository.js';
import { InMemoryAssessmentResultRepository } from './in-memory-result-repository.js';
import { InMemoryReportCardDirectory, type ReportCardDirectory } from './report-card-directory.js';
import { ReportCardService, type ReportCardData } from './report-card-service.js';
import { ResultService } from './result-service.js';

async function setup(directory: ReportCardDirectory | undefined) {
  const tenantId = uuidv4();
  const templateRepo = new InMemoryReportCardTemplateRepository();
  const itemRepo = new InMemoryAssessmentItemRepository();
  const resultRepo = new InMemoryAssessmentResultRepository();
  const captured: ReportCardData[] = [];
  const service = new ReportCardService(
    templateRepo,
    new InMemoryTeacherCommentRepository(),
    new InMemoryInstitutionBrandingRepository(),
    new InMemoryReportCardJobRepository(),
    new ResultService(resultRepo, itemRepo, new InMemoryGradingSchemeRepository()),
    itemRepo,
    null,
    {
      async generateReportCardPdf(_t, data) {
        captured.push(data);
        return Buffer.from('%PDF-1.4');
      },
    },
    { processInline: true, resultRepository: resultRepo, directory },
  );
  const template = await service.createTemplate(tenantId, {
    name: 'T',
    templateContent: '<title>Card</title>',
    isDefault: true,
  } as never);
  return { tenantId, service, template, captured };
}

describe('PRC-H036 report-card name resolution', () => {
  it('known student -> completed with full name and period name', async () => {
    const studentId = uuidv4();
    const academicPeriodId = uuidv4();
    const directory = new InMemoryReportCardDirectory();
    const { tenantId, service, template, captured } = await setup(directory);
    directory
      .addStudent(tenantId, studentId, 'Vikram Singh')
      .addPeriod(tenantId, academicPeriodId, 'Term 2');
    const job = await service.queueReportCardGeneration(tenantId, {
      studentId,
      academicPeriodId,
      templateId: template.id,
      institutionId: uuidv4(),
    });
    expect(job.status).toBe('completed');
    expect(captured[0]!.student.name).toBe('Vikram Singh');
    expect(captured[0]!.academicPeriodName).toBe('Term 2');
  });

  it('unknown student id -> job ends failed with a clear error', async () => {
    const directory = new InMemoryReportCardDirectory();
    const { tenantId, service, template, captured } = await setup(directory);
    const academicPeriodId = uuidv4();
    directory.addPeriod(tenantId, academicPeriodId, 'Term 2');
    const unknown = uuidv4();
    const job = await service.queueReportCardGeneration(tenantId, {
      studentId: unknown,
      academicPeriodId,
      templateId: template.id,
      institutionId: uuidv4(),
    });
    expect(job.status).toBe('failed');
    expect(job.errorMessage).toMatch(new RegExp(`Student '${unknown}' not found`));
    expect(captured).toHaveLength(0);
  });

  it('student of another tenant is treated as unknown', async () => {
    const directory = new InMemoryReportCardDirectory();
    const { tenantId, service, template } = await setup(directory);
    const studentId = uuidv4();
    const academicPeriodId = uuidv4();
    directory
      .addStudent(uuidv4(), studentId, 'Other Tenant')
      .addPeriod(tenantId, academicPeriodId, 'T');
    const job = await service.queueReportCardGeneration(tenantId, {
      studentId,
      academicPeriodId,
      templateId: template.id,
      institutionId: uuidv4(),
    });
    expect(job.status).toBe('failed');
  });

  it('no directory configured -> job fails instead of issuing blank names', async () => {
    const { tenantId, service, template } = await setup(undefined);
    const job = await service.queueReportCardGeneration(tenantId, {
      studentId: uuidv4(),
      academicPeriodId: uuidv4(),
      templateId: template.id,
      institutionId: uuidv4(),
    });
    expect(job.status).toBe('failed');
    expect(job.errorMessage).toMatch(/directory is not configured/);
  });
});
