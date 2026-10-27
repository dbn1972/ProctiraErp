/**
 * PRC-L141 — admissions seat races and the guardian fee-bypass path on a real, migrated
 * Postgres (runtime app role, RLS enforced), not the in-memory store:
 * - PRC-M328: concurrent accepts never over-fill a seat-matrix row (advisory seat lock).
 * - PRC-H079: an arbitrary paymentRef (staff or guardian path) never accepts a fee-bearing
 *   offer while its `parent_fee_invoices` row is unpaid; the offer stays `sent` in PG.
 *
 * Fails closed when CI=true or REQUIRE_LIVE_TESTS=1 and DATABASE_URL is unset (W3-TEST-03);
 * otherwise skips loudly for local unit-only runs.
 */
import { randomUUID } from 'node:crypto';
import { BusinessRuleError } from '@proctira/common';
import { closeSharedPgPools, getSharedPgPool, withPgTenant } from '@proctira/database';
import { ensurePgTestStudent, ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { afterAll, describe, expect, it } from 'vitest';
import { PgRegistrationRepository } from '../pg-registration-repository.js';
import { PgAdmissionsPipelineStore } from './pg-pipeline-store.js';
import { AdmissionsPipelineService } from './pipeline-service.js';

const SUITE = 'admissions-pipeline.live.test';
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

const GUARDIAN_EMAIL = 'guardian@family.test';

interface Fixture {
  tenantId: string;
  institutionId: string;
  academicPeriodId: string;
  gradeId: string;
  /** Owner of the fee invoices (parent_fee_invoices.student_id is NOT NULL). */
  invoiceStudentId: string;
}

async function seedTenant(): Promise<Fixture> {
  const tenantId = randomUUID();
  const gradeId = randomUUID();
  const invoiceStudentId = randomUUID();
  await ensurePgTestTenant(pool!, tenantId);
  await ensurePgTestStudent(pool!, tenantId, invoiceStudentId);
  await withPgTenant(pool!, tenantId, async (client) => {
    await client.query(
      `INSERT INTO grades (id, tenant_id, name, code, "order") VALUES ($1, $2, 'Grade 1', $3, 1)`,
      [gradeId, tenantId, `G1-${gradeId.slice(0, 8)}`],
    );
  });
  return {
    tenantId,
    institutionId: randomUUID(),
    academicPeriodId: randomUUID(),
    gradeId,
    invoiceStudentId,
  };
}

/**
 * Service on the PG store + PG applications repository. Fee hooks use the real
 * `parent_fee_invoices` table: offers get an `open` invoice, and acceptance is allowed only
 * when that row reads back `paid` (the PSP-webhook-owned state), as in production.
 */
/**
 * Enrolment runs after the seat count inside the seat lock. Each caller waits here until
 * `parties` callers have arrived or `maxWaitMs` passes. Without the seat lock every accept
 * reaches this point after counting the same free seats, so they are released together and
 * over-fill deterministically; with the lock only one caller is ever inside, so it simply
 * waits out `maxWaitMs` and proceeds.
 */
function enrolmentBarrier(parties: number, maxWaitMs = 300): () => Promise<void> {
  let waiting: Array<() => void> = [];
  return () =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        waiting = waiting.filter((go) => go !== release);
        resolve();
      }, maxWaitMs);
      const release = () => {
        clearTimeout(timer);
        resolve();
      };
      waiting.push(release);
      if (waiting.length >= parties) {
        const all = waiting;
        waiting = [];
        all.forEach((go) => go());
      }
    });
}

function pgService(fx: Fixture, opts: { racers?: number } = {}) {
  const store = new PgAdmissionsPipelineStore(pool!);
  const enrolled: string[] = [];
  const barrier = opts.racers ? enrolmentBarrier(opts.racers) : null;
  const service = new AdmissionsPipelineService(
    store,
    new PgRegistrationRepository(pool!),
    async () => {
      if (barrier) await barrier();
      const studentId = randomUUID();
      await ensurePgTestStudent(pool!, fx.tenantId, studentId);
      enrolled.push(studentId);
      return { studentId, enrollmentId: randomUUID() };
    },
    async () => {
      const invoiceId = randomUUID();
      await withPgTenant(pool!, fx.tenantId, async (client) => {
        await client.query(
          `INSERT INTO parent_fee_invoices (id, tenant_id, student_id, title, amount_cents, status)
           VALUES ($1, $2, $3, 'Offer fee', 100000, 'open')`,
          [invoiceId, fx.tenantId, fx.invoiceStudentId],
        );
      });
      return { invoiceId };
    },
    async ({ invoiceId }) => {
      const res = await withPgTenant(pool!, fx.tenantId, (client) =>
        client.query(`SELECT status FROM parent_fee_invoices WHERE id = $1 AND tenant_id = $2`, [
          invoiceId,
          fx.tenantId,
        ]),
      );
      if ((res.rows[0] as { status?: string } | undefined)?.status !== 'paid') {
        throw new BusinessRuleError('Offer fee invoice must be paid before enrolment');
      }
    },
  );
  return { service, store, enrolled };
}

async function sentOffers(
  fx: Fixture,
  service: AdmissionsPipelineService,
  seats: number,
  offers: number,
  feeAmount?: number,
): Promise<string[]> {
  const seat = {
    institutionId: fx.institutionId,
    academicPeriodId: fx.academicPeriodId,
    gradeId: fx.gradeId,
  };
  await service.upsertSeat(fx.tenantId, { ...seat, seats });
  const ids: string[] = [];
  for (let i = 0; i < offers; i += 1) {
    const enquiry = await service.createEnquiry(fx.tenantId, {
      ...seat,
      firstName: `C${i}`,
      lastName: 'Seat',
      dateOfBirth: '2014-01-01',
      guardianName: 'Guardian',
      guardianPhone: '+91000',
      guardianEmail: GUARDIAN_EMAIL,
    });
    const converted = await service.convertEnquiry(fx.tenantId, enquiry.id);
    const offer = await service.createOffer(fx.tenantId, {
      applicationId: converted.application.id,
      ...(feeAmount !== undefined ? { feeAmount } : {}),
    });
    await service.sendOffer(fx.tenantId, offer.id);
    ids.push(offer.id);
  }
  return ids;
}

describe.skipIf(!pool)('admissions pipeline on Postgres (PRC-L141)', () => {
  it('2 concurrent accepts for 1 seat -> exactly one accepted, one 409', async () => {
    const fx = await seedTenant();
    const { service, store } = pgService(fx, { racers: 2 });
    const ids = await sentOffers(fx, service, 1, 2);
    const results = await Promise.allSettled(
      ids.map((id) => service.acceptOffer(fx.tenantId, id, {})),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0]!.reason as { statusCode?: number }).statusCode).toBe(409);
    const accepted = (await store.listOffers(fx.tenantId)).filter((o) => o.status === 'accepted');
    expect(accepted).toHaveLength(1);
  });

  it('N+1 concurrent accepts for N seats -> exactly N accepted, the rest 409', async () => {
    const fx = await seedTenant();
    const { service, store } = pgService(fx, { racers: 4 });
    const ids = await sentOffers(fx, service, 3, 4);
    const results = await Promise.allSettled(
      ids.map((id) => service.acceptOffer(fx.tenantId, id, {})),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected.map((r) => (r.reason as { statusCode?: number }).statusCode)).toEqual([409]);
    const accepted = (await store.listOffers(fx.tenantId)).filter((o) => o.status === 'accepted');
    expect(accepted).toHaveLength(3);
    expect(
      await store.countAcceptedSeats(fx.tenantId, {
        institutionId: fx.institutionId,
        academicPeriodId: fx.academicPeriodId,
        gradeId: fx.gradeId,
        quota: 'general',
      }),
    ).toBe(3);
  });

  it('rejects a staff accept with an arbitrary paymentRef on an unpaid invoice; offer stays sent', async () => {
    const fx = await seedTenant();
    const { service, store, enrolled } = pgService(fx);
    const [offerId] = await sentOffers(fx, service, 5, 1, 1000);
    const sent = await store.findOffer(fx.tenantId, offerId!);
    expect(sent?.offerFeeInvoiceId).toBeTruthy();
    await expect(
      service.acceptOffer(fx.tenantId, offerId!, { paymentRef: 'x' }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    expect((await store.findOffer(fx.tenantId, offerId!))?.status).toBe('sent');
    expect(enrolled).toHaveLength(0);
  });

  it('rejects a guardian accept via the parent portal path while the invoice is unpaid', async () => {
    const fx = await seedTenant();
    const { service, store, enrolled } = pgService(fx);
    const [offerId] = await sentOffers(fx, service, 5, 1, 1000);
    await expect(
      service.acceptOfferForGuardian(fx.tenantId, offerId!, GUARDIAN_EMAIL, {
        paymentRef: 'SANDBOX-PAY',
      }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    expect((await store.findOffer(fx.tenantId, offerId!))?.status).toBe('sent');
    expect(enrolled).toHaveLength(0);
  });
});
