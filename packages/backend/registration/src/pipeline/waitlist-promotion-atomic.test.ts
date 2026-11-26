/**
 * PRC-M537: offer side effects.
 * - A waitlist promotion failure is reported on the decline response (not swallowed).
 * - A read path that finds an overdue offer re-reads it under the offer lock, so it
 *   never overwrites an accept/decline that committed after the list was read.
 * The all-or-nothing rollback of the promotion is proved on Postgres in
 * waitlist-promotion-atomic.live.test.ts (the in-memory store has no transactions).
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { InMemoryAdmissionsCrmStore } from '../admissions-crm-store.js';
import { InMemoryRegistrationRepository } from '../in-memory-repository.js';
import { RegistrationService } from '../registration-service.js';
import { AdmissionsPipelineService } from './pipeline-service.js';
import { InMemoryAdmissionsPipelineStore, type OfferRecord } from './pipeline-store.js';

const TENANT = randomUUID();
const INSTITUTION = randomUUID();
const PERIOD = randomUUID();
const GRADE = randomUUID();

/** Fails the next createOffer once armed (the promotion's offer insert). */
class FailingOfferStore extends InMemoryAdmissionsPipelineStore {
  failNextCreate = false;
  /** When set, listOffers returns this stale snapshot instead of the stored rows. */
  staleList: OfferRecord[] | null = null;
  override async createOffer(record: OfferRecord): Promise<OfferRecord> {
    if (this.failNextCreate) {
      this.failNextCreate = false;
      throw new Error('injected offer insert failure');
    }
    return super.createOffer(record);
  }
  override async listOffers(
    ...args: Parameters<InMemoryAdmissionsPipelineStore['listOffers']>
  ): Promise<OfferRecord[]> {
    if (this.staleList) return this.staleList.map((o) => ({ ...o }));
    return super.listOffers(...args);
  }
}

async function setup() {
  const store = new FailingOfferStore();
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
  return { store, pipeline, registration, application };
}

describe('PRC-M537 offer side effects', () => {
  it('reports a waitlist promotion failure instead of swallowing it', async () => {
    const { store, pipeline, registration, application } = await setup();
    const offered = await application('Offered');
    const next = await application('Next');
    await registration.updateApplicationStatus(TENANT, next, 'waitlisted');
    const offer = await pipeline.createOffer(TENANT, { applicationId: offered });
    await pipeline.sendOffer(TENANT, offer.id);
    store.failNextCreate = true;
    const declined = await pipeline.declineOffer(TENANT, offer.id);
    expect(declined.status).toBe('declined');
    expect(declined.promotedOffer).toBeNull();
    expect(declined.promotionError).toBe('injected offer insert failure');
  });

  it('a successful promotion reports no error', async () => {
    const { pipeline, registration, application } = await setup();
    const offered = await application('Offered');
    const next = await application('Next');
    await registration.updateApplicationStatus(TENANT, next, 'waitlisted');
    const offer = await pipeline.createOffer(TENANT, { applicationId: offered });
    await pipeline.sendOffer(TENANT, offer.id);
    const declined = await pipeline.declineOffer(TENANT, offer.id);
    expect(declined.promotedOffer?.applicationId).toBe(next);
    expect(declined.promotionError).toBeNull();
  });

  it('read-path expiry never overwrites an offer accepted after the list was read', async () => {
    const { store, pipeline, application } = await setup();
    const appId = await application('Racer');
    const offer = await pipeline.createOffer(TENANT, { applicationId: appId });
    await pipeline.sendOffer(TENANT, offer.id);
    const sent = (await store.findOffer(TENANT, offer.id))!;
    // The list was read while the offer was still `sent` and now looks overdue ...
    store.staleList = [{ ...sent, expiresAt: new Date(Date.now() - 60_000) }];
    // ... but it was accepted in the meantime.
    await store.updateOffer({ ...sent, status: 'accepted', updatedAt: new Date() });
    const listed = await pipeline.listOffers(TENANT, appId);
    expect(listed.data[0]?.status).toBe('accepted');
    expect((await store.findOffer(TENANT, offer.id))?.status).toBe('accepted');
  });
});
