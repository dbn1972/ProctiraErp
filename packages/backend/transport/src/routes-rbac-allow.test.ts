/**
 * PRC-L592: RBAC allow-path over HTTP. Transport staff and admin roles can read
 * and write; teacher / parent principals are denied (403) on both.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { InMemoryTransportRepository } from './in-memory-repository.js';
import { transportPlugin } from './transport-plugin.js';

const TENANT = '550e8400-e29b-41d4-a716-446655440000';

const routePayload = {
  name: 'RBAC route',
  startLocation: 'Depot',
  endLocation: 'School',
  operatingDays: ['monday'],
};

describe('transport RBAC allow-path (PRC-L592)', () => {
  let app: FastifyInstance | undefined;

  async function appFor(roles: string[]) {
    const instance = Fastify();
    instance.decorateRequest('tenantId', '');
    instance.addHook('onRequest', async (request) => {
      const r = request as { tenantId?: string; user?: { sub: string; roles: string[] } };
      r.tenantId = TENANT;
      r.user = { sub: 'user-1', roles };
    });
    await instance.register(transportPlugin, { repository: new InMemoryTransportRepository() });
    await instance.ready();
    return instance;
  }

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it.each(['transport_officer', 'fleet_manager', 'principal', 'admin', 'registrar'])(
    '%s can list (200) and create (201) routes',
    async (role) => {
      app = await appFor([role]);
      const list = await app.inject({ method: 'GET', url: '/transport/routes' });
      expect(list.statusCode).toBe(200);
      const create = await app.inject({
        method: 'POST',
        url: '/transport/routes',
        payload: routePayload,
      });
      expect(create.statusCode).toBe(201);
    },
  );

  it.each(['teacher', 'parent'])('%s is denied (403) on read and write', async (role) => {
    app = await appFor([role]);
    const list = await app.inject({ method: 'GET', url: '/transport/routes' });
    expect(list.statusCode).toBe(403);
    const create = await app.inject({
      method: 'POST',
      url: '/transport/routes',
      payload: routePayload,
    });
    expect(create.statusCode).toBe(403);
  });
});
