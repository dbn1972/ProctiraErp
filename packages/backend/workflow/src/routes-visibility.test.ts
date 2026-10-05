/**
 * PRC-M491: instance lists are scoped to the caller (mine, restricted entity
 * types, server-side priority filter with correct totals).
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryWorkflowRepository } from './in-memory-repository.js';
import { workflowPlugin } from './workflow-plugin.js';
const TENANT_ID = 'tenant-001';
const states = [
  { id: 'draft', name: 'Draft', type: 'INITIAL', assigneeType: 'role', assigneeId: 'principal' },
  { id: 'done', name: 'Done', type: 'FINAL', assigneeType: 'role', assigneeId: 'principal' },
];
const transitions = [{ id: 't1', fromStateId: 'draft', toStateId: 'done', action: 'approve' }];
let app: FastifyInstance;
const as = (user: string, roles: string) => ({ 'x-test-user': user, 'x-test-roles': roles });
async function def(entityType: string, assignee: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/workflows',
    headers: as('admin', 'admin'),
    payload: {
      name: entityType,
      entityType,
      states: states.map((s) => ({ ...s, assigneeId: assignee })),
      transitions,
    },
  });
  return res.json().id as string;
}
async function inst(defId: string, entityType: string, metadata?: Record<string, unknown>) {
  await app.inject({
    method: 'POST',
    url: '/workflows/instances',
    headers: as('admin', 'admin'),
    payload: { workflowDefinitionId: defId, entityType, entityId: `e-${Math.random()}`, metadata },
  });
}
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
  const leave = await def('staff_leave', 'principal');
  const transfer = await def('student_transfer', 'registrar');
  const counselling = await def('counselling_case', 'counsellor');
  await inst(leave, 'staff_leave', { priority: 'high' });
  await inst(leave, 'staff_leave');
  await inst(transfer, 'student_transfer', { priority: 'high' });
  await inst(counselling, 'counselling_case', { priority: 'high', notes: 'sensitive' });
});
const list = (qs: string, headers: Record<string, string>) =>
  app.inject({ method: 'GET', url: `/workflows/instances?status=ACTIVE&${qs}`, headers });
describe('workflow instance visibility (PRC-M491)', () => {
  it('401 without an authenticated caller', async () => {
    expect((await list('', {})).statusCode).toBe(401);
  });
  it('mine=true returns only instances whose current state is assigned to my role', async () => {
    const body = (await list('mine=true', as('p1', 'principal'))).json();
    expect(body.data.map((i: { entityType: string }) => i.entityType)).toEqual([
      'staff_leave',
      'staff_leave',
    ]);
    expect(body.meta.totalItems).toBe(2);
  });
  it('counselling cases are absent for non-authorised roles (and their detail is 404)', async () => {
    const body = (await list('', as('p1', 'principal'))).json();
    const types = body.data.map((i: { entityType: string }) => i.entityType);
    expect(types).not.toContain('counselling_case');
    expect(body.meta.totalItems).toBe(3);
    const counsellor = (await list('entityType=counselling_case', as('c1', 'counsellor'))).json();
    expect(counsellor.data).toHaveLength(1);
    // Sensitive metadata is masked to the whitelist.
    expect(counsellor.data[0].metadata).toEqual({ priority: 'high' });
    const detail = await app.inject({
      method: 'GET',
      url: `/workflows/instances/${counsellor.data[0].id}`,
      headers: as('p1', 'principal'),
    });
    expect(detail.statusCode).toBe(404);
  });
  it('restricted types are visible to the RoleAssignment roleId, not a look-alike roleName', async () => {
    const counsellor = (await list('', as('c1', 'counsellor'))).json();
    expect(counsellor.data.map((i: { entityType: string }) => i.entityType)).toContain(
      'counselling_case',
    );
    const spoof = (
      await list('', { ...as('m1', 'custom-role-1'), 'x-test-role-name': 'counsellor' })
    ).json();
    expect(spoof.data.map((i: { entityType: string }) => i.entityType)).not.toContain(
      'counselling_case',
    );
    const legacy = (
      await list('entityType=counselling_case', {
        ...as('c2', 'counsellor'),
        'x-test-role-shape': 'string',
      })
    ).json();
    expect(legacy.data).toHaveLength(1);
  });
  it('priority filter runs server-side so totals match the filtered rows', async () => {
    const body = (await list('priority=high&pageSize=1', as('p1', 'principal'))).json();
    expect(body.data).toHaveLength(1);
    expect(body.meta.totalItems).toBe(2);
    expect(body.meta.totalPages).toBe(2);
  });
});
