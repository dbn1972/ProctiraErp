/**
 * PRC-M324: HTTP-level contract for every privacy route — tenant required (401), body
 * validation (400), id validation (400), unknown / cross-tenant ids (404) and body `tenantId`
 * never overriding the authenticated tenant.
 */
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { InMemoryPrivacyRepository } from './in-memory-repository.js';
import { PrivacyService } from './privacy-service.js';
import { registerPrivacyRoutes } from './routes.js';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const UNKNOWN = '5a5a5a5a-0000-4000-8000-000000000001';

async function buildApp() {
  const repository = new InMemoryPrivacyRepository();
  const service = new PrivacyService(repository, {
    anonymizer: { anonymize: async () => ({ fieldsTouched: [] }) },
  });
  const app = Fastify();
  // Tenant comes from a header to simulate the gateway's authenticated tenant binding.
  app.addHook('onRequest', async (request) => {
    const tenant = request.headers['x-test-tenant'];
    if (typeof tenant === 'string') {
      (request as unknown as { tenantId: string }).tenantId = tenant;
    }
    (request as unknown as { user: { sub: string } }).user = { sub: 'dpo-1' };
  });
  await registerPrivacyRoutes(app, { privacyService: service });
  return { app, service, repository };
}

const ROUTES = [
  ['POST', '/privacy/legal-holds'],
  ['GET', '/privacy/legal-holds'],
  ['POST', `/privacy/legal-holds/${UNKNOWN}/release`],
  ['POST', '/privacy/erasure-requests'],
  ['GET', '/privacy/erasure-requests'],
  ['GET', `/privacy/erasure-requests/${UNKNOWN}`],
  ['POST', `/privacy/erasure-requests/${UNKNOWN}/transition`],
  ['POST', `/privacy/erasure-requests/${UNKNOWN}/execute`],
  ['POST', '/privacy/correction-requests'],
  ['GET', '/privacy/correction-requests'],
  ['GET', `/privacy/correction-requests/${UNKNOWN}`],
  ['POST', `/privacy/correction-requests/${UNKNOWN}/transition`],
  ['POST', `/privacy/correction-requests/${UNKNOWN}/apply`],
  ['POST', '/privacy/tenant-offboard'],
  ['GET', '/privacy/tenant-offboard'],
  ['GET', `/privacy/tenant-offboard/${UNKNOWN}`],
] as const;

describe('privacy routes HTTP contract (PRC-M324)', () => {
  it.each(ROUTES)('%s %s without tenant context returns 401', async (method, url) => {
    const { app } = await buildApp();
    const res = await app.inject({ method, url, payload: method === 'POST' ? {} : undefined });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it.each([
    ['/privacy/legal-holds', { scope: 'nope', reason: 'x' }],
    ['/privacy/erasure-requests', { subjectType: 'student' }],
    ['/privacy/correction-requests', { subjectType: 'student', subjectId: 's' }],
    ['/privacy/tenant-offboard', {}],
    [`/privacy/erasure-requests/${UNKNOWN}/transition`, { status: 'bogus' }],
    [`/privacy/correction-requests/${UNKNOWN}/transition`, { status: 'bogus' }],
  ])('POST %s with an invalid body returns 400', async (url, payload) => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url,
      headers: { 'x-test-tenant': TENANT_A },
      payload,
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it.each([
    ['POST', `/privacy/legal-holds/${UNKNOWN}/release`, undefined],
    ['GET', `/privacy/erasure-requests/${UNKNOWN}`, undefined],
    ['POST', `/privacy/erasure-requests/${UNKNOWN}/transition`, { status: 'under_review' }],
    ['POST', `/privacy/erasure-requests/${UNKNOWN}/execute`, undefined],
    ['GET', `/privacy/correction-requests/${UNKNOWN}`, undefined],
    ['POST', `/privacy/correction-requests/${UNKNOWN}/transition`, { status: 'under_review' }],
    ['POST', `/privacy/correction-requests/${UNKNOWN}/apply`, undefined],
    ['GET', `/privacy/tenant-offboard/${UNKNOWN}`, undefined],
  ] as const)('%s %s with an unknown id returns 404', async (method, url, payload) => {
    const { app } = await buildApp();
    const res = await app.inject({
      method,
      url,
      headers: { 'x-test-tenant': TENANT_A },
      payload: method === 'POST' ? (payload ?? {}) : undefined,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('cross-tenant ids return 404 on every by-id route', async () => {
    const { app, service } = await buildApp();
    const hold = await service.placeLegalHold({
      tenantId: TENANT_A,
      scope: 'subject',
      subjectType: 'student',
      subjectId: 'stu-held',
      reason: 'r',
      placedBy: 'dpo-1',
    });
    const er = await service.createErasureRequest({
      tenantId: TENANT_A,
      subjectType: 'student',
      subjectId: 'stu-1',
      requestedBy: 'dpo-1',
    });
    const corr = await service.createCorrectionRequest({
      tenantId: TENANT_A,
      subjectType: 'student',
      subjectId: 'stu-1',
      fieldPath: 'email',
      requestedValue: 'v@example.com',
      requestedBy: 'dpo-1',
    });
    const asB = { 'x-test-tenant': TENANT_B };
    const calls: Array<[('GET' | 'POST'), string, unknown]> = [
      ['POST', `/privacy/legal-holds/${hold.id}/release`, {}],
      ['GET', `/privacy/erasure-requests/${er.id}`, undefined],
      ['POST', `/privacy/erasure-requests/${er.id}/transition`, { status: 'under_review' }],
      ['POST', `/privacy/erasure-requests/${er.id}/execute`, {}],
      ['GET', `/privacy/correction-requests/${corr.id}`, undefined],
      ['POST', `/privacy/correction-requests/${corr.id}/transition`, { status: 'under_review' }],
      ['POST', `/privacy/correction-requests/${corr.id}/apply`, {}],
    ];
    for (const [method, url, payload] of calls) {
      const res = await app.inject({
        method,
        url,
        headers: asB,
        payload: payload as Record<string, unknown> | undefined,
      });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
    // Lists are tenant-scoped too.
    const list = await app.inject({ method: 'GET', url: '/privacy/erasure-requests', headers: asB });
    expect(list.json().data).toHaveLength(0);
    // Tenant A state is untouched.
    expect((await service.getErasureRequest(er.id, TENANT_A))?.status).toBe('requested');
    expect((await service.listActiveLegalHolds(TENANT_A)).map((h) => h.id)).toContain(hold.id);
    await app.close();
  });

  it('body tenantId is ignored; the authenticated tenant is used', async () => {
    const { app, service } = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/privacy/erasure-requests',
      headers: { 'x-test-tenant': TENANT_A },
      payload: { subjectType: 'student', subjectId: 'stu-1', tenantId: TENANT_B },
    });
    expect(res.statusCode).toBe(201);
    const id = res.json().id as string;
    expect(res.json().tenantId).toBe(TENANT_A);
    expect(await service.getErasureRequest(id, TENANT_B)).toBeNull();
    expect(await service.getErasureRequest(id, TENANT_A)).not.toBeNull();
    expect(await service.listErasureRequests(TENANT_B)).toHaveLength(0);
    await app.close();
  });
});
