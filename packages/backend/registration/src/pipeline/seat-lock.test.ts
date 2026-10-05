/**
 * PRC-M328 — seat consumption is serialised per seat-matrix key, so N+1
 * concurrent accepts for N seats yield exactly N accepted; the PG store never
 * runs the critical section unlocked.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InMemoryRegistrationRepository } from '../in-memory-repository.js';
import { PgAdmissionsPipelineStore } from './pg-pipeline-store.js';
import { AdmissionsPipelineService } from './pipeline-service.js';
import { InMemoryAdmissionsPipelineStore } from './pipeline-store.js';

const TENANT = randomUUID();
const INSTITUTION = randomUUID();
const PERIOD = randomUUID();
const GRADE = randomUUID();

async function setup(seats: number, offers: number) {
  const store = new InMemoryAdmissionsPipelineStore();
  const apps = new InMemoryRegistrationRepository();
  const service = new AdmissionsPipelineService(store, apps, async () => {
    // simulate a slow enrolment so unserialised accepts would interleave
    await new Promise((r) => setTimeout(r, 5));
    return { studentId: randomUUID(), enrollmentId: randomUUID() };
  });
  await service.upsertSeat(TENANT, {
    institutionId: INSTITUTION,
    academicPeriodId: PERIOD,
    gradeId: GRADE,
    seats,
  });
  const ids: string[] = [];
  for (let i = 0; i < offers; i += 1) {
    const enquiry = await service.createEnquiry(TENANT, {
      institutionId: INSTITUTION,
      academicPeriodId: PERIOD,
      gradeId: GRADE,
      firstName: `C${i}`,
      lastName: 'Seat',
      dateOfBirth: '2014-01-01',
      guardianName: 'G',
      guardianPhone: '+91000',
    });
    const converted = await service.convertEnquiry(TENANT, enquiry.id);
    const offer = await service.createOffer(TENANT, { applicationId: converted.application.id });
    await service.sendOffer(TENANT, offer.id);
    ids.push(offer.id);
  }
  return { service, store, ids };
}

describe('PRC-M328 seat capacity under concurrency', () => {
  it('2 concurrent accepts for 1 seat -> exactly one accepted, one 409', async () => {
    const { service, ids } = await setup(1, 2);
    const results = await Promise.allSettled(ids.map((id) => service.acceptOffer(TENANT, id, {})));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(rejected).toHaveLength(1);
    expect((rejected[0]!.reason as { statusCode?: number }).statusCode).toBe(409);
  });

  it('N+1 concurrent accepts for N seats -> exactly N accepted', async () => {
    const { service, store, ids } = await setup(3, 4);
    await Promise.allSettled(ids.map((id) => service.acceptOffer(TENANT, id, {})));
    const accepted = (await store.listOffers(TENANT)).filter((o) => o.status === 'accepted');
    expect(accepted).toHaveLength(3);
  });

  it('PG store fails closed when the pool cannot provide a lock connection', async () => {
    const pool = { query: async () => ({ rows: [] }) };
    const store = new PgAdmissionsPipelineStore(pool as never);
    let ran = false;
    await expect(
      store.withSeatLock(
        TENANT,
        { institutionId: INSTITUTION, academicPeriodId: PERIOD, gradeId: GRADE, quota: 'general' },
        async () => {
          ran = true;
        },
      ),
    ).rejects.toThrow(/lock unavailable/i);
    expect(ran).toBe(false);
  });
});
