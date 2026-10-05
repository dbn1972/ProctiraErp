/**
 * PRC-M022 — engine-backed workflow UI lists page instead of truncating at 200.
 * PRC-M021 — checkApprovalDecider unit rules.
 */
import { InMemoryWorkflowRepository, WorkflowService } from '@proctira/backend-workflow';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { EngineBackedWorkflowUiStore, stepsToEngine } from './workflow-ui-engine-store.js';
import { checkApprovalDecider, workflowUiPlugin } from './workflow-ui-plugin.js';

const TENANT = '11111111-2222-4333-8444-555555555555';

describe('workflow UI paging (PRC-M022)', () => {
  it('250 ACTIVE instances are all reachable through approvals pagination', async () => {
    const repository = new InMemoryWorkflowRepository();
    const { states, transitions } = stepsToEngine([
      { id: 's1', order: 1, name: 'Review', approverRole: 'PRINCIPAL' },
    ]);
    await repository.createDefinition({
      id: 'def-1',
      tenantId: TENANT,
      name: 'Bulk',
      entityType: 'bulk',
      description: null,
      states,
      transitions,
      escalationRules: null,
    } as never);
    for (let i = 0; i < 250; i += 1) {
      await repository.createInstance({
        id: `inst-${String(i).padStart(3, '0')}`,
        tenantId: TENANT,
        workflowDefinitionId: 'def-1',
        entityType: 'bulk',
        entityId: `e-${i}`,
        currentStateId: 's1',
        status: 'ACTIVE',
        metadata: { initiatedBy: 'someone' },
        approvals: [],
      } as never);
    }
    const store = new EngineBackedWorkflowUiStore(
      repository,
      new WorkflowService(repository),
      'memory',
    );
    const app = Fastify();
    app.addHook('onRequest', async (req) => {
      (req as { user?: unknown }).user = { sub: 'a', tenantId: TENANT, roles: ['admin'] };
      (req as { tenantId?: string }).tenantId = TENANT;
    });
    await app.register(workflowUiPlugin, { store });
    const seen = new Set<string>();
    let totalPages = 1;
    for (let page = 1; page <= totalPages; page += 1) {
      const res = await app.inject({
        method: 'GET',
        url: `/workflows/approvals/pending?page=${page}&pageSize=100`,
      });
      const body = res.json() as {
        data: Array<{ id: string }>;
        meta: { totalItems: number; totalPages: number };
      };
      expect(body.meta.totalItems).toBe(250);
      totalPages = body.meta.totalPages;
      for (const row of body.data) seen.add(row.id);
    }
    expect(totalPages).toBe(3);
    expect(seen.size).toBe(250);
    const instances = await app.inject({ method: 'GET', url: '/workflows/instances?pageSize=200' });
    expect((instances.json() as { meta: { totalItems: number } }).meta.totalItems).toBe(250);
    await app.close();
  });
});

describe('checkApprovalDecider (PRC-M021)', () => {
  const ctx = { approverRole: 'PRINCIPAL', initiatedBy: 'u-init' };
  it('requires the step role, allows platform deciders, forbids self-approval', () => {
    expect(checkApprovalDecider({ roles: ['teacher'] }, 'u1', ctx)).toEqual({
      ok: false,
      code: 'WORKFLOW_STEP_NOT_ASSIGNED',
    });
    expect(checkApprovalDecider({ roles: [{ roleId: 'principal' }] }, 'u1', ctx)).toEqual({
      ok: true,
    });
    expect(checkApprovalDecider({ roles: ['super-admin'] }, 'u1', ctx)).toEqual({ ok: true });
    expect(checkApprovalDecider({ roles: ['principal'] }, 'u-init', ctx)).toEqual({
      ok: false,
      code: 'WORKFLOW_SELF_APPROVAL_FORBIDDEN',
    });
    expect(
      checkApprovalDecider({ roles: ['principal'] }, 'u-init', ctx, { allowSelfApproval: true }),
    ).toEqual({ ok: true });
    expect(
      checkApprovalDecider({ roles: ['admin'] }, 'u1', { ...ctx, approverRole: null }),
    ).toEqual({ ok: false, code: 'WORKFLOW_STEP_NOT_ASSIGNED' });
  });
  it('matches roleId only: a tenant custom role NAMED "Super Admin" is refused', () => {
    // Tenant custom roles get a UUID roleId; roleName is tenant-editable text.
    const customId = '6f1c2b8e-0d4a-4c1e-9a77-2f5b3c8d9e10';
    expect(
      checkApprovalDecider({ roles: [{ roleId: customId, roleName: 'Super Admin' }] }, 'u1', ctx),
    ).toEqual({ ok: false, code: 'WORKFLOW_STEP_NOT_ASSIGNED' });
    // A custom role named like the step's approver role does not match it either.
    expect(
      checkApprovalDecider({ roles: [{ roleId: customId, roleName: 'Principal' }] }, 'u1', ctx),
    ).toEqual({ ok: false, code: 'WORKFLOW_STEP_NOT_ASSIGNED' });
    // The platform roleId still decides, whatever its display name.
    expect(
      checkApprovalDecider({ roles: [{ roleId: 'super_admin', roleName: 'Ops' }] }, 'u1', ctx),
    ).toEqual({ ok: true });
  });
});
