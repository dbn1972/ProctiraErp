/**
 * W1-SEC-02 residual — hostel route-level authorization deny proofs.
 */
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InMemoryHostelRepository } from './in-memory-repository.js';
import { hostelPlugin } from './hostel-plugin.js';

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
  await app.register(hostelPlugin, {
    repository: new InMemoryHostelRepository(),
    prefix: '/hostel',
  });
  await app.ready();
  return app;
}

describe('hostel-plugin RBAC deny proofs (W1-SEC-02 residual)', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  describe('forbidden staff mutations and reads', () => {
    beforeEach(async () => {
      app = await buildApp(['teacher'], TENANT_A);
    });

    it('returns 403 when teacher creates a hostel', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/hostel',
        payload: { name: 'North Hall', code: 'NH-01', capacity: 100 },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('FORBIDDEN');
    });

    it('returns 403 when teacher lists hostels', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/hostel',
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('FORBIDDEN');
    });

    it('returns 403 when teacher creates an assignment', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/hostel/assignments',
        payload: {
          studentId: '00000000-0000-4000-8000-000000000099',
          bedId: '00000000-0000-4000-8000-000000000088',
          startDate: '2024-09-01',
        },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('FORBIDDEN');
    });

    it('returns 403 when teacher lists fee structures', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/hostel/fee-structures',
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('FORBIDDEN');
    });

    it('returns 403 when teacher transitions a gate pass', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/hostel/gate-passes/00000000-0000-4000-8000-000000000077/approve',
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('FORBIDDEN');
    });

    it('returns 403 when roles are empty (fail closed)', async () => {
      await app.close();
      app = await buildApp([], TENANT_A);
      const response = await app.inject({
        method: 'GET',
        url: '/hostel/gate-passes',
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('FORBIDDEN');
    });
  });

  describe('allowed hostel staff', () => {
    beforeEach(async () => {
      app = await buildApp(['warden'], TENANT_A);
    });

    it('allows warden to create a hostel (not 403)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/hostel',
        payload: { name: 'South Hall', code: 'SH-01', capacity: 80 },
      });
      expect(response.statusCode).toBe(201);
    });

    it('allows warden to list hostels', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/hostel',
      });
      expect(response.statusCode).toBe(200);
    });
  });

  describe('cross-tenant deny', () => {
    it('does not leak hostels across tenants for authorized warden', async () => {
      const sharedRepo = new InMemoryHostelRepository();

      const appA = Fastify({ logger: false });
      appA.decorateRequest('tenantId', '');
      appA.addHook('onRequest', async (request) => {
        (request as { tenantId?: string; user?: { roles: string[] } }).tenantId = TENANT_A;
        (request as { tenantId?: string; user?: { roles: string[] } }).user = {
          roles: ['warden'],
        };
      });
      await appA.register(hostelPlugin, { repository: sharedRepo });
      await appA.ready();

      const created = await appA.inject({
        method: 'POST',
        url: '/hostel',
        payload: { name: 'Tenant A Hall', code: 'TA-01', capacity: 40 },
      });
      expect(created.statusCode).toBe(201);
      const hostelId = created.json().id as string;

      const appB = Fastify({ logger: false });
      appB.decorateRequest('tenantId', '');
      appB.addHook('onRequest', async (request) => {
        (request as { tenantId?: string; user?: { roles: string[] } }).tenantId = TENANT_B;
        (request as { tenantId?: string; user?: { roles: string[] } }).user = {
          roles: ['warden'],
        };
      });
      await appB.register(hostelPlugin, { repository: sharedRepo });
      await appB.ready();

      const foreignGet = await appB.inject({
        method: 'GET',
        url: `/hostel/${hostelId}`,
      });
      expect(foreignGet.statusCode).toBe(404);

      const stillThere = await appA.inject({
        method: 'GET',
        url: `/hostel/${hostelId}`,
      });
      expect(stillThere.statusCode).toBe(200);

      await appA.close();
      await appB.close();
    });
  });
});
