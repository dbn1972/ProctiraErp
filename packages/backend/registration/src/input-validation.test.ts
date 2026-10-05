/**
 * PRC-M333 — DOB must be a real plausible date, custom fields honour type and
 * pattern, and timestamps (slot/offer expiry) reject garbage.
 */
import { randomUUID } from 'node:crypto';
import { ValidationError } from '@proctira/common';
import { describe, expect, it } from 'vitest';
import { InMemoryRegistrationRepository } from './in-memory-repository.js';
import { dateOfBirthErrors, isRealIsoDate } from './input-validation.js';
import { AdmissionsPipelineService } from './pipeline/pipeline-service.js';
import { InMemoryAdmissionsPipelineStore } from './pipeline/pipeline-store.js';
import { RegistrationService, validateCustomFields } from './registration-service.js';
import type { FormConfiguration } from './schemas.js';

const TENANT = randomUUID();
const INSTITUTION = randomUUID();
const FORM = randomUUID();

const form = {
  id: FORM,
  tenantId: TENANT,
  institutionId: INSTITUTION,
  version: 1,
  publishedAt: '2026-01-01T00:00:00.000Z',
  fields: [
    {
      id: 'aadhaar',
      label: 'Aadhaar',
      type: 'text',
      required: false,
      validation: { pattern: '\\d{12}' },
    },
    { id: 'siblings', label: 'Siblings', type: 'number', required: false },
    { id: 'transport', label: 'Transport', type: 'checkbox', required: false },
  ],
} as unknown as FormConfiguration;

function service() {
  const repo = new InMemoryRegistrationRepository();
  repo.seedInstitutions([
    {
      id: INSTITUTION,
      name: 'Demo',
      code: 'D',
      typeId: randomUUID(),
      areaId: randomUUID(),
      tenantId: TENANT,
      status: 'ACTIVE',
      latitude: null,
      longitude: null,
      address: null,
    },
  ]);
  repo.seedFormConfigurations([form]);
  return new RegistrationService(repo);
}

const submission = {
  institutionId: INSTITUTION,
  formConfigurationId: FORM,
  formConfigurationVersion: 1,
  firstName: 'Ada',
  lastName: 'L',
  dateOfBirth: '2014-02-28',
  gender: 'female' as const,
  guardianName: 'P',
  guardianPhone: '+911234567890',
};

describe('PRC-M333 registration input validation', () => {
  it('real-date check', () => {
    expect(isRealIsoDate('2020-02-29')).toBe(true);
    expect(isRealIsoDate('2020-02-31')).toBe(false);
    expect(isRealIsoDate('2021-13-01')).toBe(false);
  });

  it.each(['2020-02-31', '2999-01-01', '1900-01-01'])('DOB %s -> 400', async (dob) => {
    await expect(
      service().submitRegistration(TENANT, { ...submission, dateOfBirth: dob }, `k-${dob}`),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('valid DOB passes plausibility', () => {
    expect(dateOfBirthErrors('2014-02-28')).toEqual([]);
  });

  it("field pattern violated -> 400 with rule 'pattern'", async () => {
    const errors = validateCustomFields([{ fieldId: 'aadhaar', value: '12ab' }], form);
    expect(errors.map((e) => e.rule)).toContain('pattern');
    expect(validateCustomFields([{ fieldId: 'aadhaar', value: '123456789012' }], form)).toEqual([]);
    await expect(
      service().submitRegistration(
        TENANT,
        { ...submission, customFields: [{ fieldId: 'aadhaar', value: 'x' }] },
        'k-pattern',
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('field type mismatch -> rule type', () => {
    const errors = validateCustomFields(
      [
        { fieldId: 'siblings', value: 'two' },
        { fieldId: 'transport', value: 'yes' },
      ],
      form,
    );
    expect(errors.map((e) => e.rule)).toEqual(['type', 'type']);
  });

  it('interview slot with garbage timestamps -> 400', async () => {
    await expect(
      service().createInterviewSlot(TENANT, {
        institutionId: INSTITUTION,
        startsAt: 'garbage-time',
        endsAt: '2026-01-01T10:00:00Z',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("offer expiresAt='garbage' or past -> 400; enquiry DOB 2020-02-31 -> 400", async () => {
    const pipeline = new AdmissionsPipelineService(
      new InMemoryAdmissionsPipelineStore(),
      new InMemoryRegistrationRepository(),
    );
    const period = randomUUID();
    const grade = randomUUID();
    await expect(
      pipeline.createEnquiry(TENANT, {
        institutionId: INSTITUTION,
        academicPeriodId: period,
        gradeId: grade,
        firstName: 'A',
        lastName: 'B',
        dateOfBirth: '2020-02-31',
        guardianName: 'G',
        guardianPhone: '+910',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await pipeline.upsertSeat(TENANT, {
      institutionId: INSTITUTION,
      academicPeriodId: period,
      gradeId: grade,
      seats: 1,
    });
    const enquiry = await pipeline.createEnquiry(TENANT, {
      institutionId: INSTITUTION,
      academicPeriodId: period,
      gradeId: grade,
      firstName: 'A',
      lastName: 'B',
      dateOfBirth: '2014-01-01',
      guardianName: 'G',
      guardianPhone: '+910',
    });
    const { application } = await pipeline.convertEnquiry(TENANT, enquiry.id);
    for (const expiresAt of ['garbage', '2000-01-01T00:00:00Z']) {
      await expect(
        pipeline.createOffer(TENANT, { applicationId: application.id, expiresAt }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
  });
});
