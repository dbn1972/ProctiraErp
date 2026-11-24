/**
 * PRC-L325: the request tenant context comes only from `request.tenantId`
 * (resolved by the gateway from the verified token or host), is read on each
 * access, and is entered for every route of the plugin, including the area
 * hierarchy when the academics sub-domains are not mounted.
 */
import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { InMemoryInstitutionRepository } from './in-memory-repository.js';
import { institutionPlugin } from './institution-plugin.js';
import { currentTenantId } from './tenant-context.js';

const VERIFIED = randomUUID();
const FROM_USER = randomUUID();
const RE_RESOLVED = randomUUID();

type Req = FastifyRequest & { tenantId?: string; user?: { tenantId?: string } };

async function buildApp(input: {
  academics: boolean;
  onRequest: (request: Req) => void;
  preHandler?: (request: Req) => void;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorateRequest('tenantId', '');
  app.addHook('onRequest', async (request) => input.onRequest(request as Req));
  await app.register(institutionPlugin, {
    repository: new InMemoryInstitutionRepository(),
    academics: input.academics,
  });
  // A route in the same scope as the plugin's hooks reports what a store sees.
  await app.register(
    fp(async (scope) => {
      if (input.preHandler) {
        const preHandler = input.preHandler;
        scope.addHook('preHandler', async (request) => preHandler(request as Req));
      }
      scope.get('/probe/tenant', async () => ({ tenantId: currentTenantId() ?? null }));
    }),
  );
  await app.ready();
  return app;
}

describe('institution tenant context (PRC-L325)', () => {
  let app: FastifyInstance | undefined;
  beforeAll(() => {
    vi.stubEnv('DATABASE_URL', '');
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('ignores request.user.tenantId when the gateway resolved no tenant', async () => {
    app = await buildApp({
      academics: true,
      onRequest: (request) => {
        request.tenantId = undefined;
        request.user = { tenantId: FROM_USER };
      },
    });
    const res = await app.inject({ method: 'GET', url: '/probe/tenant' });
    expect(res.json()).toEqual({ tenantId: null });
  });

  it('uses the resolved request.tenantId over a different user claim', async () => {
    app = await buildApp({
      academics: true,
      onRequest: (request) => {
        request.tenantId = VERIFIED;
        request.user = { tenantId: FROM_USER };
      },
    });
    const res = await app.inject({ method: 'GET', url: '/probe/tenant' });
    expect(res.json()).toEqual({ tenantId: VERIFIED });
  });

  it('sees a tenant re-resolved after onRequest', async () => {
    app = await buildApp({
      academics: true,
      onRequest: (request) => {
        request.tenantId = VERIFIED;
      },
      preHandler: (request) => {
        request.tenantId = RE_RESOLVED;
      },
    });
    const res = await app.inject({ method: 'GET', url: '/probe/tenant' });
    expect(res.json()).toEqual({ tenantId: RE_RESOLVED });
  });

  it('enters the context when academics are not mounted (area hierarchy only)', async () => {
    app = await buildApp({
      academics: false,
      onRequest: (request) => {
        request.tenantId = VERIFIED;
      },
    });
    const res = await app.inject({ method: 'GET', url: '/probe/tenant' });
    expect(res.json()).toEqual({ tenantId: VERIFIED });
  });
});
