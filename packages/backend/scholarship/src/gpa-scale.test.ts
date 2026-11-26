/**
 * PRC-M152: GPA is validated against the program's tenant-configured scale
 * (eligibility.gpaScaleMax, default 4.0) and the education level is a
 * controlled vocabulary.
 */
import { ValidationError } from '@proctira/common';
import { validate } from '@proctira/validation';
import { v4 as uuidv4 } from 'uuid';
import { describe, expect, it } from 'vitest';

import { InMemoryScholarshipRepository } from './in-memory-repository.js';
import { ScholarshipService } from './scholarship-service.js';
import { AcademicRecordSchema, CreateScholarshipProgramSchema } from './schemas.js';

const TENANT = uuidv4();

async function openProgram(service: ScholarshipService, eligibility: Record<string, unknown>) {
  const program = await service.createProgram(TENANT, {
    name: 'Merit',
    applicationStartDate: '2020-01-01',
    applicationEndDate: '2099-12-31',
    totalSlots: 5,
    amountPerRecipient: 1000,
    eligibility,
  } as never);
  return service.updateProgram(TENANT, program.id, { status: 'open' } as never);
}

function application(programId: string, gpa: number) {
  return {
    programId,
    applicantId: uuidv4(),
    institutionId: uuidv4(),
    academicRecords: [{ institutionName: 'North High', educationLevel: 'secondary' as const, gpa }],
    financialInfo: { familyIncome: 240000 },
    documents: [],
    asDraft: true,
  };
}

describe('PRC-M152 scholarship GPA scale', () => {
  it('schema accepts a 10-point GPA and the controlled education levels only', () => {
    const ok = validate(AcademicRecordSchema, {
      institutionName: 'North High',
      educationLevel: 'senior_secondary',
      gpa: 8.6,
    });
    expect(ok.success).toBe(true);
    const freeText = validate(AcademicRecordSchema, {
      institutionName: 'North High',
      educationLevel: 'Class 10 board',
    });
    expect(freeText.success).toBe(false);
  });

  it('program eligibility accepts gpaScaleMax 10 with minGPA 7.5', () => {
    const result = validate(CreateScholarshipProgramSchema, {
      name: 'Merit',
      applicationStartDate: '2020-01-01',
      applicationEndDate: '2099-12-31',
      totalSlots: 5,
      amountPerRecipient: 1000,
      eligibility: { gpaScaleMax: 10, minGPA: 7.5 },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a GPA of 8.5 on a 10-point program', async () => {
    const service = new ScholarshipService(new InMemoryScholarshipRepository());
    const program = await openProgram(service, { gpaScaleMax: 10 });
    await expect(
      service.submitApplication(TENANT, application(program.id, 8.5)),
    ).resolves.toMatchObject({ status: 'draft' });
  });

  it('rejects a GPA above a legacy (4.0) program scale', async () => {
    const service = new ScholarshipService(new InMemoryScholarshipRepository());
    const program = await openProgram(service, {});
    await expect(
      service.submitApplication(TENANT, application(program.id, 8.5)),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects minGPA above the configured scale', async () => {
    const service = new ScholarshipService(new InMemoryScholarshipRepository());
    await expect(openProgram(service, { gpaScaleMax: 5, minGPA: 7 })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
