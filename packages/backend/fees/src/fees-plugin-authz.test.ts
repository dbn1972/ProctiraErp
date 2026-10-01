/**
 * W1-SEC-02 (D1) — fees route-level authorization deny proofs.
 */
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { InMemoryFeesRepository } from './in-memory-repository.js';
import { feesPlugin } from './fees-plugin.js';

const TENANT_ID = '00000000-0000-4000-8000-000000000001';
const STUDENT_ID = '00000000-0000-4000-8000-000000000099';

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function buildFeesApp(roles: unknown): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorateRequest('tenantId', '');
  app.addHook('onRequest', async (request) => {
    (request as { tenantId?: string; user?: { sub?: string; roles?: unknown } }).tenantId =
      TENANT_ID;
    (request as { tenantId?: string; user?: { sub?: string; roles?: unknown } }).user = {
      sub: 'user-test',
      roles,
    };
  });
  await app.register(feesPlugin, {
    repository: new InMemoryFeesRepository(),
    prefix: '/fees',
  });
  await app.ready();
  return app;
}

describe('fees-plugin RBAC deny proofs (W1-SEC-02 D1)', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  describe('forbidden staff mutations', () => {
    beforeEach(async () => {
      app = await buildFeesApp(['teacher']);
    });

    it('returns 403 when teacher creates an invoice', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/fees/invoices',
        payload: { studentId: STUDENT_ID, title: 'Lab fee', amountCents: 1000 },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('FORBIDDEN');
    });

    it('returns 403 when teacher voids an invoice', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/fees/invoices/${uuid()}/void`,
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('FORBIDDEN');
    });

    it('returns 403 when teacher records a payment', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/fees/payments',
        payload: { invoiceId: uuid(), amountCents: 100 },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('FORBIDDEN');
    });
  });

  describe('forbidden staff financial reads', () => {
    beforeEach(async () => {
      app = await buildFeesApp(['teacher']);
    });

    it('returns 403 when teacher reads trial balance', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/fees/ledger/trial-balance',
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('FORBIDDEN');
    });

    it('returns 403 when teacher lists tenant-wide payments', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/fees/payments',
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('FORBIDDEN');
    });
  });

  describe('allowed finance staff', () => {
    beforeEach(async () => {
      app = await buildFeesApp(['bursar']);
    });

    it('allows bursar to create an invoice (not 403)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/fees/invoices',
        payload: { studentId: STUDENT_ID, title: 'Term fee', amountCents: 50000 },
      });
      expect(response.statusCode).not.toBe(403);
      expect(response.statusCode).toBe(201);
    });

    it('allows bursar to read trial balance', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/fees/ledger/trial-balance',
      });
      expect(response.statusCode).toBe(200);
    });
  });

  describe('parent self-scope reads', () => {
    beforeEach(async () => {
      app = await buildFeesApp(['parent']);
    });

    it('allows parent scoped invoice list', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/fees/invoices?scope=parent',
      });
      expect(response.statusCode).toBe(200);
    });

    it('denies parent tenant-wide dues report', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/fees/reports/dues',
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('FORBIDDEN');
    });
  });
  // PRC-L560: adversarial deny proofs. These depend on the authz fixes tracked as
  // PRC-C005 (scope=parent escalation) and PRC-M511 (parent pay-IDOR), which are
  // outside this batch; convert each todo to a real assertion when those land.
  describe('adversarial deny proofs (pending PRC-C005 / PRC-M511)', () => {
    it.todo('PRC-C005: parent GET /fees/payments?scope=parent -> 403');
    it.todo('PRC-C005: parent GET /fees/ledger/trial-balance?scope=parent -> 403');
    it.todo('PRC-C005: parent GET /fees/reports/dues?scope=parent -> 403');
    it.todo('PRC-C005: parent GET /fees/receipts/:otherChildReceipt?scope=parent -> 404');
    it.todo('PRC-C005: parent GET /fees/reminders/overdue?scope=parent -> 403');
    it.todo('PRC-M511: parent POST /fees/invoices/:unlinkedInvoice/pay -> 404, no rows');
    it.todo('PRC-M511: parent payerUserId is overridden with JWT sub');
    it.todo('PRC-M511: parent method=cash is rejected');
  });
  describe('deny proofs that hold today (PRC-L560)', () => {
    beforeEach(async () => {
      app = await buildFeesApp(['parent']);
    });
    it('denies parent tenant-wide reads without scope', async () => {
      for (const url of ['/fees/payments', '/fees/ledger/trial-balance', '/fees/receipts']) {
        const response = await app.inject({ method: 'GET', url });
        expect(response.statusCode).toBe(403);
      }
    });
    it('denies parent money-adjustment mutations', async () => {
      const id = uuid();
      for (const [url, payload] of [
        [`/fees/invoices/${id}/refund`, { amountCents: 100, reason: 'r' }],
        [`/fees/invoices/${id}/write-offs`, { amountCents: 100, reason: 'r' }],
        [`/fees/invoices/${id}/credit-notes`, { amountCents: 100, reason: 'r' }],
        [`/fees/invoices/${id}/void`, { reason: 'r' }],
      ] as const) {
        const response = await app.inject({ method: 'POST', url, payload });
        expect(response.statusCode).toBe(403);
      }
    });
  });
});
