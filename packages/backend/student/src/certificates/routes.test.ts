import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InMemoryLifecycleCertificateRepository } from './in-memory-repository.js';
import { LifecycleCertificateService } from './lifecycle-certificate-service.js';
import { registerLifecycleCertificateRoutes } from './routes.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const STUDENT = '22222222-2222-4222-8222-222222222222';

async function buildApp(onRequest?: (request: FastifyRequest) => void | Promise<void>) {
  const app = Fastify({ logger: false });
  if (onRequest) {
    app.addHook('onRequest', async (request) => {
      await onRequest(request);
    });
  }
  await registerLifecycleCertificateRoutes(app, {
    service: new LifecycleCertificateService(new InMemoryLifecycleCertificateRepository()),
    prefix: '/students',
  });
  await app.ready();
  return app;
}

describe('certificates routes SEC-2 tenant resolution', () => {
  let app: FastifyInstance;
  const ORIGINAL_FLAG = process.env['TRUST_X_TENANT_ID_HEADER'];

  afterEach(async () => {
    await app.close();
    if (ORIGINAL_FLAG === undefined) {
      delete process.env['TRUST_X_TENANT_ID_HEADER'];
    } else {
      process.env['TRUST_X_TENANT_ID_HEADER'] = ORIGINAL_FLAG;
    }
  });

  it('rejects with 401 (not an empty-tenant pass-through) when no user.tenantId, no request.tenantId, and no header at all', async () => {
    delete process.env['TRUST_X_TENANT_ID_HEADER'];
    app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: `/students/${STUDENT}/certificates`,
      payload: { type: 'bonafide' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('rejects a request that only supplies x-tenant-id via header when the trust flag is unset (default OFF)', async () => {
    delete process.env['TRUST_X_TENANT_ID_HEADER'];
    app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: `/students/${STUDENT}/certificates`,
      headers: { 'x-tenant-id': TENANT },
      payload: { type: 'bonafide' },
    });

    // Must NOT resolve a tenant from the header by default and proceed (201);
    // it must fail the tenant-context check.
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('rejects the same header-only request even when the flag is explicitly disabled', async () => {
    process.env['TRUST_X_TENANT_ID_HEADER'] = '0';
    app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: `/students/${STUDENT}/certificates`,
      headers: { 'x-tenant-id': TENANT },
      payload: { type: 'bonafide' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('honors the header only when TRUST_X_TENANT_ID_HEADER=1 is explicitly set (non-default opt-in)', async () => {
    process.env['TRUST_X_TENANT_ID_HEADER'] = '1';
    app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: `/students/${STUDENT}/certificates`,
      headers: { 'x-tenant-id': TENANT },
      payload: { type: 'bonafide' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ tenantId: TENANT, studentId: STUDENT });
  });

  it('resolves from request.user.tenantId when set by a trusted hook (baseline sanity check, gateway-mounted shape)', async () => {
    delete process.env['TRUST_X_TENANT_ID_HEADER'];
    app = await buildApp((request) => {
      (request as FastifyRequest & { user: { tenantId: string; sub: string } }).user = {
        tenantId: TENANT,
        sub: 'actor-1',
      };
    });

    const response = await app.inject({
      method: 'POST',
      url: `/students/${STUDENT}/certificates`,
      payload: { type: 'bonafide' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ tenantId: TENANT, studentId: STUDENT });
  });

  it('resolves from request.tenantId when set by a trusted hook (baseline sanity check)', async () => {
    delete process.env['TRUST_X_TENANT_ID_HEADER'];
    app = await buildApp((request) => {
      (request as FastifyRequest & { tenantId?: string }).tenantId = TENANT;
    });

    const response = await app.inject({
      method: 'GET',
      url: `/students/${STUDENT}/certificates`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: [] });
  });

  it('does not let a header-supplied tenant override a verified request.user.tenantId', async () => {
    delete process.env['TRUST_X_TENANT_ID_HEADER'];
    const OTHER_TENANT = '33333333-3333-4333-8333-333333333333';
    app = await buildApp((request) => {
      (request as FastifyRequest & { user: { tenantId: string; sub: string } }).user = {
        tenantId: TENANT,
        sub: 'actor-1',
      };
    });

    const response = await app.inject({
      method: 'POST',
      url: `/students/${STUDENT}/certificates`,
      headers: { 'x-tenant-id': OTHER_TENANT },
      payload: { type: 'bonafide' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ tenantId: TENANT });
  });
});
