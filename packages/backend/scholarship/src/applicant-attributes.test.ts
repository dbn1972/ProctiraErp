/**
 * PRC-L345: areaId and gender drive program eligibility and utilization reports, so they are
 * derived from the student record server-side; a client value contradicting the record is a 422
 * and an unverifiable client value is dropped.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { deriveApplicantAttributes } from './application-intake.js';
import { InMemoryScholarshipRepository } from './in-memory-repository.js';
import { normalizeRecordGender } from './parent-links.js';
import { scholarshipPlugin } from './scholarship-plugin.js';

const TENANT_ID = 'tenant-001';
const STUDENT = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
const INSTITUTION = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33';
const AREA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44';
const OTHER_AREA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55';

describe('PRC-L345 deriveApplicantAttributes', () => {
  const lookup = async () => ({ areaId: AREA, gender: 'female' as const });

  it('takes areaId/gender from the record when the client omits them', async () => {
    await expect(
      deriveApplicantAttributes({ tenantId: TENANT_ID, applicantId: STUDENT, claimed: {}, lookup }),
    ).resolves.toEqual({ areaId: AREA, gender: 'female' });
  });

  it('rejects a client value that contradicts the record (422)', async () => {
    await expect(
      deriveApplicantAttributes({
        tenantId: TENANT_ID,
        applicantId: STUDENT,
        claimed: { areaId: OTHER_AREA, gender: 'male' },
        lookup,
      }),
    ).rejects.toMatchObject({ statusCode: 422, code: 'APPLICANT_ATTRIBUTE_MISMATCH' });
  });

  it('drops client values the record cannot confirm (no lookup, no record, unset attribute)', async () => {
    const claimed = { areaId: OTHER_AREA, gender: 'male' };
    await expect(
      deriveApplicantAttributes({ tenantId: TENANT_ID, applicantId: STUDENT, claimed }),
    ).resolves.toEqual({});
    await expect(
      deriveApplicantAttributes({
        tenantId: TENANT_ID,
        applicantId: STUDENT,
        claimed,
        lookup: async () => null,
      }),
    ).resolves.toEqual({});
    await expect(
      deriveApplicantAttributes({
        tenantId: TENANT_ID,
        applicantId: STUDENT,
        claimed,
        lookup: async () => ({ areaId: null, gender: null }),
      }),
    ).resolves.toEqual({});
  });

  it('normalizes stored genders and never guesses an unknown value', () => {
    expect(normalizeRecordGender('FEMALE')).toBe('female');
    expect(normalizeRecordGender('M')).toBe('male');
    expect(normalizeRecordGender('unspecified')).toBeNull();
    expect(normalizeRecordGender(undefined)).toBeNull();
  });
});

describe('PRC-L345 POST /scholarships/applications', () => {
  let app: FastifyInstance;
  let repository: InMemoryScholarshipRepository;
  let programId: string;

  beforeEach(async () => {
    repository = new InMemoryScholarshipRepository();
    app = Fastify({ logger: false });
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as { tenantId?: string }).tenantId = TENANT_ID;
      (request as { user?: unknown }).user = { roles: ['bursar'] };
    });
    await app.register(scholarshipPlugin, {
      repository,
      workflowEngine: { createInstance: async () => 'wf-1' },
      resolveApplicantAttributes: async () => ({ areaId: AREA, gender: 'female' }),
    });
    await app.ready();
    const program = await app.inject({
      method: 'POST',
      url: '/scholarships/programs',
      payload: {
        name: 'Open Program',
        applicationStartDate: '2020-01-01',
        applicationEndDate: '2030-12-31',
        totalSlots: 5,
        amountPerRecipient: 1000,
        eligibility: {},
      },
    });
    programId = (program.json() as { id: string }).id;
    await app.inject({
      method: 'PUT',
      url: `/scholarships/programs/${programId}`,
      payload: { status: 'open' },
    });
  });

  const body = (extra: Record<string, unknown>) => ({
    programId,
    applicantId: STUDENT,
    institutionId: INSTITUTION,
    academicRecords: [{ institutionName: 'School', educationLevel: 'secondary', gpa: 3.5 }],
    financialInfo: { familyIncome: 30000 },
    documents: [],
    ...extra,
  });

  it('persists the record attributes, not the client ones', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/scholarships/applications',
      payload: body({}),
    });
    expect(response.statusCode).toBe(201);
    const stored = await repository.findApplicationById(
      (response.json() as { id: string }).id,
      TENANT_ID,
    );
    expect(stored).toMatchObject({ areaId: AREA, gender: 'female' });
  });

  it('rejects a body gender/area that contradicts the record (422)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/scholarships/applications',
      payload: body({ gender: 'male', areaId: OTHER_AREA }),
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: 'APPLICANT_ATTRIBUTE_MISMATCH' });
  });
});
