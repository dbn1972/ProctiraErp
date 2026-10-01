/**
 * W1-SEC-02 (D4) — staff domain route guards: negative authz proofs.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import { InMemoryStaffRepository } from './in-memory-repository.js';
import { registerStaffRoutes } from './routes.js';
import { StaffService } from './staff-service.js';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';

function validCreateBody() {
  return {
    firstName: 'Pat',
    lastName: 'Lee',
    dateOfBirth: '1985-06-15',
    identityNumber: `ID-${Date.now()}`,
    contactPhone: '+15550001111',
    position: 'Teacher',
  };
}

describe('W1-SEC-02 staff route guards', () => {
  let app: FastifyInstance;

  async function mountWithRoles(roles: unknown) {
    app = Fastify();
    const service = new StaffService(new InMemoryStaffRepository());
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as { tenantId: string; user?: { roles: unknown } }).tenantId = TENANT_ID;
      (request as { user?: { roles: unknown } }).user = { roles };
    });
    await registerStaffRoutes(app, { staffService: service });
    await app.ready();
  }

  beforeEach(async () => {
    await mountWithRoles(['teacher']);
  });

  it('returns 403 when teacher posts a new staff record', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/staff',
      payload: validCreateBody(),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
  });

  it('returns 403 when parent posts a new staff record', async () => {
    await app.close();
    await mountWithRoles(['parent']);

    const response = await app.inject({
      method: 'POST',
      url: '/staff',
      payload: validCreateBody(),
    });
    expect(response.statusCode).toBe(403);
  });

  it('allows hr_officer to create staff', async () => {
    await app.close();
    await mountWithRoles(['hr_officer']);

    const response = await app.inject({
      method: 'POST',
      url: '/staff',
      payload: validCreateBody(),
    });
    expect(response.statusCode).toBe(201);
  });
});

describe('PRC-L362 staff read guard and identity masking', () => {
  async function mount(roles: unknown, seed = true) {
    const app = Fastify();
    const service = new StaffService(new InMemoryStaffRepository());
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as { tenantId: string; user?: { roles: unknown } }).tenantId = TENANT_ID;
      (request as { user?: { roles: unknown } }).user = { roles };
    });
    await registerStaffRoutes(app, { staffService: service });
    await app.ready();
    let id = '';
    if (seed) {
      const created = await service.create(TENANT_ID, {
        ...validCreateBody(),
        identityNumber: 'NAT-123456789',
      });
      id = created.id;
    }
    return { app, id };
  }

  it.each([['teacher'], ['parent'], ['student']])(
    'GET /staff and /staff/:id with %s role -> 403',
    async (role) => {
      const { app, id } = await mount([role]);
      expect((await app.inject({ method: 'GET', url: '/staff' })).statusCode).toBe(403);
      expect((await app.inject({ method: 'GET', url: `/staff/${id}` })).statusCode).toBe(403);
      await app.close();
    },
  );

  it('GET /staff with no roles (missing user) -> 403', async () => {
    const { app } = await mount(undefined, false);
    expect((await app.inject({ method: 'GET', url: '/staff' })).statusCode).toBe(403);
    await app.close();
  });

  it('HR read returns the full identity number', async () => {
    const { app, id } = await mount(['hr_officer']);
    const res = await app.inject({ method: 'GET', url: `/staff/${id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().identityNumber).toBe('NAT-123456789');
    await app.close();
  });

  it('non-HR (finance) read masks identityNumber on list and get', async () => {
    const { app, id } = await mount(['bursar']);
    const one = await app.inject({ method: 'GET', url: `/staff/${id}` });
    expect(one.statusCode).toBe(200);
    expect(one.json().identityNumber).toBe('*********6789');
    const list = await app.inject({ method: 'GET', url: '/staff' });
    expect(list.statusCode).toBe(200);
    expect(list.json().data[0].identityNumber).toBe('*********6789');
    expect(JSON.stringify(list.json())).not.toContain('NAT-123456789');
    await app.close();
  });
});
