/**
 * PRC-M337 — declining a draft offer never promotes the waitlist; staff list
 * endpoints are bounded (page size <= 200).
 */
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { InMemoryAdmissionsCrmStore } from '../admissions-crm-store.js';
import { InMemoryRegistrationRepository } from '../in-memory-repository.js';
import { MAX_LIST_PAGE_SIZE } from '../pagination.js';
import { AdmissionsPipelineService } from './pipeline-service.js';
import { InMemoryAdmissionsPipelineStore, type EnquiryRecord } from './pipeline-store.js';
import { registerAdmissionsPipelineRoutes } from './routes.js';

const TENANT = randomUUID();
const INSTITUTION = randomUUID();
const PERIOD = randomUUID();
const GRADE = randomUUID();

function enquiryInput(firstName: string) {
  return {
    institutionId: INSTITUTION,
    academicPeriodId: PERIOD,
    gradeId: GRADE,
    firstName,
    lastName: 'X',
    dateOfBirth: '2013-01-01',
    guardianName: 'G',
    guardianPhone: '+91000',
  };
}

describe('PRC-M337 decline promotion + bounded lists', () => {
  it('declining a draft offer leaves the waitlist unchanged', async () => {
    const store = new InMemoryAdmissionsPipelineStore();
    const apps = new InMemoryRegistrationRepository();
    const crm = new InMemoryAdmissionsCrmStore();
    const service = new AdmissionsPipelineService(store, apps, undefined, undefined, undefined, crm);
    await service.upsertSeat(TENANT, {
      institutionId: INSTITUTION,
      academicPeriodId: PERIOD,
      gradeId: GRADE,
      seats: 2,
    });
    const a = await service.convertEnquiry(
      TENANT,
      (await service.createEnquiry(TENANT, enquiryInput('A'))).id,
    );
    const w = await service.convertEnquiry(
      TENANT,
      (await service.createEnquiry(TENANT, enquiryInput('W'))).id,
    );
    await apps.updateStatus(w.application.id, 'waitlisted', undefined, TENANT);
    await crm.enqueueWaitlist({
      tenantId: TENANT,
      applicationId: w.application.id,
      institutionId: INSTITUTION,
    });
    const draft = await service.createOffer(TENANT, { applicationId: a.application.id });
    const declined = await service.declineOffer(TENANT, draft.id);
    expect(declined.promotedOffer).toBeNull();
    expect(await crm.listWaitlist(TENANT, INSTITUTION)).toHaveLength(1);
  });

  it('GET /admissions/enquiries returns at most 200 rows and rejects limit > 200', async () => {
    const store = new InMemoryAdmissionsPipelineStore();
    const now = Date.now();
    for (let i = 0; i < 250; i += 1) {
      const at = new Date(now - i * 1000);
      await store.createEnquiry({
        id: randomUUID(),
        tenantId: TENANT,
        institutionId: INSTITUTION,
        institutionName: null,
        academicPeriodId: PERIOD,
        gradeId: GRADE,
        quota: 'general',
        source: 'other',
        stage: 'new',
        firstName: `E${i}`,
        lastName: 'X',
        dateOfBirth: '2013-01-01',
        gender: 'other',
        guardianName: 'G',
        guardianPhone: '+91000',
        guardianEmail: null,
        interviewScore: null,
        testScore: null,
        applicationId: null,
        notes: null,
        createdAt: at,
        updatedAt: at,
      } as EnquiryRecord);
    }
    const service = new AdmissionsPipelineService(store, new InMemoryRegistrationRepository());
    const app = Fastify();
    app.decorateRequest('tenantId', '');
    app.decorateRequest('user', null);
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = TENANT;
      (request as unknown as { user: { roles: string[] } }).user = {
        roles: ['admissions_officer'],
      };
    });
    await registerAdmissionsPipelineRoutes(app, { service });
    await app.ready();

    const first = await app.inject({ method: 'GET', url: '/admissions/enquiries' });
    expect(first.statusCode).toBe(200);
    const body = first.json() as { data: unknown[]; pagination: { hasMore: boolean } };
    expect(body.data.length).toBeLessThanOrEqual(MAX_LIST_PAGE_SIZE);
    expect(body.pagination.hasMore).toBe(true);

    const second = await app.inject({ method: 'GET', url: '/admissions/enquiries?offset=200' });
    const page2 = second.json() as { data: unknown[]; pagination: { hasMore: boolean } };
    expect(page2.data).toHaveLength(50);
    expect(page2.pagination.hasMore).toBe(false);

    const tooBig = await app.inject({ method: 'GET', url: '/admissions/enquiries?limit=10000' });
    expect(tooBig.statusCode).toBe(400);
    await app.close();
  });
});
