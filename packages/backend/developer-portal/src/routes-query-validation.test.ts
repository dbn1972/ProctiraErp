/**
 * PRC-M220: list query strings and path params are validated with coercion before handlers.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { developerPortalPlugin } from './developer-portal-plugin.js';
import { InMemoryDeveloperPortalRepository } from './in-memory-repository.js';

describe('developer-portal list query validation (PRC-M220)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    app.addHook('onRequest', async (request) => {
      const sub = request.headers['x-test-sub'];
      (request as unknown as { user: unknown }).user = {
        sub: typeof sub === 'string' ? sub : 'user-1',
      };
      (request as unknown as { tenantId: string }).tenantId =
        '11111111-1111-4111-8111-111111111111';
    });
    await app.register(developerPortalPlugin, {
      repository: new InMemoryDeveloperPortalRepository(),
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it.each([
    ['pageSize=101', 'pageSize'],
    ['page=0', 'page'],
    ['page=-3', 'page'],
    ['page=1.5', 'page'],
    ['pageSize=abc', 'pageSize'],
  ])('marketplace ?%s -> 400', async (qs) => {
    const res = await app.inject({ method: 'GET', url: `/developer/marketplace?${qs}` });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('accepts valid paging and echoes integers', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/developer/marketplace?page=2&pageSize=5',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().meta).toMatchObject({ page: 2, pageSize: 5 });
  });

  it('rejects an unknown sort value', async () => {
    const res = await app.inject({ method: 'GET', url: '/developer/marketplace?sortBy=__proto__' });
    expect(res.statusCode).toBe(400);
  });

  it('/docs?published=true returns only published pages (boolean coercion)', async () => {
    const service = app.developerPortalService;
    await service.createDocPage({
      slug: 'live',
      title: 'Live',
      content: 'x',
      category: 'getting-started',
      published: true,
    });
    await service.createDocPage({
      slug: 'draft',
      title: 'Draft',
      content: 'x',
      category: 'getting-started',
      published: false,
    });
    const res = await app.inject({ method: 'GET', url: '/developer/docs?published=true' });
    expect(res.statusCode).toBe(200);
    expect((res.json().data as Array<{ slug: string }>).map((p) => p.slug)).toEqual(['live']);
    const drafts = await app.inject({ method: 'GET', url: '/developer/docs?published=false' });
    expect((drafts.json().data as Array<{ slug: string }>).map((p) => p.slug)).toEqual(['draft']);
    const bad = await app.inject({ method: 'GET', url: '/developer/docs?published=maybe' });
    expect(bad.statusCode).toBe(400);
  });

  it('bad UUID path params on deliveries -> 400 before any lookup', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/developer/accounts/not-a-uuid/webhooks/also-bad/deliveries',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('webhook and api-key lists reject out-of-range paging', async () => {
    const account = await app.developerPortalService.createAccount({
      name: 'Dev',
      email: 'dev-m220@example.com',
    });
    for (const path of ['webhooks', 'keys']) {
      const ok = await app.inject({
        method: 'GET',
        url: `/developer/accounts/${account.id}/${path}?page=1&pageSize=10`,
        headers: { 'x-test-sub': account.id },
      });
      expect(ok.statusCode).toBe(200);
      const res = await app.inject({
        method: 'GET',
        url: `/developer/accounts/${account.id}/${path}?pageSize=500`,
        headers: { 'x-test-sub': account.id },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    }
    const active = await app.inject({
      method: 'GET',
      url: `/developer/accounts/${account.id}/webhooks?active=true`,
      headers: { 'x-test-sub': account.id },
    });
    expect(active.statusCode).toBe(200);
  });
});
