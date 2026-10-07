/**
 * PRC-M490: transition actor is the JWT subject, assignee rules are enforced,
 * and approvals are deduplicated per actor.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryWorkflowRepository } from './in-memory-repository.js';
import { workflowPlugin } from './workflow-plugin.js';
const TENANT_ID = 'tenant-001';
const definition = {
  name: 'Leave',
  entityType: 'leave_request',
  states: [
    { id: 'draft', name: 'Draft', type: 'INITIAL', assigneeType: 'role', assigneeId: 'teacher' },
    {
      id: 'review',
      name: 'Review',
      type: 'INTERMEDIATE',
      assigneeType: 'role',
      assigneeId: 'principal',
    },
    { id: 'done', name: 'Done', type: 'FINAL', assigneeType: 'role', assigneeId: 'principal' },
  ],
  transitions: [
    { id: 't1', fromStateId: 'draft', toStateId: 'review', action: 'submit' },
    { id: 't2', fromStateId: 'review', toStateId: 'done', action: 'approve', requiredApprovals: 2 },
  ],
};
let app: FastifyInstance;
beforeEach(async () => {
  app = Fastify();
  app.addHook('onRequest', async (request) => {
    (request as typeof request & { tenantId: string }).tenantId = TENANT_ID;
    const sub = request.headers['x-test-user'] as string | undefined;
    if (sub) {
      // Production shape: the gateway JwtPayload carries RoleAssignment objects.
      // `x-test-role-shape: string` keeps coverage of legacy string-role tokens.
      const ids = String(request.headers['x-test-roles'] ?? '').split(',');
      const roles =
        request.headers['x-test-role-shape'] === 'string'
          ? ids
          : ids.map((roleId) => ({
              roleId,
              roleName: String(request.headers['x-test-role-name'] ?? roleId.toUpperCase()),
              areaId: 'area-1',
            }));
      (request as typeof request & { user: unknown }).user = { sub, roles };
    }
  });
  await app.register(workflowPlugin, { repository: new InMemoryWorkflowRepository() });
  await app.ready();
});
const as = (user: string, roles: string) => ({ 'x-test-user': user, 'x-test-roles': roles });
async function startInstance(): Promise<string> {
  const def = (
    await app.inject({
      method: 'POST',
      url: '/workflows',
      payload: definition,
      headers: as('admin-1', 'admin'),
    })
  ).json();
  const inst = await app.inject({
    method: 'POST',
    url: '/workflows/instances',
    payload: { workflowDefinitionId: def.id, entityType: 'leave_request', entityId: 'lr-1' },
    headers: as('admin-1', 'admin'),
  });
  return inst.json().id as string;
}
function transition(id: string, action: string, headers: Record<string, string>, body = {}) {
  return app.inject({
    method: 'POST',
    url: `/workflows/instances/${id}/transition`,
    payload: { action, ...body },
    headers,
  });
}
describe('workflow transition actor (PRC-M490)', () => {
  it('rejects unauthenticated callers with 401', async () => {
    const id = await startInstance();
    const res = await transition(id, 'submit', {}, { actorId: 'someone' });
    expect(res.statusCode).toBe(401);
  });
  it('returns 403 for a user not assigned to the current state', async () => {
    const id = await startInstance();
    const res = await transition(id, 'submit', as('parent-1', 'parent'));
    expect(res.statusCode).toBe(403);
  });
  it('records the JWT subject as actor even if the body claims another id', async () => {
    const id = await startInstance();
    const res = await transition(id, 'submit', as('teacher-1', 'teacher'), {
      actorId: 'principal-9',
    });
    expect(res.statusCode).toBe(200);
    const audit = (
      await app.inject({
        method: 'GET',
        url: `/workflows/instances/${id}/audit`,
        headers: as('teacher-1', 'teacher'),
      })
    ).json();
    expect(audit.data[0].actorId).toBe('teacher-1');
  });
  it('JWT RoleAssignment objects: matching roleId transitions (200), others 403', async () => {
    const id = await startInstance();
    // Non-matching RoleAssignment (roleId 'parent') is forbidden on a teacher-assigned state.
    expect((await transition(id, 'submit', as('parent-1', 'parent'))).statusCode).toBe(403);
    // Matching RoleAssignment { roleId: 'teacher', roleName: 'TEACHER' } is allowed.
    const ok = await transition(id, 'submit', as('teacher-1', 'teacher'));
    expect(ok.statusCode).toBe(200);
    expect(ok.json().currentStateId).toBe('review');
  });
  it('matches on roleId only: a custom role *named* like the assignee is 403', async () => {
    const id = await startInstance();
    const res = await transition(id, 'submit', {
      ...as('mallory', 'custom-role-1'),
      'x-test-role-name': 'teacher',
    });
    expect(res.statusCode).toBe(403);
  });
  it('still accepts legacy string roles in the token', async () => {
    const id = await startInstance();
    const res = await transition(id, 'submit', {
      ...as('teacher-1', 'teacher'),
      'x-test-role-shape': 'string',
    });
    expect(res.statusCode).toBe(200);
  });
  it('PRC-H109: user-assigned state — user B (not the assignee) gets 403, user A succeeds', async () => {
    const def = (
      await app.inject({
        method: 'POST',
        url: '/workflows',
        headers: as('admin-1', 'admin'),
        payload: {
          ...definition,
          states: [
            {
              id: 'draft',
              name: 'Draft',
              type: 'INITIAL',
              assigneeType: 'user',
              assigneeId: 'u-a',
            },
            { id: 'done', name: 'Done', type: 'FINAL', assigneeType: 'user', assigneeId: 'u-a' },
          ],
          transitions: [{ id: 't1', fromStateId: 'draft', toStateId: 'done', action: 'submit' }],
        },
      })
    ).json();
    const id = (
      await app.inject({
        method: 'POST',
        url: '/workflows/instances',
        headers: as('admin-1', 'admin'),
        payload: { workflowDefinitionId: def.id, entityType: 'leave_request', entityId: 'lr-2' },
      })
    ).json().id as string;
    // B holds the same role as A and claims A's id in the body: still 403.
    const denied = await transition(id, 'submit', as('u-b', 'teacher'), { actorId: 'u-a' });
    expect(denied.statusCode).toBe(403);
    const ok = await transition(id, 'submit', as('u-a', 'teacher'));
    expect(ok.statusCode).toBe(200);
    expect(ok.json().currentStateId).toBe('done');
  });
  it('two approvals by the same user do not satisfy requiredApprovals=2', async () => {
    const id = await startInstance();
    await transition(id, 'submit', as('teacher-1', 'teacher'));
    const first = await transition(id, 'approve', as('principal-1', 'principal'));
    expect(first.json().currentStateId).toBe('review');
    const again = await transition(id, 'approve', as('principal-1', 'principal'));
    expect(again.statusCode).toBe(409);
    const second = await transition(id, 'approve', as('principal-2', 'principal'));
    expect(second.statusCode).toBe(200);
    expect(second.json().currentStateId).toBe('done');
  });
});
