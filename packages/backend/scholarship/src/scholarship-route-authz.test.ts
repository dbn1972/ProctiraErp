/**
 * W1-SEC-02 residual — scholarship route-level authorization deny proofs.
 */
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InMemoryScholarshipRepository } from './in-memory-repository.js';
import { scholarshipPlugin } from './scholarship-plugin.js';

const TENANT_A = '00000000-0000-4000-8000-0000000000a1';
const TENANT_B = '00000000-0000-4000-8000-0000000000b2';

async function buildApp(roles: unknown, tenantId: string): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorateRequest('tenantId', '');
  app.addHook('onRequest', async (request) => {
    (request as { tenantId?: string; user?: { sub?: string; roles?: unknown } }).tenantId =
      tenantId;
    (request as { tenantId?: string; user?: { sub?: string; roles?: unknown } }).user = {
      sub: 'user-test',
      roles,
    };
  });
  await app.register(scholarshipPlugin, {
    repository: new InMemoryScholarshipRepository(),
    prefix: '/scholarships',
  });
  await app.ready();
  return app;
}

const programPayload = {
  name: 'Merit Scholarship',
  applicationStartDate: '2024-01-01',
  applicationEndDate: '2024-06-30',
  totalSlots: 10,
  amountPerRecipient: 1000,
  eligibility: {},
};

describe('scholarship-plugin RBAC deny proofs (W1-SEC-02 residual)', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  describe('forbidden staff mutations and reads', () => {
    beforeEach(async () => {
      app = await buildApp(['teacher'], TENANT_A);
    });

    it('returns 403 when teacher creates a program', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/scholarships/programs',
        payload: programPayload,
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('FORBIDDEN');
    });

    it('returns 403 when teacher lists programs', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/scholarships/programs',
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('FORBIDDEN');
    });

    it('returns 403 when teacher approves an application', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/scholarships/applications/00000000-0000-4000-8000-000000000099/approve',
        payload: {},
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('FORBIDDEN');
    });

    it('returns 403 when teacher creates a disbursement', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/scholarships/disbursements',
        payload: {
          applicationId: '00000000-0000-4000-8000-000000000099',
          amount: 500,
          scheduledDate: '2024-09-01',
        },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('FORBIDDEN');
    });

    it('returns 403 when roles are empty (fail closed)', async () => {
      await app.close();
      app = await buildApp([], TENANT_A);
      const response = await app.inject({
        method: 'GET',
        url: '/scholarships/reports/utilization',
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('FORBIDDEN');
    });
  });

  describe('allowed aid/finance staff', () => {
    beforeEach(async () => {
      app = await buildApp(['bursar'], TENANT_A);
    });

    it('allows bursar to create a program (not 403)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/scholarships/programs',
        payload: programPayload,
      });
      expect(response.statusCode).toBe(201);
    });

    it('allows bursar to list programs', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/scholarships/programs',
      });
      expect(response.statusCode).toBe(200);
    });
  });

  describe('cross-tenant deny', () => {
    it('does not leak programs across tenants for authorized bursar', async () => {
      const sharedRepo = new InMemoryScholarshipRepository();

      const appA = Fastify({ logger: false });
      appA.decorateRequest('tenantId', '');
      appA.addHook('onRequest', async (request) => {
        (request as { tenantId?: string; user?: { roles: string[] } }).tenantId = TENANT_A;
        (request as { tenantId?: string; user?: { roles: string[] } }).user = {
          roles: ['bursar'],
        };
      });
      await appA.register(scholarshipPlugin, { repository: sharedRepo });
      await appA.ready();

      const created = await appA.inject({
        method: 'POST',
        url: '/scholarships/programs',
        payload: programPayload,
      });
      expect(created.statusCode).toBe(201);
      const programId = created.json().id as string;

      const appB = Fastify({ logger: false });
      appB.decorateRequest('tenantId', '');
      appB.addHook('onRequest', async (request) => {
        (request as { tenantId?: string; user?: { roles: string[] } }).tenantId = TENANT_B;
        (request as { tenantId?: string; user?: { roles: string[] } }).user = {
          roles: ['bursar'],
        };
      });
      await appB.register(scholarshipPlugin, { repository: sharedRepo });
      await appB.ready();

      const foreignGet = await appB.inject({
        method: 'GET',
        url: `/scholarships/programs/${programId}`,
      });
      expect(foreignGet.statusCode).toBe(404);

      const foreignDelete = await appB.inject({
        method: 'DELETE',
        url: `/scholarships/programs/${programId}`,
      });
      expect(foreignDelete.statusCode).toBe(404);

      const stillThere = await appA.inject({
        method: 'GET',
        url: `/scholarships/programs/${programId}`,
      });
      expect(stillThere.statusCode).toBe(200);

      await appA.close();
      await appB.close();
    });
  });
});
