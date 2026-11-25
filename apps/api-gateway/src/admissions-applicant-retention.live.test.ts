/**
 * PRC-M016 (DR35): when an admission offer is declined or expires, the applicant's
 * student master (created for the offer fee invoice, with guardian PII) records
 * when the offer closed and the date after which it must be erased (12 months).
 *
 * The hook path needs the Prisma student repository (the in-memory fallback is a
 * fresh store per call), so it runs against live Postgres; skips when DATABASE_URL
 * is unset (the CI live gate provides it).
 */
import { randomUUID } from 'node:crypto';
import { createStudentRepository } from '@proctira/backend-student';
import { getSharedPgPool } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  admissionsRetainUntil,
  createOfferFeeInvoiceHook,
  reconcileAdmissionsOfferResourcesHook,
} from './domain-plugins.js';

const describeLive = process.env['DATABASE_URL'] ? describe : describe.skip;
const TENANT = randomUUID();
const CLOSED_AT = new Date('2026-06-30T10:00:00.000Z');

function offerInput(applicationId: string) {
  return {
    tenantId: TENANT,
    applicationId,
    offerId: `offer-${applicationId}`,
    firstName: 'Asha',
    lastName: 'Rao',
    dateOfBirth: '2015-04-01',
    gender: 'female',
    guardianName: 'Ravi Rao',
    guardianPhone: '+919800000000',
    guardianEmail: null,
    feeAmount: 2500,
    feeCurrency: 'INR',
  };
}

describe('PRC-M016 erase-after date', () => {
  it('is 12 months after the offer closes', () => {
    expect(admissionsRetainUntil(CLOSED_AT).toISOString()).toBe('2027-06-30T10:00:00.000Z');
  });
});

describeLive('PRC-M016 applicant master retention on decline/expiry (live Postgres)', () => {
  beforeAll(async () => {
    const pool = getSharedPgPool();
    if (!pool) throw new Error('shared pg pool unavailable');
    await ensurePgTestTenant(pool, TENANT);
  });

  it.each(['declined', 'expired'] as const)(
    '%s offer stamps the closed and erase-after dates on the master',
    async (status) => {
      const applicationId = randomUUID();
      const { invoiceId } = await createOfferFeeInvoiceHook()(offerInput(applicationId));
      await reconcileAdmissionsOfferResourcesHook(() => CLOSED_AT)({
        tenantId: TENANT,
        applicationId,
        invoiceId,
        status,
      });
      const master = await createStudentRepository().findById(applicationId, TENANT);
      expect(master?.customData).toMatchObject({
        admissionsApplicationId: applicationId,
        admissionsStatus: status,
        admissionsClosedAt: '2026-06-30T10:00:00.000Z',
        admissionsRetainUntil: '2027-06-30T10:00:00.000Z',
      });
    },
  );
});
