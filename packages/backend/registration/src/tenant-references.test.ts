/**
 * AD-T1 (+ review M2-TR-4): staff admissions writes that name another tenant's academic
 * period, grade or institution are refused with the #739 safe form and store nothing.
 */
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import { InMemoryAdmissionsCrmStore } from './admissions-crm-store.js';
import { InMemoryRegistrationRepository } from './in-memory-repository.js';
import { AdmissionsPipelineService } from './pipeline/pipeline-service.js';
import { InMemoryAdmissionsPipelineStore } from './pipeline/pipeline-store.js';
import { registrationPlugin } from './registration-plugin.js';
import { RegistrationService } from './registration-service.js';
import {
  InMemoryTenantReferenceChecker,
  PgTenantReferenceChecker,
  ReferenceNotFoundError,
} from './tenant-references.js';

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const A = { institutionId: randomUUID(), academicPeriodId: randomUUID(), gradeId: randomUUID() };
const B = { institutionId: randomUUID(), academicPeriodId: randomUUID(), gradeId: randomUUID() };

function checker(): InMemoryTenantReferenceChecker {
  return new InMemoryTenantReferenceChecker()
    .register(TENANT_A, A.institutionId, A.academicPeriodId, A.gradeId)
    .register(TENANT_B, B.institutionId, B.academicPeriodId, B.gradeId);
}

function enquiryInput(refs: typeof A) {
  return {
    ...refs,
    firstName: 'AD',
    lastName: 'Applicant',
    dateOfBirth: '2015-01-01',
    guardianName: 'AD Guardian',
    guardianPhone: '+15550000000',
  };
}

function setup() {
  const store = new InMemoryAdmissionsPipelineStore();
  const applications = new InMemoryRegistrationRepository();
  const crm = new InMemoryAdmissionsCrmStore();
  const references = checker();
  const pipeline = new AdmissionsPipelineService(
    store,
    applications,
    undefined,
    undefined,
    undefined,
    crm,
    undefined,
    undefined,
    references,
  );
  const registration = new RegistrationService(applications, crm, undefined, references);
  return { store, crm, pipeline, registration };
}

describe('AD-T1 pipeline writes check tenant ownership of period, grade and institution', () => {
  it('refuses an enquiry naming another tenant period, grade or institution and stores none', async () => {
    const { pipeline, store } = setup();
    for (const refs of [
      { ...A, academicPeriodId: B.academicPeriodId },
      { ...A, gradeId: B.gradeId },
      { ...A, institutionId: B.institutionId },
    ]) {
      await expect(pipeline.createEnquiry(TENANT_A, enquiryInput(refs))).rejects.toBeInstanceOf(
        ReferenceNotFoundError,
      );
    }
    expect(await store.listEnquiries(TENANT_A)).toEqual([]);
    const own = await pipeline.createEnquiry(TENANT_A, enquiryInput(A));
    expect(own.academicPeriodId).toBe(A.academicPeriodId);
  });

  it('refuses a seat-matrix row naming another tenant period, grade or institution', async () => {
    const { pipeline, store } = setup();
    for (const refs of [
      { ...A, academicPeriodId: B.academicPeriodId },
      { ...A, gradeId: B.gradeId },
      { ...A, institutionId: B.institutionId },
      B,
    ]) {
      await expect(pipeline.upsertSeat(TENANT_A, { ...refs, seats: 3 })).rejects.toBeInstanceOf(
        ReferenceNotFoundError,
      );
    }
    expect(await store.listSeats(TENANT_A)).toEqual([]);
    const own = await pipeline.upsertSeat(TENANT_A, { ...A, seats: 3 });
    expect(own.seats).toBe(3);
  });

  it('M2-TR-4: refuses a merit list for another tenant period with the own grade', async () => {
    const { pipeline, store } = setup();
    const weights = { interviewWeight: 0.5, testWeight: 0.5 };
    for (const refs of [
      { ...A, academicPeriodId: B.academicPeriodId },
      { ...A, institutionId: B.institutionId },
      { ...A, gradeId: B.gradeId },
    ]) {
      await expect(
        pipeline.generateMeritList(TENANT_A, { ...refs, ...weights }),
      ).rejects.toBeInstanceOf(ReferenceNotFoundError);
      expect(await store.findMeritList(TENANT_A, refs)).toBeNull();
    }
    const own = await pipeline.generateMeritList(TENANT_A, { ...A, ...weights });
    expect(own.academicPeriodId).toBe(A.academicPeriodId);
  });

  it('refuses a placement naming another tenant period or grade and keeps the stored one', async () => {
    const { pipeline, store } = setup();
    const enquiry = await pipeline.createEnquiry(TENANT_A, enquiryInput(A));
    const { application } = await pipeline.convertEnquiry(TENANT_A, enquiry.id);
    for (const refs of [
      { academicPeriodId: B.academicPeriodId, gradeId: A.gradeId },
      { academicPeriodId: A.academicPeriodId, gradeId: B.gradeId },
    ]) {
      await expect(
        pipeline.setPlacement(TENANT_A, application.id, { ...refs, interviewScore: 50 }),
      ).rejects.toBeInstanceOf(ReferenceNotFoundError);
    }
    const placement = await store.getPlacement(TENANT_A, application.id);
    expect(placement?.academicPeriodId).toBe(A.academicPeriodId);
    expect(placement?.gradeId).toBe(A.gradeId);
    expect(placement?.interviewScore).toBe(0);
  });

  it('M2-TR-4: refuses an interview slot at another tenant institution and lists none', async () => {
    const { registration, crm } = setup();
    const startsAt = new Date(Date.now() + 86_400_000);
    const slot = {
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 1_800_000).toISOString(),
      capacity: 1,
    };
    await expect(
      registration.createInterviewSlot(TENANT_A, { ...slot, institutionId: B.institutionId }),
    ).rejects.toBeInstanceOf(ReferenceNotFoundError);
    expect(await crm.listSlots(TENANT_A)).toEqual([]);
    const own = await registration.createInterviewSlot(TENANT_A, {
      ...slot,
      institutionId: A.institutionId,
    });
    expect(own.institutionId).toBe(A.institutionId);
  });
});

describe('AD-T1 HTTP responses use the #739 safe form', () => {
  async function app(): Promise<FastifyInstance> {
    const instance = Fastify();
    instance.decorateRequest('tenantId', '');
    instance.decorateRequest('user', null);
    instance.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = TENANT_A;
      (request as unknown as { user: { tenantId: string; roles: string[] } }).user = {
        tenantId: TENANT_A,
        roles: ['admin'],
      };
    });
    await instance.register(registrationPlugin, {
      repository: new InMemoryRegistrationRepository(),
      crmStore: new InMemoryAdmissionsCrmStore(),
      pipelineStore: new InMemoryAdmissionsPipelineStore(),
      referenceChecker: checker(),
    });
    return instance;
  }

  function expectSafe(res: { statusCode: number; body: string }, label: string): void {
    expect(res.statusCode, `${label}: ${res.body}`).toBe(422);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(Object.keys(body).sort(), label).toEqual(
      ['code', 'correlationId', 'message', 'statusCode'].sort(),
    );
    expect(body.code, label).toBe('REFERENCE_NOT_FOUND');
    expect(body.message, label).toBe('A referenced record does not exist.');
    expect(body.statusCode, label).toBe(422);
    expect(typeof body.correlationId, label).toBe('string');
    expect(String(body.correlationId).length, label).toBeGreaterThan(0);
    for (const id of Object.values(B)) expect(res.body, label).not.toContain(id);
  }

  it('answers 422 REFERENCE_NOT_FOUND with a correlation id on every checked route', async () => {
    const instance = await app();
    const startsAt = new Date(Date.now() + 86_400_000);
    const cases: Array<[string, 'POST' | 'PUT', string, Record<string, unknown>]> = [
      [
        'enquiry',
        'POST',
        '/admissions/enquiries',
        enquiryInput({ ...A, academicPeriodId: B.academicPeriodId }),
      ],
      [
        'seat matrix',
        'PUT',
        '/admissions/seat-matrix',
        { ...A, academicPeriodId: B.academicPeriodId, seats: 3 },
      ],
      [
        'merit list',
        'POST',
        '/admissions/merit-lists',
        { ...A, academicPeriodId: B.academicPeriodId, interviewWeight: 0.5, testWeight: 0.5 },
      ],
      [
        'interview slot',
        'POST',
        '/registrations/interview-slots',
        {
          institutionId: B.institutionId,
          startsAt: startsAt.toISOString(),
          endsAt: new Date(startsAt.getTime() + 1_800_000).toISOString(),
        },
      ],
    ];
    try {
      for (const [label, method, url, payload] of cases) {
        expectSafe(await instance.inject({ method, url, payload }), label);
      }
      const enquiry = await instance.inject({
        method: 'POST',
        url: '/admissions/enquiries',
        payload: enquiryInput(A),
      });
      expect(enquiry.statusCode, enquiry.body).toBe(201);
      const converted = await instance.inject({
        method: 'POST',
        url: `/admissions/enquiries/${(JSON.parse(enquiry.body) as { id: string }).id}/convert`,
      });
      expect(converted.statusCode, converted.body).toBe(201);
      const applicationId = (JSON.parse(converted.body) as { application: { id: string } })
        .application.id;
      expectSafe(
        await instance.inject({
          method: 'PATCH',
          url: `/admissions/applications/${applicationId}/placement`,
          payload: { academicPeriodId: B.academicPeriodId, gradeId: A.gradeId },
        }),
        'placement',
      );
    } finally {
      await instance.close();
    }
  });
});

describe('PgTenantReferenceChecker', () => {
  function fakePool(row: Record<string, unknown>) {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const pool = {
      query: async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        return { rows: /^\s*SELECT\s+\(\$2/.test(sql) ? [row] : [] };
      },
      end: async () => undefined,
    };
    return { pool, calls };
  }

  it('looks the ids up in the caller tenant and reports the ones not found', async () => {
    const { pool, calls } = fakePool({ institution_ok: true, period_ok: false, grade_ok: true });
    const found = await new PgTenantReferenceChecker(
      pool as unknown as ConstructorParameters<typeof PgTenantReferenceChecker>[0],
    ).findForeignReferences(TENANT_A, { ...A, academicPeriodId: B.academicPeriodId });
    expect(found).toEqual(['academicPeriodId']);
    const lookup = calls.find((c) => /FROM academic_periods/.test(c.sql));
    expect(lookup?.params).toEqual([TENANT_A, A.institutionId, B.academicPeriodId, A.gradeId]);
    expect(lookup?.sql).toMatch(/FROM institutions WHERE tenant_id = \$1::uuid AND id = \$2::uuid/);
    expect(lookup?.sql).toMatch(/FROM grades WHERE tenant_id = \$1::uuid AND id = \$4::uuid/);
  });

  it('passes null for omitted ids and reports nothing when all are owned', async () => {
    const { pool, calls } = fakePool({ institution_ok: true, period_ok: true, grade_ok: true });
    const checkerPg = new PgTenantReferenceChecker(
      pool as unknown as ConstructorParameters<typeof PgTenantReferenceChecker>[0],
    );
    expect(
      await checkerPg.findForeignReferences(TENANT_A, { institutionId: A.institutionId }),
    ).toEqual([]);
    const lookup = calls.find((c) => /FROM academic_periods/.test(c.sql));
    expect(lookup?.params).toEqual([TENANT_A, A.institutionId, null, null]);
  });

  it('runs no query when the write names no reference', async () => {
    const { pool, calls } = fakePool({});
    const checkerPg = new PgTenantReferenceChecker(
      pool as unknown as ConstructorParameters<typeof PgTenantReferenceChecker>[0],
    );
    expect(await checkerPg.findForeignReferences(TENANT_A, {})).toEqual([]);
    expect(calls).toEqual([]);
  });
});
