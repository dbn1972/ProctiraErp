/**
 * G-715 — workflow engine on Postgres (db/sql/025). Drives the real
 * `workflowPlugin` end-to-end against `PgWorkflowRepository` / `PgCaseRepository`
 * and asserts durability, RLS isolation and the append-only audit trail.
 * Pg cases skip when DATABASE_URL is unset.
 */
import { randomUUID } from 'node:crypto';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';

import { getSharedPgPool, withPlatformScope } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, describe, expect, it } from 'vitest';

import { createWorkflowRepositories } from './create-workflow-repositories.js';
import { InMemoryWorkflowRepository } from './in-memory-repository.js';
import { PgCaseRepository, PgWorkflowRepository } from './pg-workflow-repository.js';
import { workflowPlugin } from './workflow-plugin.js';
const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'pg-workflow-repository.live.test' });

const pool = getSharedPgPool();
const live = pool !== null;
const MIGRATOR_DATABASE_URL = process.env['MIGRATOR_DATABASE_URL']?.trim();
const ownerPool = MIGRATOR_DATABASE_URL ? getSharedPgPool(MIGRATOR_DATABASE_URL) : null;

afterAll(async () => {
  await ownerPool?.end();
});

async function seedTenant(tenantId: string): Promise<void> {
  await ensurePgTestTenant(pool!, tenantId);
}

/** JWT subjects used by the end-to-end case (PRC-M490: the actor comes from the token). */
const SUBMITTER_SUB = 'user-1';
const APPROVER_SUB = 'admin-1';

/** Headers the test auth hook maps onto `request.user` (sub + role ids). */
const asUser = (sub: string, roleIds: readonly string[] = []) => ({
  'x-test-user': sub,
  'x-test-roles': roleIds.join(','),
});

async function buildApp(tenantId: string): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    (request as typeof request & { tenantId: string }).tenantId = tenantId;
    // Stand-in for the gateway auth plugin: production `request.user` is a JwtPayload whose
    // `roles` are RoleAssignment objects, so mirror that shape (same as routes-actor.test.ts).
    const sub = request.headers['x-test-user'];
    if (typeof sub === 'string' && sub.length > 0) {
      const roles = String(request.headers['x-test-roles'] ?? '')
        .split(',')
        .filter((roleId) => roleId.length > 0)
        .map((roleId) => ({ roleId, roleName: roleId.toUpperCase(), areaId: 'area-1' }));
      (request as typeof request & { user: unknown }).user = { sub, roles };
    }
  });
  await app.register(workflowPlugin, {
    repository: new PgWorkflowRepository(pool!),
    caseRepository: new PgCaseRepository(pool!),
    prefix: '/workflow-engine',
  });
  await app.ready();
  return app;
}

const definitionBody = {
  name: 'Transfer approval',
  entityType: 'student_transfer',
  states: [
    // `draft` is assigned to a specific user, later states to the `admin` role id.
    {
      id: 'draft',
      name: 'Draft',
      type: 'INITIAL',
      assigneeType: 'user',
      assigneeId: SUBMITTER_SUB,
    },
    {
      id: 'review',
      name: 'Review',
      type: 'INTERMEDIATE',
      assigneeType: 'role',
      assigneeId: 'admin',
    },
    { id: 'done', name: 'Done', type: 'FINAL', assigneeType: 'role', assigneeId: 'admin' },
  ],
  transitions: [
    { id: 't1', fromStateId: 'draft', toStateId: 'review', action: 'submit' },
    { id: 't2', fromStateId: 'review', toStateId: 'done', action: 'approve' },
  ],
};

describe('createWorkflowRepositories', () => {
  it('falls back to in-memory when DATABASE_URL is unset', () => {
    const prev = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(createWorkflowRepositories().repository).toBeInstanceOf(InMemoryWorkflowRepository);
    } finally {
      if (prev !== undefined) process.env.DATABASE_URL = prev;
    }
  });

  it.skipIf(!live)('returns Pg repositories when DATABASE_URL is set', () => {
    const repos = createWorkflowRepositories();
    expect(repos.repository).toBeInstanceOf(PgWorkflowRepository);
    expect(repos.caseRepository).toBeInstanceOf(PgCaseRepository);
  });
});

describe.skipIf(!live)('workflow engine on Postgres', () => {
  it('runs definition → instance → transitions → audit through the plugin and survives a new process', async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const app = await buildApp(tenantId);

    const created = await app.inject({
      method: 'POST',
      url: '/workflow-engine',
      payload: definitionBody,
    });
    expect(created.statusCode).toBe(201);
    const definition = created.json() as { id: string };

    const started = await app.inject({
      method: 'POST',
      url: '/workflow-engine/instances',
      payload: {
        workflowDefinitionId: definition.id,
        entityType: 'student_transfer',
        entityId: 'student-42',
        metadata: { reason: 'relocation' },
      },
    });
    expect(started.statusCode).toBe(201);
    const instance = started.json() as { id: string; currentStateId: string; status: string };
    expect(instance.currentStateId).toBe('draft');

    const submit = await app.inject({
      method: 'POST',
      url: `/workflow-engine/instances/${instance.id}/transition`,
      headers: asUser(SUBMITTER_SUB),
      // A body actorId is ignored over HTTP; the audit must record the JWT subject.
      payload: { action: 'submit', actorId: 'spoofed-actor', comments: 'please review' },
    });
    expect(submit.statusCode).toBe(200);

    // The submitter does not hold the `admin` role, so it cannot act on `review`.
    const notAssignee = await app.inject({
      method: 'POST',
      url: `/workflow-engine/instances/${instance.id}/transition`,
      headers: asUser(SUBMITTER_SUB),
      payload: { action: 'approve' },
    });
    expect(notAssignee.statusCode).toBe(403);

    const approve = await app.inject({
      method: 'POST',
      url: `/workflow-engine/instances/${instance.id}/transition`,
      headers: asUser(APPROVER_SUB, ['admin']),
      payload: { action: 'approve' },
    });
    expect(approve.statusCode).toBe(200);
    expect((approve.json() as { status: string }).status).toBe('COMPLETED');

    const audit = await app.inject({
      method: 'GET',
      url: `/workflow-engine/instances/${instance.id}/audit`,
    });
    expect(audit.statusCode).toBe(200);
    const auditBody = audit.json() as { data?: unknown[] } | unknown[];
    const records = Array.isArray(auditBody) ? auditBody : (auditBody.data ?? []);
    expect(records).toHaveLength(2);
    expect(
      (records as { action: string; actorId: string }[])
        .map((r) => `${r.action}:${r.actorId}`)
        .sort(),
    ).toEqual([`approve:${APPROVER_SUB}`, `submit:${SUBMITTER_SUB}`]);

    const caseRes = await app.inject({
      method: 'POST',
      url: '/workflow-engine/cases',
      // PRC-H111: case routes require an authenticated principal with case scope.
      headers: asUser(APPROVER_SUB, ['admin']),
      payload: {
        type: 'complaint',
        title: 'Bus delay',
        description: 'Route 7 late three days running',
        entityType: 'student',
        entityId: 'student-42',
        priority: 'high',
      },
    });
    expect(caseRes.statusCode).toBe(201);
    await app.close();

    // A fresh plugin instance (new "process") reads the same rows back.
    const again = await buildApp(tenantId);
    const fetched = await again.inject({
      method: 'GET',
      url: `/workflow-engine/instances/${instance.id}`,
      headers: asUser(APPROVER_SUB, ['admin']),
    });
    expect(fetched.statusCode).toBe(200);
    expect((fetched.json() as { status: string }).status).toBe('COMPLETED');
    const list = await again.inject({ method: 'GET', url: '/workflow-engine' });
    expect((list.json() as { meta: { totalItems: number } }).meta.totalItems).toBe(1);
    const cases = await again.inject({
      method: 'GET',
      url: '/workflow-engine/cases',
      headers: asUser(APPROVER_SUB, ['admin']),
    });
    expect((cases.json() as { meta: { totalItems: number } }).meta.totalItems).toBe(1);
    await again.close();
  });

  it.skipIf(!ownerPool)(
    'isolates tenants under RLS and keeps the transition audit append-only',
    async () => {
      const tenantA = randomUUID();
      const tenantB = randomUUID();
      await seedTenant(tenantA);
      await seedTenant(tenantB);
      const repo = new PgWorkflowRepository(pool!);

      const definition = await repo.createDefinition({
        id: randomUUID(),
        tenantId: tenantA,
        name: 'Leave approval',
        entityType: 'staff_leave',
        description: null,
        states: definitionBody.states as never,
        transitions: definitionBody.transitions as never,
        escalationRules: null,
      });
      const instance = await repo.createInstance({
        id: randomUUID(),
        tenantId: tenantA,
        workflowDefinitionId: definition.id,
        entityType: 'staff_leave',
        entityId: 'staff-1',
        currentStateId: 'draft',
        status: 'ACTIVE',
        metadata: null,
        approvals: [],
      });
      const audit = await repo.createAuditRecord({
        id: randomUUID(),
        tenantId: tenantA,
        instanceId: instance.id,
        fromStateId: 'draft',
        toStateId: 'review',
        action: 'submit',
        actorId: 'staff-1',
        comments: null,
        timestamp: new Date(),
      });

      expect(await repo.findDefinitionById(definition.id, tenantB)).toBeNull();
      expect(await repo.findInstanceById(instance.id, tenantB)).toBeNull();
      expect(await repo.getAuditHistory(instance.id, tenantB)).toEqual([]);
      expect(
        (await repo.listDefinitions(tenantB, {}, { page: 1, pageSize: 10 })).meta.totalItems,
      ).toBe(0);
      expect(
        (await repo.listInstances(tenantA, { status: 'ACTIVE' }, { page: 1, pageSize: 10 })).meta
          .totalItems,
      ).toBe(1);

      await expect(
        withPlatformScope(
          ownerPool!,
          (client) =>
            client.query(`UPDATE workflow_transition_audit SET action = 'tampered' WHERE id = $1`, [
              audit.id,
            ]),
          tenantA,
        ),
      ).rejects.toThrow(/append-only/);
      await expect(
        withPlatformScope(
          ownerPool!,
          (client) =>
            client.query(`DELETE FROM workflow_transition_audit WHERE id = $1`, [audit.id]),
          tenantA,
        ),
      ).rejects.toThrow(/append-only/);
    },
  );
});
