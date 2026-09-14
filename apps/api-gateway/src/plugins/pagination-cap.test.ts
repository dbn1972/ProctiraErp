import { ErrorCode, PAGINATION_DEFAULTS } from '@proctira/common';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import paginationCapPlugin from './pagination-cap.js';

describe('paginationCapPlugin (W3-D1)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    await app.register(paginationCapPlugin);
    app.get('/items', async (request) => {
      const query = request.query as { page?: string; pageSize?: string };
      return {
        page: query.page ?? null,
        pageSize: query.pageSize ?? null,
      };
    });
    app.post('/items', async () => ({ ok: true }));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('allows list requests without pagination params', async () => {
    const response = await app.inject({ method: 'GET', url: '/items' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ page: null, pageSize: null });
  });

  it('accepts pageSize at the platform max', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/items?pageSize=${PAGINATION_DEFAULTS.MAX_PAGE_SIZE}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().pageSize).toBe(PAGINATION_DEFAULTS.MAX_PAGE_SIZE);
  });

  it('rejects unbounded pageSize above the platform max', async () => {
    const response = await app.inject({ method: 'GET', url: '/items?pageSize=9999' });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(body.errors?.some((e: { field: string }) => e.field === 'pageSize')).toBe(true);
  });

  it('rejects page less than 1', async () => {
    const response = await app.inject({ method: 'GET', url: '/items?page=0' });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe(ErrorCode.VALIDATION_ERROR);
  });

  it('does not apply to non-GET methods', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/items?pageSize=9999',
    });
    expect(response.statusCode).toBe(200);
  });
});
