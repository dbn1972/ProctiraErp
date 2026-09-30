/**
 * PRC-C008 — the staff-facing fee routes mounted under the parent-portal plugin must reject
 * guardians/students (the plugin's normal audience) and only serve finance/admin staff. A
 * guardian must not read tenant-wide invoices/payments/receipts (directly or via ?scope=staff),
 * create/void invoices or fee plans, or read a receipt for a child they are not linked to.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InMemoryParentPortalRepository } from './in-memory-repository.js';
import { parentPortalPlugin } from './parent-portal-plugin.js';

const TENANT_A = '00000000-0000-4000-8000-000000000001';
const PARENT_USER = '00000000-0000-4000-8000-000000000021';

interface Principal {
  sub: string;
  email?: string;
  roles: Array<{ roleId: string; roleName: string; areaId: string | null }>;
}

function createApp(repository: InMemoryParentPortalRepository): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorateRequest('tenantId', '');
  app.decorateRequest('user', null as unknown as Principal);
  app.addHook('onRequest', async (request) => {
    (request as unknown as { tenantId: string }).tenantId = TENANT_A;
    const principal = request.headers['x-test-principal'];
    (request as unknown as { user: Principal | null }).user =
      typeof principal === 'string' ? (JSON.parse(principal) as Principal) : null;
  });
  return app;
}

function as(principal: Principal) {
  return { 'x-test-principal': JSON.stringify(principal) };
}

const parent: Principal = {
  sub: PARENT_USER,
  email: 'parent@tenant.test',
  roles: [{ roleId: 'parent', roleName: 'Parent', areaId: null }],
};

const student: Principal = {
  sub: '00000000-0000-4000-8000-0000000000cc',
  roles: [{ roleId: 'student', roleName: 'Student', areaId: null }],
};

const bursar: Principal = {
  sub: '00000000-0000-4000-8000-0000000000dd',
  roles: [{ roleId: 'bursar', roleName: 'Bursar', areaId: null }],
};

describe('PRC-C008 parent-portal staff fee routes', () => {
  let app: FastifyInstance;
  let repository: InMemoryParentPortalRepository;

  beforeEach(async () => {
    repository = new InMemoryParentPortalRepository();
    app = createApp(repository);
    await app.register(parentPortalPlugin, { repository });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  const STAFF_GETS = [
    '/parent-portal/fees/plans',
    '/parent-portal/fees/payments',
    '/parent-portal/fees/invoices?scope=staff',
    '/parent-portal/fees/receipts?scope=staff',
  ];

  it('denies a guardian on staff GET routes (403 or self-scoped, never tenant-wide staff data)', async () => {
    // /plans and /payments are staff-only → 403 for a parent.
    for (const url of ['/parent-portal/fees/plans', '/parent-portal/fees/payments']) {
      const res = await app.inject({ method: 'GET', url, headers: as(parent) });
      expect(res.statusCode, `parent GET ${url}`).toBe(403);
    }
  });

  it('withholds tenant-wide data from a guardian using ?scope=staff, but a bursar sees it', async () => {
    // Seed a tenant-wide invoice + receipt for an unrelated student.
    const invoice = await repository.createInvoice({
      id: '00000000-0000-4000-8000-000000000501',
      tenantId: TENANT_A,
      studentId: '00000000-0000-4000-8000-000000000502',
      planId: null,
      title: 'Unrelated child fee',
      description: '',
      amountCents: 8000,
      currency: 'INR',
      status: 'open',
      dueAt: null,
      createdBy: 'staff',
    });
    const payment = await repository.createPayment({
      id: '00000000-0000-4000-8000-000000000503',
      invoiceId: invoice.id,
      tenantId: TENANT_A,
      payerUserId: 'staff',
      amountCents: 8000,
      method: 'sandbox',
      status: 'succeeded',
      paidAt: new Date(),
    });
    await repository.createReceipt({
      id: '00000000-0000-4000-8000-000000000504',
      tenantId: TENANT_A,
      paymentId: payment.id,
      invoiceId: invoice.id,
      receiptNumber: 'RCP-SCOPE-1',
      amountCents: 8000,
      currency: 'INR',
      issuedAt: new Date(),
    });

    // Guardian (no linked children) with ?scope=staff → self-scoped, excludes the tenant row.
    const parentInvoices = await app.inject({
      method: 'GET',
      url: '/parent-portal/fees/invoices?scope=staff',
      headers: as(parent),
    });
    expect(parentInvoices.statusCode).toBe(200);
    expect((parentInvoices.json().data as Array<{ id: string }>).map((r) => r.id)).not.toContain(
      invoice.id,
    );
    expect(parentInvoices.json().data).toEqual([]);

    const parentReceipts = await app.inject({
      method: 'GET',
      url: '/parent-portal/fees/receipts?scope=staff',
      headers: as(parent),
    });
    expect(parentReceipts.statusCode).toBe(200);
    expect(parentReceipts.json().data).toEqual([]);

    // Bursar with ?scope=staff → tenant-wide list includes the seeded invoice + receipt.
    const staffInvoices = await app.inject({
      method: 'GET',
      url: '/parent-portal/fees/invoices?scope=staff',
      headers: as(bursar),
    });
    expect(staffInvoices.statusCode).toBe(200);
    expect((staffInvoices.json().data as Array<{ id: string }>).map((r) => r.id)).toContain(
      invoice.id,
    );

    const staffReceipts = await app.inject({
      method: 'GET',
      url: '/parent-portal/fees/receipts?scope=staff',
      headers: as(bursar),
    });
    expect(staffReceipts.statusCode).toBe(200);
    expect(staffReceipts.json().data.length).toBeGreaterThan(0);
  });

  it('denies a student on staff-only routes', async () => {
    for (const url of ['/parent-portal/fees/plans', '/parent-portal/fees/payments']) {
      const res = await app.inject({ method: 'GET', url, headers: as(student) });
      expect(res.statusCode, `student GET ${url}`).toBe(403);
    }
  });

  it('denies a guardian on staff mutations (create plan, create invoice, void)', async () => {
    const createPlan = await app.inject({
      method: 'POST',
      url: '/parent-portal/fees/plans',
      headers: as(parent),
      payload: { code: 'TERM', name: 'Term fee', amountCents: 10000 },
    });
    expect(createPlan.statusCode).toBe(403);

    const createInvoice = await app.inject({
      method: 'POST',
      url: '/parent-portal/fees/invoices',
      headers: as(parent),
      payload: {
        studentId: '00000000-0000-4000-8000-000000000099',
        title: 'Lab',
        amountCents: 5000,
      },
    });
    expect(createInvoice.statusCode).toBe(403);

    const voidInvoice = await app.inject({
      method: 'POST',
      url: '/parent-portal/fees/invoices/00000000-0000-4000-8000-0000000000ee/void',
      headers: as(parent),
    });
    expect(voidInvoice.statusCode).toBe(403);
  });

  it('allows a bursar to use the staff routes', async () => {
    const plans = await app.inject({
      method: 'GET',
      url: '/parent-portal/fees/plans',
      headers: as(bursar),
    });
    expect(plans.statusCode).toBe(200);

    const payments = await app.inject({
      method: 'GET',
      url: '/parent-portal/fees/payments',
      headers: as(bursar),
    });
    expect(payments.statusCode).toBe(200);

    const createPlan = await app.inject({
      method: 'POST',
      url: '/parent-portal/fees/plans',
      headers: as(bursar),
      payload: { code: 'TERM', name: 'Term fee', amountCents: 10000 },
    });
    expect(createPlan.statusCode).toBe(201);
  });

  it('denies a guardian reading a receipt for a child they are not linked to (404, no probing)', async () => {
    // Seed a staff invoice + receipt for an unrelated student.
    const invoice = await repository.createInvoice({
      id: '00000000-0000-4000-8000-000000000401',
      tenantId: TENANT_A,
      studentId: '00000000-0000-4000-8000-000000000402',
      planId: null,
      title: 'Other child fee',
      description: '',
      amountCents: 5000,
      currency: 'INR',
      status: 'open',
      dueAt: null,
      createdBy: 'staff',
    });
    const payment = await repository.createPayment({
      id: '00000000-0000-4000-8000-000000000403',
      invoiceId: invoice.id,
      tenantId: TENANT_A,
      payerUserId: 'staff',
      amountCents: 5000,
      method: 'sandbox',
      status: 'succeeded',
      paidAt: new Date(),
    });
    const receipt = await repository.createReceipt({
      id: '00000000-0000-4000-8000-000000000404',
      tenantId: TENANT_A,
      paymentId: payment.id,
      invoiceId: invoice.id,
      receiptNumber: 'RCP-TEST-1',
      amountCents: 5000,
      currency: 'INR',
      issuedAt: new Date(),
    });

    const res = await app.inject({
      method: 'GET',
      url: `/parent-portal/fees/receipts/${receipt.id}`,
      headers: as(parent), // parent has no linked children
    });
    expect(res.statusCode).toBe(404);

    // A bursar may read any receipt by id (staff read, no ownership restriction).
    const staffRes = await app.inject({
      method: 'GET',
      url: `/parent-portal/fees/receipts/${receipt.id}`,
      headers: as(bursar),
    });
    expect(staffRes.statusCode).toBe(200);
    expect(staffRes.json().id).toBe(receipt.id);
  });
});
