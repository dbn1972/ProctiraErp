/**
 * W1-SEC-02 (D1) — fees route-level authorization deny proofs.
 */
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { InMemoryFeesRepository } from './in-memory-repository.js';
import { feesPlugin } from './fees-plugin.js';
import { FeesService } from './fees-service.js';

const TENANT_ID = '00000000-0000-4000-8000-000000000001';
const STUDENT_ID = '00000000-0000-4000-8000-000000000099';

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

interface BuildOpts {
  /** Optional parent-binding: linked student ids returned for the acting parent. */
  linkedStudentIds?: string[];
  /** Shared repository so a test can seed data the routes read back. */
  repository?: InMemoryFeesRepository;
}

async function buildFeesApp(roles: unknown, opts: BuildOpts = {}): Promise<FastifyInstance> {
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
    repository: opts.repository ?? new InMemoryFeesRepository(),
    prefix: '/fees',
    ...(opts.linkedStudentIds
      ? {
          parentBinding: {
            listLinkedStudentIds: async () => opts.linkedStudentIds!,
          },
        }
      : {}),
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

  // PRC-C005: scope is derived from the caller's role, never a ?scope query param.
  describe('parent self-scope reads (PRC-C005)', () => {
    // A parent must be denied on every staff-only / tenant-wide read even with ?scope=parent.
    it.each([
      '/fees/payments?scope=parent',
      '/fees/reports/dues?scope=parent',
      '/fees/ledger/trial-balance?scope=parent',
      '/fees/reminders/overdue?scope=parent',
      '/fees/plans?scope=parent',
      '/fees/structures?scope=parent',
    ])('denies parent %s with 403 despite scope=parent', async (url) => {
      app = await buildFeesApp(['parent'], { linkedStudentIds: [STUDENT_ID] });
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('FORBIDDEN');
    });

    it('fails closed (403) on self-scopable reads when no parentBinding is configured', async () => {
      app = await buildFeesApp(['parent']); // no binding
      const invoices = await app.inject({ method: 'GET', url: '/fees/invoices?scope=parent' });
      expect(invoices.statusCode).toBe(403);
      const receipts = await app.inject({ method: 'GET', url: '/fees/receipts' });
      expect(receipts.statusCode).toBe(403);
    });

    it('scopes a linked parent to only their child invoices', async () => {
      const repository = new InMemoryFeesRepository();
      const service = new FeesService(repository);
      // Seed an invoice for the linked child and one for an unrelated student.
      const linkedInvoice = await service.createInvoice(TENANT_ID, 'staff', {
        studentId: STUDENT_ID,
        title: 'Linked child term fee',
        amountCents: 10000,
      });
      await service.createInvoice(TENANT_ID, 'staff', {
        studentId: uuid(), // some other student
        title: 'Other child term fee',
        amountCents: 20000,
      });

      app = await buildFeesApp(['parent'], {
        repository,
        linkedStudentIds: [STUDENT_ID],
      });

      const response = await app.inject({ method: 'GET', url: '/fees/invoices?scope=parent' });
      expect(response.statusCode).toBe(200);
      const ids = (response.json().data as Array<{ id: string }>).map((row) => row.id);
      expect(ids).toEqual([linkedInvoice.id]);
    });

    it('still allows a finance staff role to read tenant-wide (no scope param needed)', async () => {
      app = await buildFeesApp(['bursar']);
      const response = await app.inject({ method: 'GET', url: '/fees/payments' });
      expect(response.statusCode).toBe(200);
    });

    it('scopes a linked parent to only their child receipts and 404s a foreign receipt', async () => {
      const repository = new InMemoryFeesRepository();
      const service = new FeesService(repository);

      // Linked child: invoice + paid → receipt.
      const linkedInvoice = await service.createInvoice(TENANT_ID, 'staff', {
        studentId: STUDENT_ID,
        title: 'Linked child fee',
        amountCents: 5000,
      });
      const linkedPaid = await service.recordPayment(TENANT_ID, 'staff', {
        invoiceId: linkedInvoice.id,
      });

      // Unrelated child: invoice + paid → receipt the parent must NOT read.
      const otherInvoice = await service.createInvoice(TENANT_ID, 'staff', {
        studentId: uuid(),
        title: 'Other child fee',
        amountCents: 7000,
      });
      const otherPaid = await service.recordPayment(TENANT_ID, 'staff', {
        invoiceId: otherInvoice.id,
      });

      app = await buildFeesApp(['parent'], { repository, linkedStudentIds: [STUDENT_ID] });

      // List: only the linked child's receipt.
      const list = await app.inject({ method: 'GET', url: '/fees/receipts?scope=parent' });
      expect(list.statusCode).toBe(200);
      const listedIds = (list.json().data as Array<{ id: string }>).map((r) => r.id);
      expect(listedIds).toEqual([linkedPaid.receipt.id]);

      // Own receipt: 200.
      const own = await app.inject({
        method: 'GET',
        url: `/fees/receipts/${linkedPaid.receipt.id}`,
      });
      expect(own.statusCode).toBe(200);

      // Foreign receipt: 404 (not 403) so ids cannot be probed.
      const foreign = await app.inject({
        method: 'GET',
        url: `/fees/receipts/${otherPaid.receipt.id}`,
      });
      expect(foreign.statusCode).toBe(404);
    });

    it('denies a student role on staff-only reads and scopes their self reads', async () => {
      const repository = new InMemoryFeesRepository();
      const service = new FeesService(repository);
      const ownInvoice = await service.createInvoice(TENANT_ID, 'staff', {
        studentId: STUDENT_ID,
        title: 'My fee',
        amountCents: 3000,
      });
      app = await buildFeesApp(['student'], { repository, linkedStudentIds: [STUDENT_ID] });

      const trialBalance = await app.inject({
        method: 'GET',
        url: '/fees/ledger/trial-balance?scope=parent',
      });
      expect(trialBalance.statusCode).toBe(403);

      const invoices = await app.inject({ method: 'GET', url: '/fees/invoices?scope=parent' });
      expect(invoices.statusCode).toBe(200);
      const ids = (invoices.json().data as Array<{ id: string }>).map((r) => r.id);
      expect(ids).toEqual([ownInvoice.id]);
    });

    it('allows a self-scope caller to read structure instalments (structure-level, not PII)', async () => {
      app = await buildFeesApp(['parent'], { linkedStudentIds: [STUDENT_ID] });
      const response = await app.inject({
        method: 'GET',
        url: `/fees/structures/${uuid()}/instalments`,
      });
      // Not 403: self-scope may read schedule data (empty list for an unknown structure).
      expect(response.statusCode).not.toBe(403);
    });
  });
});
