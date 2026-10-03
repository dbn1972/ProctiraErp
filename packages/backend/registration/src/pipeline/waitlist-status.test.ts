/**
 * PRC-M329 — waitlist entries follow application status: leaving `waitlisted`
 * removes the entry and promotion never picks a non-waitlisted applicant.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InMemoryAdmissionsCrmStore } from '../admissions-crm-store.js';
import { InMemoryRegistrationRepository } from '../in-memory-repository.js';
import { RegistrationService } from '../registration-service.js';
import { AdmissionsPipelineService } from './pipeline-service.js';
import { InMemoryAdmissionsPipelineStore } from './pipeline-store.js';

const TENANT = randomUUID();
const INSTITUTION = randomUUID();
const PERIOD = randomUUID();
const GRADE = randomUUID();

async function setup() {
  const store = new InMemoryAdmissionsPipelineStore();
  const apps = new InMemoryRegistrationRepository();
  const crm = new InMemoryAdmissionsCrmStore();
  const pipeline = new AdmissionsPipelineService(
    store,
    apps,
    async () => ({ studentId: randomUUID(), enrollmentId: randomUUID() }),
    undefined,
    undefined,
    crm,
  );
  const registration = new RegistrationService(apps, crm);
  await pipeline.upsertSeat(TENANT, {
    institutionId: INSTITUTION,
    academicPeriodId: PERIOD,
    gradeId: GRADE,
    seats: 3,
  });
  async function application(firstName: string) {
    const enquiry = await pipeline.createEnquiry(TENANT, {
      institutionId: INSTITUTION,
      academicPeriodId: PERIOD,
      gradeId: GRADE,
      firstName,
      lastName: 'W',
      dateOfBirth: '2013-01-01',
      guardianName: 'G',
      guardianPhone: '+91000',
    });
    return (await pipeline.convertEnquiry(TENANT, enquiry.id)).application.id;
  }
  return { pipeline, registration, crm, apps, application };
}

describe('PRC-M329 waitlist follows application status', () => {
  it('rejecting a waitlisted application removes its waitlist entry', async () => {
    const { registration, crm, application } = await setup();
    const id = await application('Rej');
    await registration.updateApplicationStatus(TENANT, id, 'waitlisted');
    expect(await crm.listWaitlist(TENANT, INSTITUTION)).toHaveLength(1);
    await registration.updateApplicationStatus(TENANT, id, 'rejected');
    expect(await crm.listWaitlist(TENANT, INSTITUTION)).toHaveLength(0);
  });

  it('a rejected applicant is never promoted when a seat is released', async () => {
    const { pipeline, registration, crm, application } = await setup();
    const offered = await application('Offered');
    const rejected = await application('Rejected');
    const next = await application('Next');
    await registration.updateApplicationStatus(TENANT, rejected, 'waitlisted');
    await registration.updateApplicationStatus(TENANT, next, 'waitlisted');
    await registration.updateApplicationStatus(TENANT, rejected, 'rejected');
    const offer = await pipeline.createOffer(TENANT, { applicationId: offered });
    await pipeline.sendOffer(TENANT, offer.id);
    const declined = await pipeline.declineOffer(TENANT, offer.id);
    expect(declined.promotedOffer?.applicationId).toBe(next);
    expect(await crm.listWaitlist(TENANT, INSTITUTION)).toHaveLength(0);
  });

  it('stale queue entries for non-waitlisted applications are skipped', async () => {
    const { pipeline, crm, apps, application } = await setup();
    const offered = await application('Offered');
    const stale = await application('Stale');
    // Entry left behind by a legacy path; application was approved directly.
    await crm.enqueueWaitlist({ tenantId: TENANT, applicationId: stale, institutionId: INSTITUTION });
    await apps.updateStatus(stale, 'approved', undefined, TENANT);
    const offer = await pipeline.createOffer(TENANT, { applicationId: offered });
    await pipeline.sendOffer(TENANT, offer.id);
    const declined = await pipeline.declineOffer(TENANT, offer.id);
    expect(declined.promotedOffer).toBeNull();
  });
});
