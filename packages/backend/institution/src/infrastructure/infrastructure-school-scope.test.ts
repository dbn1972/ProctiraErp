/**
 * PRC-H004: `/infrastructure/:id` addresses an item only by id, so the gateway school-scope hook
 * cannot see its owner. The route preHandler loads the item and 404s a school-bound caller of
 * another school (prefix-aware: mounted under `/api/v1` like the gateway).
 */
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryConditionOptionStore, InMemoryInfrastructureStore } from './in-memory-store.js';
import { registerInfrastructureRoutes } from './routes.js';
import { InfrastructureService } from './service.js';

const SCHOOL_A = '12345678-1234-4234-8234-123456789abc';
const SCHOOL_B = '87654321-4321-4321-8321-cba987654321';

describe('PRC-H004 infrastructure /:id school scope', () => {
  let app: FastifyInstance;
  let caller: Record<string, unknown> | undefined;
  let landId: string;

  beforeEach(async () => {
    caller = undefined;
    app = Fastify({ logger: false });
    app.addHook('onRequest', async (request) => {
      (request as FastifyRequest & { user?: unknown }).user = caller;
    });
    const service = new InfrastructureService({
      store: new InMemoryInfrastructureStore(),
      conditionStore: new InMemoryConditionOptionStore(),
    });
    await app.register(
      async (scope) => {
        await registerInfrastructureRoutes(scope, { infrastructureService: service });
      },
      { prefix: '/api/v1' },
    );
    await app.ready();
    const land = await app.inject({
      method: 'POST',
      url: '/api/v1/infrastructure/lands',
      payload: { name: 'Campus A', institutionId: SCHOOL_A, capacity: 10, condition: 'Good' },
    });
    expect(land.statusCode).toBe(201);
    landId = (land.json() as { id: string }).id;
  });

  afterEach(async () => {
    await app.close();
  });

  const schoolB = () => ({
    sub: 'p-b',
    roles: [{ roleId: 'principal' }],
    institutions: [SCHOOL_B],
  });

  it('GET/PUT/DELETE by a principal of another school → 404 even when naming the owner', async () => {
    caller = schoolB();
    const get = await app.inject({ method: 'GET', url: `/api/v1/infrastructure/${landId}` });
    expect(get.statusCode).toBe(404);
    const put = await app.inject({
      method: 'PUT',
      url: `/api/v1/infrastructure/${landId}?institutionId=${SCHOOL_A}`,
      payload: { name: 'Hijacked' },
    });
    expect(put.statusCode).toBe(404);
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/infrastructure/${landId}?institutionId=${SCHOOL_A}`,
    });
    expect(del.statusCode).toBe(404);
    caller = undefined;
    const intact = await app.inject({ method: 'GET', url: `/api/v1/infrastructure/${landId}` });
    expect(intact.json()).toMatchObject({ name: 'Campus A' });
  });

  it('the owning school principal and a board admin are allowed', async () => {
    caller = { sub: 'p-a', roles: ['principal'], institutions: [SCHOOL_A] };
    const own = await app.inject({ method: 'GET', url: `/api/v1/infrastructure/${landId}` });
    expect(own.statusCode).toBe(200);
    caller = { sub: 'b', roles: ['board_admin'], institutions: [SCHOOL_B] };
    const board = await app.inject({ method: 'GET', url: `/api/v1/infrastructure/${landId}` });
    expect(board.statusCode).toBe(200);
  });
});
