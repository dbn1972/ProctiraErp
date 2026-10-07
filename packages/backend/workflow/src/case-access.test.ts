/**
 * PRC-H111: case visibility is scoped by role, institution/area and assignee,
 * all derived from the verified principal (gateway JwtPayload shape).
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  canAccessCase,
  caseScopeFor,
  getCasePrincipal,
  type CasePrincipal,
} from './case-access.js';
import { InMemoryCaseRepository } from './in-memory-case-repository.js';
import { InMemoryWorkflowRepository } from './in-memory-repository.js';
import { caseScopeClause } from './pg-workflow-repository.js';
import { workflowPlugin } from './workflow-plugin.js';

const TENANT_ID = 'tenant-001';
const INST_A = '11111111-1111-4111-8111-111111111111';
const INST_B = '22222222-2222-4222-8222-222222222222';
const D1 = '33333333-3333-4333-8333-333333333333';
const D2 = '44444444-4444-4444-8444-444444444444';

interface TestUser {
  sub: string;
  roles: string[];
  institutions?: string[];
  areas?: string[];
  /** Display name override to prove roleName is never trusted. */
  roleName?: string;
}

let app: FastifyInstance;
let repo: InMemoryCaseRepository;

beforeEach(async () => {
  app = Fastify();
  app.addHook('onRequest', async (request) => {
    (request as typeof request & { tenantId: string }).tenantId = TENANT_ID;
    const raw = request.headers['x-test-user'];
    if (typeof raw === 'string') {
      const u = JSON.parse(raw) as TestUser;
      // Production shape: JwtPayload with RoleAssignment objects + institutions/areas.
      (request as typeof request & { user: unknown }).user = {
        sub: u.sub,
        tenantId: TENANT_ID,
        roles: u.roles.map((roleId) => ({
          roleId,
          roleName: u.roleName ?? roleId.toUpperCase(),
          areaId: 'country',
        })),
        institutions: u.institutions ?? [],
        areas: (u.areas ?? []).map((areaId) => ({ areaId, level: 2 })),
      };
    }
  });
  repo = new InMemoryCaseRepository();
  await app.register(workflowPlugin, {
    repository: new InMemoryWorkflowRepository(),
    caseRepository: repo,
  });
  await app.ready();
});

const as = (u: TestUser) => ({ 'x-test-user': JSON.stringify(u) });
const ADMIN: TestUser = { sub: 'admin-1', roles: ['admin'] };
const COUNSELLOR_A: TestUser = { sub: 'couns-a', roles: ['counsellor'], institutions: [INST_A] };
const PRINCIPAL_A: TestUser = { sub: 'prin-a', roles: ['principal'], institutions: [INST_A] };
const DISCIPLINE_A: TestUser = {
  sub: 'disc-a',
  roles: ['discipline_officer'],
  institutions: [INST_A],
};
const TEACHER_A: TestUser = { sub: 'teacher-a', roles: ['teacher'], institutions: [INST_A] };

async function createCase(
  body: Partial<{
    type: string;
    institutionId: string;
    areaId: string;
    assignedTo: string;
  }>,
  user: TestUser = ADMIN,
) {
  return app.inject({
    method: 'POST',
    url: '/workflows/cases',
    headers: as(user),
    payload: {
      type: 'counselling',
      title: 'Case',
      description: 'Sensitive details',
      entityType: 'student',
      entityId: 'stu-1',
      ...body,
    },
  });
}

async function seed() {
  const a = (await createCase({ type: 'counselling', institutionId: INST_A })).json();
  const b = (await createCase({ type: 'counselling', institutionId: INST_B })).json();
  const bAssigned = (
    await createCase({ type: 'disciplinary', institutionId: INST_B, assignedTo: 'teacher-a' })
  ).json();
  const aDisc = (await createCase({ type: 'disciplinary', institutionId: INST_A })).json();
  return { a, b, bAssigned, aDisc };
}

const listIds = async (user: TestUser) => {
  const res = await app.inject({ method: 'GET', url: '/workflows/cases', headers: as(user) });
  expect(res.statusCode).toBe(200);
  const body = res.json() as { data: Array<{ id: string }>; meta: { totalItems: number } };
  return { ids: body.data.map((c) => c.id).sort(), total: body.meta.totalItems };
};

describe('case access scope (PRC-H111)', () => {
  it('rejects unauthenticated callers with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/workflows/cases' });
    expect(res.statusCode).toBe(401);
  });

  it('tenant admin sees every case in the tenant', async () => {
    const { a, b, bAssigned, aDisc } = await seed();
    const { ids, total } = await listIds(ADMIN);
    expect(ids).toEqual([a.id, b.id, bAssigned.id, aDisc.id].sort());
    expect(total).toBe(4);
  });

  it('counsellor scoped to institution A does not see institution B cases', async () => {
    const { a, b, aDisc } = await seed();
    const { ids, total } = await listIds(COUNSELLOR_A);
    expect(ids).toEqual([a.id, aDisc.id].sort());
    expect(total).toBe(2);
    const res = await app.inject({
      method: 'GET',
      url: `/workflows/cases/${b.id}`,
      headers: as(COUNSELLOR_A),
    });
    expect(res.statusCode).toBe(404);
  });

  it('counsellor cannot update or resolve an institution B case (404)', async () => {
    const { b } = await seed();
    const put = await app.inject({
      method: 'PUT',
      url: `/workflows/cases/${b.id}`,
      headers: as(COUNSELLOR_A),
      payload: { status: 'in_progress' },
    });
    expect(put.statusCode).toBe(404);
    const resolve = await app.inject({
      method: 'POST',
      url: `/workflows/cases/${b.id}/resolve`,
      headers: as(COUNSELLOR_A),
      payload: { outcome: 'x', resolvedBy: 'couns-a', notes: 'n', followUpRequired: false },
    });
    expect(resolve.statusCode).toBe(404);
    expect((await repo.findCaseById(b.id, TENANT_ID))?.status).toBe('open');
  });

  it('discipline officer does not see counselling cases in their own institution', async () => {
    const { a, aDisc } = await seed();
    const { ids } = await listIds(DISCIPLINE_A);
    expect(ids).toEqual([aDisc.id]);
    const res = await app.inject({
      method: 'GET',
      url: `/workflows/cases/${a.id}`,
      headers: as(DISCIPLINE_A),
    });
    expect(res.statusCode).toBe(404);
  });

  it('assignee sees their own case even outside their institution and role', async () => {
    const { a, bAssigned } = await seed();
    const { ids } = await listIds(TEACHER_A);
    expect(ids).toEqual([bAssigned.id]);
    const own = await app.inject({
      method: 'GET',
      url: `/workflows/cases/${bAssigned.id}`,
      headers: as(TEACHER_A),
    });
    expect(own.statusCode).toBe(200);
    // Not assigned and not a case role: an institution A counselling case is hidden.
    const other = await app.inject({
      method: 'GET',
      url: `/workflows/cases/${a.id}`,
      headers: as(TEACHER_A),
    });
    expect(other.statusCode).toBe(404);
  });

  it('query params cannot widen scope (institutionId/assignedTo are not trusted)', async () => {
    await seed();
    const res = await app.inject({
      method: 'GET',
      url: `/workflows/cases?assignedTo=teacher-a&institutionId=${INST_B}`,
      headers: as(COUNSELLOR_A),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: unknown[] }).data).toHaveLength(0);
  });

  it('roleName is never trusted: a custom role named "counsellor" sees nothing', async () => {
    await seed();
    const { ids } = await listIds({
      sub: 'mallory',
      roles: ['custom-role-1'],
      institutions: [INST_A],
      roleName: 'counsellor',
    });
    expect(ids).toEqual([]);
  });

  it('area-scoped principal sees cases recorded against that area only', async () => {
    const inArea = (await createCase({ type: 'complaint', areaId: D1 })).json();
    await createCase({ type: 'complaint', areaId: D2 });
    const { ids } = await listIds({ sub: 'p-area', roles: ['principal'], areas: [D1] });
    expect(ids).toEqual([inArea.id]);
  });

  it('scoped callers may only create cases of their type inside their own scope', async () => {
    expect((await createCase({ institutionId: INST_A }, COUNSELLOR_A)).statusCode).toBe(201);
    expect((await createCase({ institutionId: INST_B }, COUNSELLOR_A)).statusCode).toBe(403);
    expect((await createCase({}, COUNSELLOR_A)).statusCode).toBe(403);
    expect(
      (await createCase({ type: 'counselling', institutionId: INST_A }, DISCIPLINE_A)).statusCode,
    ).toBe(403);
    expect((await createCase({ institutionId: INST_A }, TEACHER_A)).statusCode).toBe(403);
    expect((await createCase({ institutionId: INST_A }, PRINCIPAL_A)).statusCode).toBe(201);
  });
});

describe('case-access helpers', () => {
  const principal: CasePrincipal = {
    userId: 'u1',
    roles: ['counsellor'],
    institutionIds: [INST_A],
    areaIds: [],
  };

  it('tenant-wide roles have no scope; others are scoped', () => {
    expect(caseScopeFor({ ...principal, roles: ['admin'] })).toBeUndefined();
    expect(caseScopeFor({ ...principal, roles: ['super-admin'] })).toBeUndefined();
    expect(caseScopeFor(principal)).toEqual({
      assigneeId: 'u1',
      types: ['counselling', 'disciplinary', 'complaint'],
      institutionIds: [INST_A],
      areaIds: [],
    });
  });

  it('cases without institution/area are visible to scoped callers only as assignee', () => {
    const base = { type: 'complaint' as const, institutionId: null, areaId: null };
    expect(canAccessCase({ ...base, assignedTo: null }, principal)).toBe(false);
    expect(canAccessCase({ ...base, assignedTo: 'u1' }, principal)).toBe(true);
  });

  it('getCasePrincipal reads roleId, institutions, role institutionId and areas', () => {
    const request = {
      user: {
        sub: 'u9',
        roles: [{ roleId: 'principal', roleName: 'Head', areaId: 'x', institutionId: 'inst-r' }],
        institutions: [INST_A],
        areas: [{ areaId: 'd-1', level: 1 }],
      },
    } as unknown as Parameters<typeof getCasePrincipal>[0];
    const p = getCasePrincipal(request);
    expect(p?.roles).toEqual(['principal']);
    expect([...(p?.institutionIds ?? [])].sort()).toEqual([INST_A, 'inst-r'].sort());
    expect(p?.areaIds).toEqual(['d-1']);
    expect(getCasePrincipal({} as Parameters<typeof getCasePrincipal>[0])).toBeNull();
  });

  it('Pg scope clause is parameterised and offsets placeholders', () => {
    expect(caseScopeClause(undefined, 2)).toEqual({ sql: '', values: [] });
    const clause = caseScopeClause(caseScopeFor(principal), 4);
    expect(clause.sql).toBe(
      'AND (assigned_to = $4 OR (type = ANY($5::text[]) AND ' +
        '(institution_id = ANY($6::text[]) OR area_id = ANY($7::text[]))))',
    );
    expect(clause.values).toEqual([
      'u1',
      ['counselling', 'disciplinary', 'complaint'],
      [INST_A],
      [],
    ]);
  });
});
