/**
 * PRC-L529 — a workflow-ui approval decision is recorded, not deleted, on a real, migrated
 * Postgres (runtime app role, RLS enforced).
 *
 * PgWorkflowUiStore.decideApproval (the unmounted fallback store; the engine path records
 * the actor) SELECTed the approval and then DELETEd it, so the decision and the approver
 * were lost. db/sql/272 adds decision / decided_by / decided_at; decideApproval now updates
 * the pending row (WHERE decided_at IS NULL) and pending lists filter decided_at IS NULL.
 *
 * Fails closed when CI=true or REQUIRE_LIVE_TESTS=1 and DATABASE_URL is unset (W3-TEST-03).
 */
import { randomUUID } from 'node:crypto';
import { withPgTenant } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgWorkflowUiStore } from './workflow-ui-pg-store.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'workflow-ui-approval-decision.live.test' });

describe.skipIf(!DATABASE_URL)('PRC-L529 workflow-ui approval decision (live)', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function pendingApproval() {
    const tenantId = randomUUID();
    await ensurePgTestTenant(pool, tenantId);
    const instanceId = randomUUID();
    const approvalId = randomUUID();
    await withPgTenant(pool, tenantId, async (client) => {
      await client.query(
        `INSERT INTO workflow_ui_instances
           (id, tenant_id, definition_id, definition_name, subject_type, subject_id,
            initiated_by, initiated_at, current_step, status)
         VALUES ($1, $2, $3, 'Leave approval', 'leave', 'L-1', 'requester', now(), 'Manager', 'PENDING')`,
        [instanceId, tenantId, randomUUID()],
      );
      await client.query(
        `INSERT INTO workflow_ui_approvals
           (id, tenant_id, instance_id, definition_name, subject_type, subject_id,
            step_name, requested_at, requested_by)
         VALUES ($1, $2, $3, 'Leave approval', 'leave', 'L-1', 'Manager', now(), 'requester')`,
        [approvalId, tenantId, instanceId],
      );
    });
    return { tenantId, instanceId, approvalId };
  }

  it('deciding keeps the approval row with the decision and the approver', async () => {
    const fx = await pendingApproval();
    const store = new PgWorkflowUiStore(pool);

    const result = await store.decideApproval(fx.tenantId, fx.approvalId, 'APPROVED', 'approver-7');
    expect(result).toEqual({ id: fx.approvalId, instanceId: fx.instanceId, status: 'APPROVED' });

    const row = await withPgTenant(pool, fx.tenantId, (client) =>
      client.query(
        `SELECT decision, decided_by, decided_at IS NOT NULL AS decided
           FROM workflow_ui_approvals WHERE id = $1`,
        [fx.approvalId],
      ),
    );
    expect(row.rows[0]).toEqual({ decision: 'APPROVED', decided_by: 'approver-7', decided: true });
    expect((await store.listPendingApprovals(fx.tenantId)).map((a) => a.id)).not.toContain(
      fx.approvalId,
    );
  });

  it('a decided approval cannot be decided again', async () => {
    const fx = await pendingApproval();
    const store = new PgWorkflowUiStore(pool);
    await store.decideApproval(fx.tenantId, fx.approvalId, 'REJECTED', 'approver-7');
    expect(
      await store.decideApproval(fx.tenantId, fx.approvalId, 'APPROVED', 'approver-8'),
    ).toBeNull();
    const row = await withPgTenant(pool, fx.tenantId, (client) =>
      client.query(`SELECT decision, decided_by FROM workflow_ui_approvals WHERE id = $1`, [
        fx.approvalId,
      ]),
    );
    expect(row.rows[0]).toEqual({ decision: 'REJECTED', decided_by: 'approver-7' });
  });
});
