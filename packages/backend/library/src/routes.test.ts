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

  beforeEach(async () => {
    app = Fastify({ logger: false });
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as { tenantId: string }).tenantId = TENANT_ID;
    });

    await app.register(libraryPlugin, { repository: new InMemoryLibraryRepository() });
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
          dueAt: '2020-01-01T00:00:00.000Z',
        },
      });
      expect(checkoutRes.statusCode).toBe(201);
      const loan = checkoutRes.json();

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

  describe('GET /library/items', () => {
    it('should list catalog items', async () => {
      await app.inject({
        method: 'POST',
        url: '/library/items',
        payload: { title: 'History of Art' },
      });

      const response = await app.inject({ method: 'GET', url: '/library/items' });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toHaveLength(1);
    });
  });
});
