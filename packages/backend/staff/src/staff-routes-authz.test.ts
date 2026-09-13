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
