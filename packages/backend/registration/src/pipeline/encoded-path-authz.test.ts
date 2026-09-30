/**
 * The admissions CRM hook only acts on paths under /admissions. It used to test the raw
 * request.url, but Fastify routes on the percent-decoded path — so `/%61dmissions/enquiries`
 * reached the admissions handlers while the hook decided the path was not admissions and skipped
 * the staff check entirely. It now classifies by the matched route pattern.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryRegistrationRepository } from '../in-memory-repository.js';

import { AdmissionsPipelineService } from './pipeline-service.js';
import { InMemoryAdmissionsPipelineStore } from './pipeline-store.js';
import { registerAdmissionsPipelineRoutes } from './routes.js';

const TENANT = '11111111-1111-4111-8111-111111111111';

describe('admissions CRM guard vs percent-encoded paths', () => {
  let app: FastifyInstance;
  let roles: string[] = [];

  beforeEach(async () => {
    roles = [];
    const service = new AdmissionsPipelineService(
      new InMemoryAdmissionsPipelineStore(),
      new InMemoryRegistrationRepository(),
    );
    app = Fastify();
    app.decorateRequest('tenantId', '');
    app.decorateRequest('user', null);
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = TENANT;
      (request as unknown as { user: { sub: string; roles: string[] } }).user = {
        sub: 'user-1',
        roles,
      };
    });
    await app.register(
      async (scope) => {
        await registerAdmissionsPipelineRoutes(scope, { service });
      },
      { prefix: '/api/v1' },
    );
    await app.ready();
  });

  for (const url of ['/api/v1/admissions/enquiries', '/api/v1/%61dmissions/enquiries']) {
    it(`denies a parent listing enquiries via ${url}`, async () => {
      roles = ['parent'];
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(403);
    });
  }

  it('still allows an admissions officer', async () => {
    roles = ['admissions_officer'];
    const res = await app.inject({ method: 'GET', url: '/api/v1/admissions/enquiries' });
    expect(res.statusCode).toBe(200);
  });
});
