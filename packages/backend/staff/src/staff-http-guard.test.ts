/**
 * PRC-L363: denied staff writes return `reply` from the async preHandler; the handler never
 * runs even when async onSend hooks are registered.
 */
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import {
  InMemoryCertificationRepository,
  InMemoryTrainingAttendanceRepository,
  InMemoryTrainingProgramRepository,
  InMemoryTrainingSessionRepository,
} from './in-memory-training-repository.js';
import { staffWritePreHandler } from './staff-http-guard.js';
import { registerTrainingRoutes } from './training-routes.js';
import { TrainingService } from './training-service.js';

const TENANT = '550e8400-e29b-41d4-a716-446655440000';

function withRoles(app: ReturnType<typeof Fastify>, roles: string[]) {
  app.decorateRequest('tenantId', '');
  app.decorateRequest('user', undefined);
  app.addHook('onRequest', async (request) => {
    const r = request as unknown as { tenantId: string; user: { roles: string[] } };
    r.tenantId = TENANT;
    r.user = { roles };
  });
}

describe('PRC-L363 staffWritePreHandler', () => {
  it('returns false and sends 403 for denied writes; true for reads', async () => {
    const app = Fastify();
    withRoles(app, ['teacher']);
    const results: boolean[] = [];
    app.addHook('preHandler', async (request, reply) => {
      const ok = staffWritePreHandler(request, reply, 'staff.hr.write');
      results.push(ok);
      if (!ok) return reply;
    });
    const handler = vi.fn(async () => ({ ok: true }));
    app.get('/x', handler);
    app.post('/x', handler);
    await app.ready();
    expect((await app.inject({ method: 'GET', url: '/x' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/x' })).statusCode).toBe(403);
    expect(results).toEqual([true, false]);
    expect(handler).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('denied training write with an async onSend hook never invokes the handler', async () => {
    const service = new TrainingService(
      new InMemoryTrainingProgramRepository(),
      new InMemoryTrainingSessionRepository(),
      new InMemoryTrainingAttendanceRepository(),
      new InMemoryCertificationRepository(),
    );
    const spy = vi.spyOn(service, 'createProgram');
    const app = Fastify();
    withRoles(app, ['teacher']);
    const onSend = vi.fn(async (_req: unknown, _reply: unknown, payload: unknown) => {
      await new Promise((r) => setTimeout(r, 5));
      return payload;
    });
    app.addHook('onSend', onSend);
    await registerTrainingRoutes(app, { trainingService: service });
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/staff/training/programs',
      payload: { name: 'X', startDate: '2026-01-01', endDate: '2026-02-01' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN');
    expect(spy).not.toHaveBeenCalled();
    expect(onSend).toHaveBeenCalledTimes(1);
    await app.close();
  });
});
