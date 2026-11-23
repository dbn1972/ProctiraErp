/**
 * PR B1 (FKB-082): report-card jobs resolve `studentId` inside the caller's tenant.
 * Another tenant's student and an unknown id give the same NotFoundError; a bulk
 * request naming one unknown student creates no job at all.
 */
import { NotFoundError } from '@proctira/common';
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
import { anyIdReportCardDirectory } from './report-card-test-directory.js';
import { ReportCardService } from './report-card-service.js';
import { ResultService } from './result-service.js';

const TENANT_A = '11111111-1111-4111-8111-1111111111aa';
const TENANT_B = '11111111-1111-4111-8111-1111111111bb';
const STUDENT_A = '33333333-3333-4333-8333-3333333333aa';
const STUDENT_A2 = '33333333-3333-4333-8333-3333333333a2';
const STUDENT_B = '33333333-3333-4333-8333-3333333333bb';
const UNKNOWN = '33333333-3333-4333-8333-333333333399';
const PERIOD = '44444444-4444-4444-8444-444444444444';
const INST = '55555555-5555-4555-8555-555555555555';

async function setup() {
  const jobRepo = new InMemoryReportCardJobRepository();
  jobRepo.seedStudent(TENANT_A, STUDENT_A);
  jobRepo.seedStudent(TENANT_A, STUDENT_A2);
  jobRepo.seedStudent(TENANT_B, STUDENT_B);
  const templateRepo = new InMemoryReportCardTemplateRepository();
  const itemRepo = new InMemoryAssessmentItemRepository();
  const service = new ReportCardService(
    templateRepo,
    new InMemoryTeacherCommentRepository(),
    new InMemoryInstitutionBrandingRepository(),
    jobRepo,
    new ResultService(
      new InMemoryAssessmentResultRepository(),
      itemRepo,
      new InMemoryGradingSchemeRepository(),
    ),
    itemRepo,
    { async publish() {} },
    null,
    { directory: anyIdReportCardDirectory },
  );
  const template = await service.createTemplate(TENANT_A, {
    name: 'Standard',
    templateContent: '<p>{{studentName}}</p>',
  });
  return { jobRepo, service, templateId: template.id };
}

describe('FKB-082 report-card job student tenancy', () => {
  it('queues jobs for students of the caller tenant', async () => {
    const { service, templateId } = await setup();
    const job = await service.queueReportCardGeneration(TENANT_A, {
      studentId: STUDENT_A,
      academicPeriodId: PERIOD,
      institutionId: INST,
      templateId,
    });
    expect(job.studentId).toBe(STUDENT_A);
  });

  it.each([
    ['another tenant student', STUDENT_B],
    ['an unknown student', UNKNOWN],
  ])('single and bulk reject %s with the same NotFoundError and create no job', async (_l, id) => {
    const { jobRepo, service, templateId } = await setup();
    const single = service.queueReportCardGeneration(TENANT_A, {
      studentId: id,
      academicPeriodId: PERIOD,
      institutionId: INST,
      templateId,
    });
    await expect(single).rejects.toBeInstanceOf(NotFoundError);
    await expect(single).rejects.toThrow(`Student with id '${id}' not found`);

    await expect(
      service.queueBulkReportCardGeneration(TENANT_A, {
        studentIds: [STUDENT_A2, id],
        academicPeriodId: PERIOD,
        institutionId: INST,
        templateId,
      }),
    ).rejects.toThrow(`Student with id '${id}' not found`);
    expect(await jobRepo.listByStatus(TENANT_A, 'queued')).toEqual([]);
  });
});
