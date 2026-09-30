/**
 * PRC-H020 — POST /fees/scholarships/net must verify the disbursement against the
 * scholarship domain (tenant, paid status, student, amount) and require concession.approve.
 */
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { feesPlugin } from './fees-plugin.js';
import type {
  NettableScholarshipDisbursement,
  ScholarshipDisbursementLookup,
} from './fees-service.js';
import { InMemoryFeesRepository } from './in-memory-repository.js';

const TENANT_A = '00000000-0000-4000-8000-00000000000a';
const TENANT_B = '00000000-0000-4000-8000-00000000000b';
const STUDENT = '00000000-0000-4000-8000-000000000099';
const OTHER_STUDENT = '00000000-0000-4000-8000-000000000098';

const disbursements: NettableScholarshipDisbursement[] = [
  {
    id: 'disb-paid',
    tenantId: TENANT_A,
    studentId: STUDENT,
    amountCents: 2500,
    paymentStatus: 'paid',
  },
  {
    id: 'disb-scheduled',
    tenantId: TENANT_A,
    studentId: STUDENT,
    amountCents: 4000,
    paymentStatus: 'scheduled',
  },
  {
    id: 'disb-other-tenant',
    tenantId: TENANT_B,
    studentId: STUDENT,
    amountCents: 9000,
    paymentStatus: 'paid',
  },
];

const lookup: ScholarshipDisbursementLookup = {
  async findDisbursement(tenantId, id) {
    return disbursements.find((d) => d.id === id && d.tenantId === tenantId) ?? null;
  },
  async listPaidDisbursements(tenantId) {
    return disbursements.filter((d) => d.tenantId === tenantId && d.paymentStatus === 'paid');
  },
};

async function buildApp(
  roles: string[],
  options: { withLookup?: boolean } = {},
): Promise<{ app: FastifyInstance; repo: InMemoryFeesRepository }> {
  const repo = new InMemoryFeesRepository();
  const app = Fastify();
  app.decorateRequest('tenantId', '');
  app.addHook('onRequest', async (request) => {
    const r = request as { tenantId?: string; user?: { sub?: string; roles?: string[] } };
    r.tenantId = TENANT_A;
    r.user = { sub: 'staff-user', roles };
  });
  await app.register(feesPlugin, {
    repository: repo,
    prefix: '/fees',
    ...(options.withLookup === false ? {} : { scholarshipDisbursements: lookup }),
  });
  await app.ready();
  return { app, repo };
}

async function concessionCount(repo: InMemoryFeesRepository): Promise<number> {
  const rows = await Promise.all(
    disbursements.map((d) => repo.findConcessionBySourceDisbursementId(TENANT_A, d.id)),
  );
  return rows.filter(Boolean).length;
}

describe('PRC-H020 scholarship netting HTTP verification', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('rejects an unknown disbursement id with 404 and creates no concession', async () => {
    const built = await buildApp(['finance_officer']);
    app = built.app;
    const res = await app.inject({
      method: 'POST',
      url: '/fees/scholarships/net',
      payload: { studentId: STUDENT, disbursementId: 'typed-by-hand', amountCents: 2500 },
    });
    expect(res.statusCode).toBe(404);
    expect(await concessionCount(built.repo)).toBe(0);
  });

  it('rejects an unpaid disbursement with 4xx and creates no concession', async () => {
    const built = await buildApp(['finance_officer']);
    app = built.app;
    const res = await app.inject({
      method: 'POST',
      url: '/fees/scholarships/net',
      payload: { studentId: STUDENT, disbursementId: 'disb-scheduled', amountCents: 4000 },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    expect(await concessionCount(built.repo)).toBe(0);
  });

  it('rejects an amount that differs from the disbursement amount', async () => {
    const built = await buildApp(['finance_officer']);
    app = built.app;
    const res = await app.inject({
      method: 'POST',
      url: '/fees/scholarships/net',
      payload: { studentId: STUDENT, disbursementId: 'disb-paid', amountCents: 999_999 },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    expect(await concessionCount(built.repo)).toBe(0);
  });

  it('rejects a disbursement that belongs to another student', async () => {
    const built = await buildApp(['finance_officer']);
    app = built.app;
    const res = await app.inject({
      method: 'POST',
      url: '/fees/scholarships/net',
      payload: { studentId: OTHER_STUDENT, disbursementId: 'disb-paid' },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    expect(await concessionCount(built.repo)).toBe(0);
  });

  it('rejects a cross-tenant disbursement id', async () => {
    const built = await buildApp(['finance_officer']);
    app = built.app;
    const res = await app.inject({
      method: 'POST',
      url: '/fees/scholarships/net',
      payload: { studentId: STUDENT, disbursementId: 'disb-other-tenant', amountCents: 9000 },
    });
    expect(res.statusCode).toBe(404);
    expect(await concessionCount(built.repo)).toBe(0);
  });

  it('denies fees_clerk (fees.write without concession.approve)', async () => {
    const built = await buildApp(['fees_clerk']);
    app = built.app;
    const res = await app.inject({
      method: 'POST',
      url: '/fees/scholarships/net',
      payload: { studentId: STUDENT, disbursementId: 'disb-paid', amountCents: 2500 },
    });
    expect(res.statusCode).toBe(403);
    expect(await concessionCount(built.repo)).toBe(0);
  });

  it('fails closed with 503 when no disbursement lookup is configured', async () => {
    const built = await buildApp(['finance_officer'], { withLookup: false });
    app = built.app;
    const res = await app.inject({
      method: 'POST',
      url: '/fees/scholarships/net',
      payload: { studentId: STUDENT, disbursementId: 'disb-paid', amountCents: 2500 },
    });
    expect(res.statusCode).toBe(503);
    expect(await concessionCount(built.repo)).toBe(0);
  });

  it('credits the disbursement amount and replays the stored amount idempotently', async () => {
    const built = await buildApp(['finance_officer']);
    app = built.app;
    const first = await app.inject({
      method: 'POST',
      url: '/fees/scholarships/net',
      payload: { studentId: STUDENT, disbursementId: 'disb-paid' },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().concession.amountCents).toBe(2500);
    expect(first.json().idempotent).toBe(false);

    const list = await app.inject({
      method: 'GET',
      url: `/fees/scholarships/nettable-disbursements?studentId=${STUDENT}`,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toEqual([]);

    const replay = await app.inject({
      method: 'POST',
      url: '/fees/scholarships/net',
      payload: { studentId: STUDENT, disbursementId: 'disb-paid', amountCents: 2500 },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().idempotent).toBe(true);
    expect(replay.json().discountCents).toBe(2500);
  });

  it('lists only paid, un-netted disbursements in the caller tenant', async () => {
    const built = await buildApp(['finance_officer']);
    app = built.app;
    const res = await app.inject({
      method: 'GET',
      url: '/fees/scholarships/nettable-disbursements',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((d: { id: string }) => d.id)).toEqual(['disb-paid']);
  });
});
