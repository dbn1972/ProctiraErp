/**
 * Live Postgres proof for PgWorkflowUiStore (G-732): definitions persist across
 * store instances (restart simulation), approvals are decided atomically
 * (approval row removed + instance status flipped) and every query is bound to
 * the caller's tenant under FORCE RLS. Skipped without DATABASE_URL.
 */
import { randomUUID } from 'node:crypto';

import { withPgTenant } from '@proctira/database';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import {
  createWorkflowUiStore,
  isPgWorkflowUiEnabled,
  PgWorkflowUiStore,
} from './workflow-ui-pg-store.js';

const enabled = isPgWorkflowUiEnabled();
const pool = enabled ? new pg.Pool({ connectionString: process.env.DATABASE_URL }) : null;

afterAll(async () => {
  await pool?.end();
});

describe('PgWorkflowUiStore (live)', () => {
  it.skipIf(!enabled)('definitions survive a new store instance and stay tenant-scoped', async () => {
    const storeA = createWorkflowUiStore();
    expect(storeA).toBeInstanceOf(PgWorkflowUiStore);
    const tenantA = randomUUID();
    const tenantB = randomUUID();

    const def = await storeA.createDefinition({
      id: randomUUID(),
      tenantId: tenantA,
      name: 'Leave approval',
      module: 'hr',
      version: 1,
      steps: [
        { id: 's1', order: 1, name: 'Manager', approverRole: 'manager' },
        { id: 's2', order: 2, name: 'HR', approverRole: 'hr' },
      ],
      active: true,
      updatedAt: new Date().toISOString(),
    });

    const storeB = createWorkflowUiStore();
    const fetched = await storeB.getDefinition(tenantA, def.id);
    expect(fetched?.name).toBe('Leave approval');
    expect(fetched?.steps.map((s) => s.name)).toEqual(['Manager', 'HR']);
    expect((await storeB.listDefinitions(tenantA)).map((d) => d.id)).toEqual([def.id]);

    expect(await storeB.getDefinition(tenantB, def.id)).toBeNull();
    expect(await storeB.listDefinitions(tenantB)).toEqual([]);
  });

  it.skipIf(!enabled)('decideApproval removes the approval and flips the instance for its tenant only', async () => {
    const store = new PgWorkflowUiStore(pool!);
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const definitionId = randomUUID();
    const instanceId = randomUUID();
    const approvalId = randomUUID();
    const now = new Date().toISOString();

    await store.createDefinition({
      id: definitionId,
      tenantId: tenantA,
      name: 'Purchase approval',
      module: 'finance',
      version: 1,
      steps: [{ id: 's1', order: 1, name: 'Finance', approverRole: 'finance' }],
      active: true,
      updatedAt: now,
    });
    await withPgTenant(pool!, tenantA, async (client) => {
      await client.query(
        `INSERT INTO workflow_ui_instances
           (id, tenant_id, definition_id, definition_name, subject_type, subject_id,
            initiated_by, initiated_at, current_step, status)
         VALUES ($1,$2,$3,'Purchase approval','purchase_order',$4,'requester-1',$5,'Finance','PENDING')`,
        [instanceId, tenantA, definitionId, randomUUID(), now],
      );
      await client.query(
        `INSERT INTO workflow_ui_approvals
           (id, tenant_id, instance_id, definition_name, subject_type, subject_id,
            step_name, requested_at, requested_by)
         VALUES ($1,$2,$3,'Purchase approval','purchase_order','po-1','Finance',$4,'requester-1')`,
        [approvalId, tenantA, instanceId, now],
      );
    });

    expect((await store.listPendingApprovals(tenantA)).map((a) => a.id)).toEqual([approvalId]);
    expect((await store.listInstances(tenantA)).map((i) => i.status)).toEqual(['PENDING']);

    // Another tenant can neither see nor decide it.
    expect(await store.listPendingApprovals(tenantB)).toEqual([]);
    expect(await store.decideApproval(tenantB, approvalId, 'APPROVED')).toBeNull();
    expect((await store.listPendingApprovals(tenantA)).map((a) => a.id)).toEqual([approvalId]);

    const decided = await store.decideApproval(tenantA, approvalId, 'APPROVED');
    expect(decided).toEqual({ id: approvalId, instanceId, status: 'APPROVED' });
    expect(await store.listPendingApprovals(tenantA)).toEqual([]);
    const [instance] = await store.listInstances(tenantA);
    expect(instance?.status).toBe('APPROVED');
    expect(instance?.currentStep).toBe('Completed');

    // Deciding twice is a no-op null, not a second state flip.
    expect(await store.decideApproval(tenantA, approvalId, 'REJECTED')).toBeNull();
  });
});
