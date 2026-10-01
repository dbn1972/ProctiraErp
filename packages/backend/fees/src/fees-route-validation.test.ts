/**
 * PRC-L105 — malformed ids/dates/oversized arrays are 400s, not 500s.
 */
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { feesPlugin } from './fees-plugin.js';
import { InMemoryFeesRepository } from './in-memory-repository.js';

const TENANT_ID = '00000000-0000-4000-8000-000000000001';
const STUDENT_ID = '00000000-0000-4000-8000-000000000099';
const INVOICE_ID = '00000000-0000-4000-8000-0000000000aa';

async function buildApp(repository = new InMemoryFeesRepository()): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorateRequest('tenantId', '');
  app.addHook('onRequest', async (request) => {
    const r = request as { tenantId?: string; user?: { sub?: string; roles?: unknown } };
    r.tenantId = TENANT_ID;
    r.user = { sub: 'bursar-1', roles: ['bursar'] };
  });
  await app.register(feesPlugin, { repository, prefix: '/fees' });
  await app.ready();
  return app;
}

describe('fees route validation (PRC-L105)', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('DELETE /fees/reminders/suppressions/not-a-uuid -> 400', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/fees/reminders/suppressions/not-a-uuid',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it("invoice dueAt='garbage' -> 400; ISO date accepted", async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/fees/invoices',
      payload: { studentId: STUDENT_ID, title: 'Lab', amountCents: 100, dueAt: 'garbage' },
    });
    expect(bad.statusCode).toBe(400);
    const good = await app.inject({
      method: 'POST',
      url: '/fees/invoices',
      payload: { studentId: STUDENT_ID, title: 'Lab', amountCents: 100, dueAt: '2026-05-01' },
    });
    expect(good.statusCode).toBe(201);
  });

  it('reminders/send with 5000 invoiceIds -> 400; unknown channel -> 400', async () => {
    const many = await app.inject({
      method: 'POST',
      url: '/fees/reminders/send',
      payload: { invoiceIds: Array.from({ length: 5000 }, () => INVOICE_ID), channels: ['email'] },
    });
    expect(many.statusCode).toBe(400);
    const channel = await app.inject({
      method: 'POST',
      url: '/fees/reminders/send',
      payload: { invoiceIds: [INVOICE_ID], channels: ['pigeon'] },
    });
    expect(channel.statusCode).toBe(400);
  });

  it('dues report and overdue reminders reject a malformed asOf', async () => {
    for (const url of [
      '/fees/reports/dues?asOf=nope',
      '/fees/reminders/overdue?asOf=2026-13-99x',
    ]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(400);
    }
  });

  it('suppression, netting and clone-period reject non-UUID ids', async () => {
    const cases = [
      { url: '/fees/reminders/suppressions', payload: { studentId: 'x', reason: 'r' } },
      {
        url: '/fees/scholarships/net',
        payload: { studentId: STUDENT_ID, disbursementId: 'bad', amountCents: 10 },
      },
      {
        url: '/fees/structures/clone-period',
        payload: { sourcePeriodId: 'a', targetPeriodId: 'b' },
      },
    ];
    for (const c of cases) {
      const res = await app.inject({ method: 'POST', url: c.url, payload: c.payload });
      expect(res.statusCode).toBe(400);
    }
  });

  it('maps pg 22P02 to 400 and 23505 to 409', async () => {
    for (const [code, status] of [
      ['22P02', 400],
      ['23505', 409],
    ] as const) {
      await app.close();
      const repository = new InMemoryFeesRepository();
      (repository as unknown as Record<string, unknown>).deleteReminderSuppression = async () => {
        throw Object.assign(new Error('pg'), { code });
      };
      app = await buildApp(repository);
      const res = await app.inject({
        method: 'DELETE',
        url: `/fees/reminders/suppressions/${INVOICE_ID}`,
      });
      expect(res.statusCode).toBe(status);
    }
  });
});
