import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { InMemoryPrivacyRepository } from './in-memory-repository.js';
import { PrivacyService } from './privacy-service.js';
import { registerPrivacyRoutes } from './routes.js';

const TENANT = 'tenant-a';

async function buildApp() {
  const service = new PrivacyService(new InMemoryPrivacyRepository());
  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    (request as unknown as { tenantId: string }).tenantId = TENANT;
  });
  await registerPrivacyRoutes(app, { privacyService: service });
  return { app, service };
}

describe('privacy routes validation and bounds (PRC-L137)', () => {
  it.each([
    ['GET', '/privacy/erasure-requests/not-a-uuid'],
    ['POST', '/privacy/erasure-requests/1/transition'],
    ['POST', '/privacy/erasure-requests/abc/execute'],
    ['GET', '/privacy/correction-requests/xyz'],
    ['POST', '/privacy/legal-holds/zzz/release'],
    ['GET', '/privacy/tenant-offboard/123'],
  ] as const)('%s %s with non-UUID id returns 400', async (method, url) => {
    const { app } = await buildApp();
    const res = await app.inject({ method, url, payload: method === 'POST' ? {} : undefined });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('valid but unknown UUID still returns 404', async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/privacy/erasure-requests/5a5a5a5a-0000-4000-8000-000000000001',
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('list endpoints return at most the requested page size and cap at 100', async () => {
    const { app, service } = await buildApp();
    for (let i = 0; i < 120; i += 1) {
      await service.createErasureRequest({
        tenantId: TENANT,
        subjectType: 'student',
        subjectId: `stu-${i}`,
        requestedBy: 'parent',
      });
    }
    const small = await app.inject({ method: 'GET', url: '/privacy/erasure-requests?limit=5' });
    expect(small.json().data).toHaveLength(5);
    const dflt = await app.inject({ method: 'GET', url: '/privacy/erasure-requests' });
    expect(dflt.json().data).toHaveLength(50);
    const capped = await app.inject({ method: 'GET', url: '/privacy/erasure-requests?limit=1000' });
    expect(capped.json().data).toHaveLength(100);
    const bad = await app.inject({ method: 'GET', url: '/privacy/erasure-requests?limit=-1' });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });
});

describe('correction fieldPath allow-pattern (PRC-M322)', () => {
  it.each(['a b', '$where', 'x;drop', '.lead', 'a..b'])('rejects fieldPath %s with 400', async (fp) => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/privacy/correction-requests',
      payload: { subjectType: 'student', subjectId: 'stu-1', fieldPath: fp, requestedValue: 'x' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
