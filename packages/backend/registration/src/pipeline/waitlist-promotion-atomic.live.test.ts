/**
 * PRC-M537 live proof: a waitlist promotion (dequeue head, application status,
 * placement, new offer) is one Postgres transaction. With the offer insert
 * failing after it ran, the waitlist entry, the application status and the
 * offer table are all left as they were. Skipped without DATABASE_URL.
 */
import { randomUUID } from 'node:crypto';
import { closeSharedPgPools, getSharedPgPool, withPgTenant } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { afterAll, describe, expect, it } from 'vitest';

import { PgAdmissionsCrmStore } from '../pg-admissions-crm-store.js';
import { PgRegistrationRepository } from '../pg-registration-repository.js';
import { RegistrationService } from '../registration-service.js';
import { PgAdmissionsPipelineStore } from './pg-pipeline-store.js';
import { AdmissionsPipelineService } from './pipeline-service.js';
import type { OfferRecord } from './pipeline-store.js';

const SUITE = 'waitlist-promotion-atomic.live.test';
const DATABASE_URL = process.env['DATABASE_URL']?.trim();
const liveRequired =
  process.env['ALLOW_LIVE_TEST_SKIP'] !== '1' &&
  (process.env['REQUIRE_LIVE_TESTS'] === '1' ||
    process.env['CI'] === 'true' ||
    process.env['CI'] === '1');
if (!DATABASE_URL && liveRequired) {
  throw new Error(`[W3-TEST-03] Live suite "${SUITE}" has no DATABASE_URL.`);
}
if (!DATABASE_URL) console.warn(`WARNING: [W3-TEST-03] ${SUITE} skipped (no DATABASE_URL).`);
const pool = DATABASE_URL ? getSharedPgPool() : null;

afterAll(async () => {
  await closeSharedPgPools();
});

/** The promotion's offer INSERT runs, then the call fails (post-insert failure). */
class FailAfterInsertStore extends PgAdmissionsPipelineStore {
  failNextCreate = false;
  override async createOffer(record: OfferRecord): Promise<OfferRecord> {
    const created = await super.createOffer(record);
    if (this.failNextCreate) {
      this.failNextCreate = false;
      throw new Error('injected failure after offer insert');
    }
    return created;
  }
}

describe.skipIf(!pool)('PRC-M537 waitlist promotion is all-or-nothing (live)', () => {
  it('an injected failure leaves the waitlist, application status and offers unchanged', async () => {
    const tenantId = randomUUID();
    const institutionId = randomUUID();
    const academicPeriodId = randomUUID();
    const gradeId = randomUUID();
    await ensurePgTestTenant(pool!, tenantId);
    await withPgTenant(pool!, tenantId, async (client) => {
      await client.query(
        `INSERT INTO grades (id, tenant_id, name, code, "order") VALUES ($1, $2, 'Grade 1', $3, 1)`,
        [gradeId, tenantId, `G1-${gradeId.slice(0, 8)}`],
      );
    });
    const store = new FailAfterInsertStore(pool!);
    const apps = new PgRegistrationRepository(pool!);
    const crm = new PgAdmissionsCrmStore(pool!);
    const pipeline = new AdmissionsPipelineService(
      store,
      apps,
      async () => ({ studentId: randomUUID(), enrollmentId: randomUUID() }),
      undefined,
      undefined,
      crm,
    );
    const registration = new RegistrationService(apps, crm);
    await pipeline.upsertSeat(tenantId, { institutionId, academicPeriodId, gradeId, seats: 3 });
    const application = async (firstName: string) => {
      const enquiry = await pipeline.createEnquiry(tenantId, {
        institutionId,
        academicPeriodId,
        gradeId,
        firstName,
        lastName: 'Atomic',
        dateOfBirth: '2013-01-01',
        guardianName: 'G',
        guardianPhone: '+91000',
      });
      return (await pipeline.convertEnquiry(tenantId, enquiry.id)).application.id;
    };
    const offered = await application('Offered');
    const next = await application('Next');
    await registration.updateApplicationStatus(tenantId, next, 'waitlisted');
    const offer = await pipeline.createOffer(tenantId, { applicationId: offered });
    await pipeline.sendOffer(tenantId, offer.id);

    store.failNextCreate = true;
    const declined = await pipeline.declineOffer(tenantId, offer.id);
    expect(declined.status).toBe('declined');
    expect(declined.promotedOffer).toBeNull();

    const waitlist = await crm.listWaitlist(tenantId, institutionId);
    expect(waitlist.map((w) => w.applicationId)).toEqual([next]);
    expect((await apps.findById(next, tenantId))?.status).toBe('waitlisted');
    expect(await store.listOffers(tenantId, next)).toHaveLength(0);
    expect(declined.promotionError).toBe('injected failure after offer insert');

    // The rolled-back applicant is promoted by the next released seat.
    const second = await pipeline.createOffer(tenantId, { applicationId: await application('B') });
    await pipeline.sendOffer(tenantId, second.id);
    const retried = await pipeline.declineOffer(tenantId, second.id);
    expect(retried.promotedOffer?.applicationId).toBe(next);
    expect(await crm.listWaitlist(tenantId, institutionId)).toHaveLength(0);
  });
});
