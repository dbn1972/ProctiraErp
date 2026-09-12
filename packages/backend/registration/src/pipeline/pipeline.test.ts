/**
 * G-906 — admissions pipeline: ranking determinism, seat overflow, accept idempotency.
 */
import { randomUUID } from 'node:crypto';

import { BusinessRuleError, ConflictError, NotFoundError } from '@proctira/common';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { InMemoryRegistrationRepository } from '../in-memory-repository.js';
import { AdmissionsPipelineService } from './pipeline-service.js';
import { InMemoryAdmissionsPipelineStore } from './pipeline-store.js';
import { rankCandidates } from './ranking.js';
import { registerAdmissionsPipelineRoutes } from './routes.js';

const TENANT = randomUUID();
const INSTITUTION = randomUUID();
const PERIOD = randomUUID();
const GRADE = randomUUID();

function ids() {
  return { applicationId: randomUUID(), submittedAt: new Date('2026-01-01T00:00:00.000Z') };
}

describe('merit ranking determinism', () => {
  it('orders by composite score then test, interview, submission, id', () => {
    const a = {
      ...ids(),
      applicationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      interviewScore: 80,
      testScore: 80,
    };
    const b = {
      ...ids(),
      applicationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      interviewScore: 90,
      testScore: 70,
    };
    const c = {
      applicationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      interviewScore: 80,
      testScore: 80,
      submittedAt: new Date('2026-01-02T00:00:00.000Z'),
    };
    const ranked = rankCandidates([c, b, a], { interview: 0.4, test: 0.6 });
    // composite: a=80, b=78, c=80 → a before c (earlier submitted), b last
    expect(ranked.map((row) => row.applicationId)).toEqual([
      a.applicationId,
      c.applicationId,
      b.applicationId,
    ]);
    expect(ranked.map((row) => row.rank)).toEqual([1, 2, 3]);

    const again = rankCandidates([b, a, c], { interview: 0.4, test: 0.6 });
    expect(again.map((row) => row.applicationId)).toEqual(ranked.map((row) => row.applicationId));
  });

  it('breaks a composite tie with the higher test score', () => {
    const lowTest = {
      applicationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      interviewScore: 100,
      testScore: 50,
      submittedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const highTest = {
      applicationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      interviewScore: 50,
      testScore: 100,
      submittedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const ranked = rankCandidates([lowTest, highTest], { interview: 0.5, test: 0.5 });
    expect(ranked[0]?.applicationId).toBe(highTest.applicationId);
  });
});

describe('admissions pipeline service', () => {
  it('rejects a third accept when the seat matrix is full', async () => {
    const store = new InMemoryAdmissionsPipelineStore();
    const apps = new InMemoryRegistrationRepository();
    const enrolments: string[] = [];
    const service = new AdmissionsPipelineService(store, apps, async () => {
      const studentId = randomUUID();
      enrolments.push(studentId);
      return { studentId, enrollmentId: randomUUID() };
    });

    await service.upsertSeat(TENANT, {
      institutionId: INSTITUTION,
      academicPeriodId: PERIOD,
      gradeId: GRADE,
      quota: 'general',
      seats: 1,
    });

    const first = await service.createEnquiry(TENANT, {
      institutionId: INSTITUTION,
      academicPeriodId: PERIOD,
      gradeId: GRADE,
      firstName: 'Ada',
      lastName: 'Lovelace',
      dateOfBirth: '2012-01-01',
      guardianName: 'Parent One',
      guardianPhone: '+91111',
      interviewScore: 90,
      testScore: 90,
    });
    const second = await service.createEnquiry(TENANT, {
      institutionId: INSTITUTION,
      academicPeriodId: PERIOD,
      gradeId: GRADE,
      firstName: 'Alan',
      lastName: 'Turing',
      dateOfBirth: '2012-02-02',
      guardianName: 'Parent Two',
      guardianPhone: '+91222',
      interviewScore: 80,
      testScore: 80,
    });

    const convertedA = await service.convertEnquiry(TENANT, first.id);
    const convertedB = await service.convertEnquiry(TENANT, second.id);

    const offerA = await service.createOffer(TENANT, {
      applicationId: convertedA.application.id,
      feeAmount: 1000,
    });
    await service.sendOffer(TENANT, offerA.id);
    const accepted = await service.acceptOffer(TENANT, offerA.id, { paymentRef: 'SANDBOX-1' });
    expect(accepted.status).toBe('accepted');
    expect(accepted.enrolledStudentId).toBeTruthy();

    await expect(
      service.createOffer(TENANT, {
        applicationId: convertedB.application.id,
        feeAmount: 1000,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(enrolments).toHaveLength(1);
  });

  it('accept is idempotent and does not enrol twice', async () => {
    const store = new InMemoryAdmissionsPipelineStore();
    const apps = new InMemoryRegistrationRepository();
    let enrolCalls = 0;
    const studentId = randomUUID();
    const service = new AdmissionsPipelineService(store, apps, async () => {
      enrolCalls += 1;
      return { studentId, enrollmentId: randomUUID() };
    });

    await service.upsertSeat(TENANT, {
      institutionId: INSTITUTION,
      academicPeriodId: PERIOD,
      gradeId: GRADE,
      seats: 5,
    });
    const enquiry = await service.createEnquiry(TENANT, {
      institutionId: INSTITUTION,
      academicPeriodId: PERIOD,
      gradeId: GRADE,
      firstName: 'Grace',
      lastName: 'Hopper',
      dateOfBirth: '2011-12-09',
      guardianName: 'Parent',
      guardianPhone: '+91333',
      interviewScore: 70,
      testScore: 75,
    });
    const converted = await service.convertEnquiry(TENANT, enquiry.id);
    const offer = await service.createOffer(TENANT, { applicationId: converted.application.id });
    await service.sendOffer(TENANT, offer.id);

    const first = await service.acceptOffer(TENANT, offer.id, { paymentRef: 'SANDBOX-OK' });
    const second = await service.acceptOffer(TENANT, offer.id, { paymentRef: 'SANDBOX-RETRY' });
    expect(first.id).toBe(second.id);
    expect(first.enrolledStudentId).toBe(studentId);
    expect(second.enrolledStudentId).toBe(studentId);
    expect(second.paymentRef).toBe('SANDBOX-OK');
    expect(enrolCalls).toBe(1);
  });

  it('mounts pipeline routes under /admissions and converts an enquiry', async () => {
    const store = new InMemoryAdmissionsPipelineStore();
    const apps = new InMemoryRegistrationRepository();
    const service = new AdmissionsPipelineService(store, apps);
    const app = Fastify();
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = TENANT;
    });
    await registerAdmissionsPipelineRoutes(app, { service });
    await app.ready();

    const created = await app.inject({
      method: 'POST',
      url: '/admissions/enquiries',
      payload: {
        institutionId: INSTITUTION,
        academicPeriodId: PERIOD,
        gradeId: GRADE,
        firstName: 'Lin',
        lastName: 'Manuel',
        dateOfBirth: '2013-03-03',
        guardianName: 'Parent',
        guardianPhone: '+91444',
      },
    });
    expect(created.statusCode).toBe(201);
    const enquiryId = created.json().id as string;

    const converted = await app.inject({
      method: 'POST',
      url: `/admissions/enquiries/${enquiryId}/convert`,
    });
    expect(converted.statusCode).toBe(201);
    expect(converted.json().application.trackingNumber).toMatch(/^REG-/);

    await app.close();
    expect(BusinessRuleError).toBeDefined();
  });

  it('lists and accepts offers only for matching guardian email', async () => {
    const store = new InMemoryAdmissionsPipelineStore();
    const apps = new InMemoryRegistrationRepository();
    const service = new AdmissionsPipelineService(store, apps, async () => ({
      studentId: randomUUID(),
      enrollmentId: randomUUID(),
    }));

    await service.upsertSeat(TENANT, {
      institutionId: INSTITUTION,
      academicPeriodId: PERIOD,
      gradeId: GRADE,
      seats: 5,
    });

    const mine = await service.createEnquiry(TENANT, {
      institutionId: INSTITUTION,
      academicPeriodId: PERIOD,
      gradeId: GRADE,
      firstName: 'Mine',
      lastName: 'Child',
      dateOfBirth: '2014-01-01',
      guardianName: 'My Parent',
      guardianPhone: '+91555',
      guardianEmail: 'parent@family.test',
      interviewScore: 88,
      testScore: 90,
    });
    const other = await service.createEnquiry(TENANT, {
      institutionId: INSTITUTION,
      academicPeriodId: PERIOD,
      gradeId: GRADE,
      firstName: 'Other',
      lastName: 'Child',
      dateOfBirth: '2014-02-02',
      guardianName: 'Other Parent',
      guardianPhone: '+91666',
      guardianEmail: 'other@family.test',
      interviewScore: 70,
      testScore: 70,
    });
    const convertedMine = await service.convertEnquiry(TENANT, mine.id);
    const convertedOther = await service.convertEnquiry(TENANT, other.id);
    const offerMine = await service.createOffer(TENANT, {
      applicationId: convertedMine.application.id,
      feeAmount: 500,
    });
    const offerOther = await service.createOffer(TENANT, {
      applicationId: convertedOther.application.id,
      feeAmount: 500,
    });
    await service.sendOffer(TENANT, offerMine.id);
    await service.sendOffer(TENANT, offerOther.id);

    const visible = await service.listGuardianOffers(TENANT, 'Parent@Family.TEST');
    expect(visible).toHaveLength(1);
    expect(visible[0]!.id).toBe(offerMine.id);
    expect(visible[0]!.applicantFirstName).toBe('Mine');
    expect(visible[0]!.feeAmount).toBe(500);

    await expect(
      service.acceptOfferForGuardian(TENANT, offerOther.id, 'parent@family.test', {
        paymentRef: 'SANDBOX-PAY',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const accepted = await service.acceptOfferForGuardian(
      TENANT,
      offerMine.id,
      'parent@family.test',
      { paymentRef: 'SANDBOX-PAY' },
    );
    expect(accepted.status).toBe('accepted');
    expect(accepted.enrolledStudentId).toBeTruthy();
  });
});
