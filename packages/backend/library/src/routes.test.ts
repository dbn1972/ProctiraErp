/**
 * Library routes integration tests.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import { libraryPlugin } from './library-plugin.js';
import { InMemoryLibraryRepository } from './in-memory-repository.js';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';
const STUDENT_ID = '55555555-5555-4555-8555-555555555555';

describe('Library Routes', () => {
  let app: FastifyInstance;

  let repository: InMemoryLibraryRepository;
  beforeEach(async () => {
    app = Fastify({ logger: false });
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as { tenantId: string; user?: { roles: string[] } }).tenantId = TENANT_ID;
      // W1-SEC-02 package guards — staff principal for catalog/circulation writes.
      (request as { tenantId: string; user?: { roles: string[] } }).user = {
        roles: ['librarian'],
      };
    });

    repository = new InMemoryLibraryRepository();
    await app.register(libraryPlugin, { repository });
    await app.ready();
  });

  describe('POST /library/items', () => {
    it('should create a library item', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/library/items',
        payload: {
          title: 'Introduction to Algorithms',
          author: 'Cormen et al.',
          copies: 3,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.title).toBe('Introduction to Algorithms');
      expect(body.available).toBe(3);
    });
  });

  describe('POST /library/circulation/checkout', () => {
    it('rejects a past due date with 400 (PRC-M104)', async () => {
      const itemRes = await app.inject({
        method: 'POST',
        url: '/library/items',
        payload: { title: 'Past due', copies: 1 },
      });
      const res = await app.inject({
        method: 'POST',
        url: '/library/circulation/checkout',
        payload: {
          itemId: itemRes.json().id,
          studentId: STUDENT_ID,
          dueAt: '2020-01-01T00:00:00.000Z',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toBe('Due date cannot be in the past');
    });
    it('should checkout and return a book', async () => {
      const itemRes = await app.inject({
        method: 'POST',
        url: '/library/items',
        payload: { title: 'Physics 101', copies: 1 },
      });
      const item = itemRes.json();

      const checkoutRes = await app.inject({
        method: 'POST',
        url: '/library/circulation/checkout',
        payload: {
          itemId: item.id,
          studentId: STUDENT_ID,
          dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        },
      });
      expect(checkoutRes.statusCode).toBe(201);
      const loan = checkoutRes.json();
      // PRC-M104: checkout refuses past due dates; backdate the stored loan.
      await repository.updateLoan(loan.id, TENANT_ID, { dueAt: new Date('2020-01-01T00:00:00Z') });
      const overduesRes = await app.inject({ method: 'GET', url: '/library/overdues' });
      expect(overduesRes.statusCode).toBe(200);
      expect(overduesRes.json().data.length).toBeGreaterThanOrEqual(1);

      const returnRes = await app.inject({
        method: 'POST',
        url: '/library/circulation/return',
        payload: { loanId: loan.id },
      });
      expect(returnRes.statusCode).toBe(200);
      expect(returnRes.json().status).toBe('returned');
    });
  });

  describe('POST /library/circulation/renew', () => {
    it('should extend due date for an open loan', async () => {
      const itemRes = await app.inject({
        method: 'POST',
        url: '/library/items',
        payload: { title: 'Renewable Book', copies: 1 },
      });
      const checkoutRes = await app.inject({
        method: 'POST',
        url: '/library/circulation/checkout',
        payload: {
          itemId: itemRes.json().id,
          studentId: STUDENT_ID,
          dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
      });
      const loan = checkoutRes.json();

      const renewRes = await app.inject({
        method: 'POST',
        url: '/library/circulation/renew',
        payload: { loanId: loan.id, extendDays: 7 },
      });
      expect(renewRes.statusCode).toBe(200);
      expect(renewRes.json().status).toBe('checked_out');
      expect(new Date(renewRes.json().dueAt).getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('GET /library/patrons/:studentId/clearance', () => {
    it('should report not clear while loans are open', async () => {
      const itemRes = await app.inject({
        method: 'POST',
        url: '/library/items',
        payload: { title: 'Clearance Book', copies: 1 },
      });
      await app.inject({
        method: 'POST',
        url: '/library/circulation/checkout',
        payload: { itemId: itemRes.json().id, studentId: STUDENT_ID },
      });

      const blocked = await app.inject({
        method: 'GET',
        url: `/library/patrons/${STUDENT_ID}/clearance`,
      });
      expect(blocked.statusCode).toBe(200);
      expect(blocked.json().clear).toBe(false);
      expect(blocked.json().openLoanCount).toBe(1);
    });

    it('should report clear when no open loans', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/library/patrons/${STUDENT_ID}/clearance`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().clear).toBe(true);
      expect(response.json().openLoanCount).toBe(0);
    });
  });

  describe('G-916 OPAC, holds, barcode, fines', () => {
    it('searches OPAC and looks up a copy by barcode', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/library/items',
        payload: { title: 'OPAC Physics', author: 'Feynman', copies: 1 },
      });
      expect(created.statusCode).toBe(201);
      const item = created.json();

      const opac = await app.inject({ method: 'GET', url: '/library/opac/search?q=Physics' });
      expect(opac.statusCode).toBe(200);
      expect(opac.json().data.some((row: { title: string }) => row.title.includes('Physics'))).toBe(
        true,
      );

      const copies = (await app.inject({ method: 'GET', url: `/library/items/${item.id}` })).json()
        .copyList as Array<{ barcode: string }>;
      expect(copies.length).toBe(1);

      const lookup = await app.inject({
        method: 'GET',
        url: `/library/copies/by-barcode?barcode=${encodeURIComponent(copies[0]!.barcode)}`,
      });
      expect(lookup.statusCode).toBe(200);
      expect(lookup.json().copy.itemId).toBe(item.id);
    });

    it('imports a title from the stub ISBN provider', async () => {
      const imported = await app.inject({
        method: 'POST',
        url: '/library/items/import-isbn',
        payload: { isbn: '9780134685991', copies: 1 },
      });
      expect(imported.statusCode).toBe(201);
      expect(imported.json().title).toBe('Introduction to Algorithms');
    });
  });
});

// PRC-M294: list endpoints page in the repository and return `meta`.
describe('Library list paging (PRC-M294)', () => {
  const TENANT_B = '660e8400-e29b-41d4-a716-446655440001';
  const STUDENT_B = '77777777-7777-4777-8777-777777777777';
  const DAY = 24 * 60 * 60 * 1000;
  let app: FastifyInstance;
  let repository: InMemoryLibraryRepository;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    app.decorateRequest('tenantId', '');
    app.decorateRequest('user', null);
    app.addHook('onRequest', async (request) => {
      const tenant = request.headers['x-test-tenant'];
      const sub = request.headers['x-test-student'];
      (request as { tenantId: string }).tenantId = typeof tenant === 'string' ? tenant : TENANT_ID;
      (request as { user: unknown }).user =
        typeof sub === 'string'
          ? { sub, roles: [{ roleId: 'student', roleName: 'Student' }] }
          : { sub: 'librarian-1', roles: ['librarian'] };
    });
    repository = new InMemoryLibraryRepository();
    await app.register(libraryPlugin, { repository });
    await app.ready();
  });

  async function seed() {
    const titles = ['Gamma', 'Alpha', 'Beta'];
    const items = [];
    for (const [i, title] of titles.entries()) {
      items.push(
        await repository.createItem({
          id: `00000000-0000-4000-8000-00000000000${i}`,
          tenantId: TENANT_ID,
          isbn: null,
          title,
          author: null,
          copies: 1,
          available: 0,
          barcode: null,
          accessionNo: null,
          publisher: null,
          publishedYear: null,
        }),
      );
    }
    const now = Date.now();
    const loanSpecs = [
      { student: STUDENT_ID, due: now - 3 * DAY, status: 'checked_out' as const },
      { student: STUDENT_ID, due: now - 2 * DAY, status: 'returned' as const },
      { student: STUDENT_B, due: now - 1 * DAY, status: 'checked_out' as const },
      { student: STUDENT_B, due: now + 5 * DAY, status: 'checked_out' as const },
    ];
    for (const [i, spec] of loanSpecs.entries()) {
      const loan = await repository.createLoan({
        id: `10000000-0000-4000-8000-00000000000${i}`,
        tenantId: TENANT_ID,
        itemId: items[i % items.length]!.id,
        copyId: null,
        barcode: null,
        patronUserId: i === 0 ? 'patron-x' : null,
        studentId: spec.student,
        checkoutAt: new Date(now - (10 - i) * DAY),
        dueAt: new Date(spec.due),
        returnedAt: spec.status === 'returned' ? new Date() : null,
        status: spec.status,
      });
      await repository.createFine({
        id: `20000000-0000-4000-8000-00000000000${i}`,
        tenantId: TENANT_ID,
        loanId: loan.id,
        studentId: spec.student,
        amountCents: 100,
        currency: 'INR',
        overdueDays: 1,
        status: 'open',
        invoiceId: null,
        paidAt: null,
      });
      await repository.createHold({
        id: `30000000-0000-4000-8000-00000000000${i}`,
        tenantId: TENANT_ID,
        itemId: items[0]!.id,
        copyId: null,
        patronUserId: null,
        studentId: spec.student,
        position: i + 1,
        status: 'queued',
        expiresAt: null,
      });
    }
    return items;
  }

  const get = (url: string, headers: Record<string, string> = {}) =>
    app.inject({ method: 'GET', url, headers });

  it('/items pages by title with meta', async () => {
    await seed();
    const first = await get('/library/items?pageSize=2');
    expect(first.statusCode).toBe(200);
    expect(first.json().data.map((i: { title: string }) => i.title)).toEqual(['Alpha', 'Beta']);
    expect(first.json().meta).toEqual({ page: 1, pageSize: 2, totalItems: 3, totalPages: 2 });
    const second = await get('/library/items?page=2&pageSize=2');
    expect(second.json().data.map((i: { title: string }) => i.title)).toEqual(['Gamma']);
    expect((await get('/library/items')).json().meta.pageSize).toBe(20);
  });

  it('/overdues returns only open loans past due, filtered in the repository', async () => {
    await seed();
    const res = await get('/library/overdues?pageSize=1');
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
    expect(res.json().meta.totalItems).toBe(2);
    const all = await get('/library/overdues');
    expect(
      all
        .json()
        .data.map((l: { id: string }) => l.id)
        .sort(),
    ).toEqual(['10000000-0000-4000-8000-000000000000', '10000000-0000-4000-8000-000000000002']);
  });

  it('/loans, /holds and /fines page with meta and keep studentId/patronUserId filters', async () => {
    await seed();
    const loans = await get('/library/loans?pageSize=3');
    expect(loans.json().data).toHaveLength(3);
    expect(loans.json().meta).toEqual({ page: 1, pageSize: 3, totalItems: 4, totalPages: 2 });
    // Newest checkout first.
    expect(loans.json().data[0].id).toBe('10000000-0000-4000-8000-000000000003');
    const byStudent = await get(`/library/loans?studentId=${STUDENT_B}`);
    expect(byStudent.json().meta.totalItems).toBe(2);
    const byPatron = await get('/library/loans?patronUserId=patron-x');
    expect(byPatron.json().data.map((l: { id: string }) => l.id)).toEqual([
      '10000000-0000-4000-8000-000000000000',
    ]);

    const holds = await get('/library/holds?pageSize=2');
    expect(holds.json().data).toHaveLength(2);
    expect(holds.json().meta.totalItems).toBe(4);
    const holdsB = await get(`/library/holds?studentId=${STUDENT_B}`);
    expect(holdsB.json().meta.totalItems).toBe(2);

    const fines = await get('/library/fines?pageSize=2&page=2');
    expect(fines.json().data).toHaveLength(2);
    expect(fines.json().meta).toEqual({ page: 2, pageSize: 2, totalItems: 4, totalPages: 2 });
    const finesB = await get(`/library/fines?studentId=${STUDENT_B}`);
    expect(finesB.json().meta.totalItems).toBe(2);
  });

  it('a student portal caller only pages their own loans, holds and fines', async () => {
    await seed();
    const asStudent = { 'x-test-student': STUDENT_ID };
    for (const url of ['/library/loans', '/library/holds', '/library/fines']) {
      const res = await get(`${url}?pageSize=100`, asStudent);
      expect(res.statusCode).toBe(200);
      expect(res.json().meta.totalItems).toBe(2);
      for (const row of res.json().data as { studentId: string }[]) {
        expect(row.studentId).toBe(STUDENT_ID);
      }
      expect((await get(`${url}?studentId=${STUDENT_B}`, asStudent)).statusCode).toBe(403);
    }
  });

  it.each([
    '/library/items',
    '/library/overdues',
    '/library/loans',
    '/library/holds',
    '/library/fines',
  ])('%s rejects pageSize=101 and pageSize=0 with 400', async (url) => {
    for (const size of [101, 0]) {
      const res = await get(`${url}?pageSize=${size}`);
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    }
  });

  it("tenant B never sees tenant A's rows", async () => {
    await seed();
    for (const url of [
      '/library/items',
      '/library/overdues',
      '/library/loans',
      '/library/holds',
      '/library/fines',
    ]) {
      const res = await get(url, { 'x-test-tenant': TENANT_B });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toEqual([]);
      expect(res.json().meta.totalItems).toBe(0);
    }
  });
});
