/**
 * PRC-L115: PHI write audit actor + payload.
 */
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import type { FastifyRequest } from 'fastify';
import { ForbiddenError } from '@proctira/common';
import { healthPlugin } from './health-plugin.js';
import { InMemoryHealthRepository } from './in-memory-repository.js';
import { phiAuditAfterValues, resolvePhiAuditActor } from './routes.js';

function fakeRequest(fields: {
  user?: { sub?: string; displayName?: string; email?: string };
  healthAccessContext?: { userId: string; roles: string[]; guardianOfStudentIds: string[] };
  body?: unknown;
}): FastifyRequest {
  return fields as unknown as FastifyRequest;
}

describe('PHI write audit actor (PRC-L115)', () => {
  it('rejects an empty actor instead of auditing as anonymous', () => {
    expect(() => resolvePhiAuditActor(fakeRequest({}))).toThrow(ForbiddenError);
    expect(() =>
      resolvePhiAuditActor(
        fakeRequest({
          user: { sub: '' },
          healthAccessContext: { userId: '', roles: ['health_admin'], guardianOfStudentIds: [] },
        }),
      ),
    ).toThrow(ForbiddenError);
  });

  it('prefers the gateway-verified sub and falls back past empty strings', () => {
    expect(
      resolvePhiAuditActor(
        fakeRequest({
          user: { sub: '' },
          healthAccessContext: { userId: 'u-1', roles: [], guardianOfStudentIds: [] },
        }),
      ),
    ).toEqual({ userId: 'u-1', userName: 'u-1' });
    expect(
      resolvePhiAuditActor(fakeRequest({ user: { sub: 'u-2', displayName: 'Nurse A' } })),
    ).toEqual({ userId: 'u-2', userName: 'Nurse A' });
  });

  it('records changed field names (not values) for UPDATE only', () => {
    const request = fakeRequest({ body: { height: 170, notes: 'private note' } });
    const opts = { path: '/api/v1/health/measurements', idField: 'measurementId' };
    const update = phiAuditAfterValues(request, opts, 'UPDATE', 'm-1');
    expect(update).toEqual({
      path: '/api/v1/health/measurements',
      measurementId: 'm-1',
      changedFields: ['height', 'notes'],
    });
    expect(JSON.stringify(update)).not.toContain('private note');
    expect(phiAuditAfterValues(request, opts, 'CREATE', 'm-1')).not.toHaveProperty('changedFields');
  });

  it('HTTP write without an actor returns 403', async () => {
    const app = Fastify();
    app.decorateRequest('tenantId', '');
    app.decorateRequest('healthAccessContext', undefined);
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = 'tenant-001';
      (request as unknown as { healthAccessContext: unknown }).healthAccessContext = {
        userId: '',
        roles: ['health_admin'],
        guardianOfStudentIds: [],
      };
    });
    await app.register(healthPlugin, { repository: new InMemoryHealthRepository() });
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/health/measurements',
      payload: {
        studentId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        date: '2024-03-15',
        height: 165,
      },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
