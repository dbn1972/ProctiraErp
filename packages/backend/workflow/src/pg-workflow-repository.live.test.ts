/**
 * G-715 — workflow engine on Postgres (db/sql/025). Drives the real
 * `workflowPlugin` end-to-end against `PgWorkflowRepository` / `PgCaseRepository`
 * and asserts durability, RLS isolation and the append-only audit trail.
 * Pg cases skip when DATABASE_URL is unset.
 */
import { randomUUID } from 'node:crypto';

import { getSharedPgPool, withPgTenant } from '@proctira/database';
import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import { createWorkflowRepositories } from './create-workflow-repositories.js';
import { InMemoryWorkflowRepository } from './in-memory-repository.js';
import { PgCaseRepository, PgWorkflowRepository } from './pg-workflow-repository.js';
import { workflowPlugin } from './workflow-plugin.js';

const pool = getSharedPgPool();
const live = pool !== null;

async function seedTenant(tenantId: string): Promise<void> {
  await withPgTenant(pool!, tenantId, (client) =>
    client.query(
      `INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [tenantId, `wf-${tenantId.slice(0, 8)}`, `wf-${tenantId}`],
    ),
  );
}

async function buildApp(tenantId: string): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    (request as typeof request & { tenantId: string }).tenantId = tenantId;
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
    { id: 'draft', name: 'Draft', type: 'INITIAL', assigneeType: 'user', assigneeId: 'creator' },
    { id: 'review', name: 'Review', type: 'INTERMEDIATE', assigneeType: 'role', assigneeId: 'admin' },
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
      payload: { action: 'submit', actorId: 'user-1', comments: 'please review' },
    });
    expect(submit.statusCode).toBe(200);
    const approve = await app.inject({
      method: 'POST',
      url: `/workflow-engine/instances/${instance.id}/transition`,
      payload: { action: 'approve', actorId: 'admin-1' },
    });
    expect(approve.statusCode).toBe(200);
    expect((approve.json() as { status: string }).status).toBe('COMPLETED');

    const audit = await app.inject({
      method: 'GET',
      url: `/workflow-engine/instances/${instance.id}/audit`,
    });
    expect(audit.statusCode).toBe(200);
    const auditBody = audit.json() as { data?: unknown[] } | unknown[];
    const records = Array.isArray(auditBody) ? auditBody : auditBody.data ?? [];
    expect(records).toHaveLength(2);

    const caseRes = await app.inject({
      method: 'POST',
      url: '/workflow-engine/cases',
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
    });
    expect(fetched.statusCode).toBe(200);
    expect((fetched.json() as { status: string }).status).toBe('COMPLETED');
    const list = await again.inject({ method: 'GET', url: '/workflow-engine' });
    expect((list.json() as { meta: { totalItems: number } }).meta.totalItems).toBe(1);
    const cases = await again.inject({ method: 'GET', url: '/workflow-engine/cases' });
    expect((cases.json() as { meta: { totalItems: number } }).meta.totalItems).toBe(1);
    await again.close();
  });

  it('isolates tenants under RLS and keeps the transition audit append-only', async () => {
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
    expect((await repo.listDefinitions(tenantB, {}, { page: 1, pageSize: 10 })).meta.totalItems).toBe(0);
    expect(
      (await repo.listInstances(tenantA, { status: 'ACTIVE' }, { page: 1, pageSize: 10 })).meta
        .totalItems,
    ).toBe(1);

    await expect(
      withPgTenant(pool!, tenantA, (client) =>
        client.query(`UPDATE workflow_transition_audit SET action = 'tampered' WHERE id = $1`, [
          audit.id,
        ]),
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      withPgTenant(pool!, tenantA, (client) =>
        client.query(`DELETE FROM workflow_transition_audit WHERE id = $1`, [audit.id]),
      ),
    ).rejects.toThrow(/append-only/);
  });
});
