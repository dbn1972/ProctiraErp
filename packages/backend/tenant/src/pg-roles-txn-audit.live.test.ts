/**
 * PRC-L264 (B07): the role/user audit row must be written in the SAME database
 * transaction as the mutation. A forced audit-append failure must roll the
 * role/user change back, so a crash between "role committed" and "audit
 * written" can never leave an unaudited high-risk change.
 *
 * On the base (post-hoc audit via RolesService.emitAudit) the role is committed
 * in its own transaction before any audit write, so forcing the audit to throw
 * still leaves the role present → the rollback assertions fail.
 *
 * Runs as the non-owner runtime role so RLS is real. Skipped without DATABASE_URL.
 */
import { randomUUID } from 'node:crypto';

import {
  appendAuditEntryOnClient,
  currentAuditChainKey,
  toCreateAuditLogInput,
} from '@proctira/backend-audit';
import { withPgTenant, type PgQueryable } from '@proctira/database';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { BuiltInRoleSeed } from './in-memory-roles-repository.js';
import { PgRolesRepository } from './pg-roles-repository.js';
import type { RolesTxnAuditPort } from './roles-repository.js';
import { RolesService } from './roles-service.js';

const liveTestsRequired =
  process.env.ALLOW_LIVE_TEST_SKIP !== '1' &&
  (process.env.REQUIRE_LIVE_TESTS === '1' || process.env.CI === 'true' || process.env.CI === '1');
const DATABASE_URL = process.env.DATABASE_URL?.trim();
if (!DATABASE_URL && liveTestsRequired) {
  throw new Error('[W3-TEST-03] pg-roles-txn-audit.live.test has no DATABASE_URL');
}
const pool = DATABASE_URL ? new pg.Pool({ connectionString: DATABASE_URL, max: 4 }) : null;
const live = Boolean(pool);

const SEED: BuiltInRoleSeed[] = [
  {
    roleId: 'admin',
    roleName: 'Administrator',
    permissions: [{ resource: '*', action: 'manage' }],
  },
];

describe.skipIf(!live)('PgRolesRepository same-transaction audit (PRC-L264, live)', () => {
  const TENANT = randomUUID();

  async function ensureTenant(tenantId: string): Promise<void> {
    await withPgTenant(pool!, tenantId, (client) =>
      client.query(
        `INSERT INTO tenants (id, name, slug, config, status)
         VALUES ($1::uuid, $2, $3, '{}'::jsonb, 'active')
         ON CONFLICT (id) DO UPDATE
           SET status = 'active', deleted_at = NULL, updated_at = now()`,
        [tenantId, `Txn audit ${tenantId.slice(0, 8)}`, `txn-audit-${tenantId}`],
      ),
    );
  }

  async function countAudit(tenantId: string, entityId: string): Promise<number> {
    return withPgTenant(pool!, tenantId, async (client) => {
      const res = await client.query(
        `SELECT COUNT(*)::int AS c FROM audit_log_entries
          WHERE tenant_id = $1 AND entity_id = $2`,
        [tenantId, entityId],
      );
      return Number((res.rows[0] as { c: number }).c);
    });
  }

  /** PRC-M200: the tenant's chain head sequence (0 before the first append). */
  async function headSeq(tenantId: string): Promise<number> {
    return withPgTenant(pool!, tenantId, async (client) => {
      const res = await client.query(
        `SELECT head_seq FROM audit_chain_heads WHERE tenant_id = $1`,
        [tenantId],
      );
      const row = res.rows[0] as { head_seq: string | number } | undefined;
      return Number(row?.head_seq ?? 0);
    });
  }

  /** PRC-M200: key_id and chain_seq of this entity's audit rows. */
  async function keyedRows(
    tenantId: string,
    entityId: string,
  ): Promise<Array<{ keyId: string | null; chainSeq: number }>> {
    return withPgTenant(pool!, tenantId, async (client) => {
      const res = await client.query(
        `SELECT key_id, chain_seq FROM audit_log_entries
          WHERE tenant_id = $1 AND entity_id = $2`,
        [tenantId, entityId],
      );
      return (res.rows as Array<{ key_id: string | null; chain_seq: string | number }>).map(
        (r) => ({ keyId: r.key_id, chainSeq: Number(r.chain_seq) }),
      );
    });
  }

  beforeAll(async () => {
    await ensureTenant(TENANT);
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it('rolls the role creation back when the in-transaction audit append fails', async () => {
    // A port that always throws simulates an audit failure inside the mutation txn.
    const throwingAudit: RolesTxnAuditPort = {
      async appendAuditInTxn() {
        throw new Error('forced audit failure');
      },
    };
    const repo = new PgRolesRepository(pool!, SEED, throwingAudit);
    const service = new RolesService(repo);

    const name = `Rollback ${Date.now().toString(36)}`;
    await expect(
      service.createRole(TENANT, {
        name,
        permissions: [{ resource: 'student', action: 'read' }],
      }),
    ).rejects.toThrow(/forced audit failure/);

    // The role must NOT exist: the audit failure rolled the whole txn back.
    const roles = await service.listRoles(TENANT);
    expect(roles.map((r) => r.name)).not.toContain(name);
  });

  it('commits the role AND one audit row atomically when the audit append succeeds', async () => {
    const auditEvents: Array<{ entityId: string }> = [];
    const okAudit: RolesTxnAuditPort = {
      async appendAuditInTxn(client, event) {
        // Write a real audit row on the SAME client/txn as the mutation, through
        // the production keyed path (PRC-M200, same mapping as the gateway's
        // RolesTxnAuditPort): the head advances via the SECURITY DEFINER functions.
        await appendAuditEntryOnClient(
          client as unknown as PgQueryable,
          toCreateAuditLogInput({
            tenantId: event.tenantId,
            entityType: event.entityType,
            entityId: event.entityId,
            operation: event.operation,
            userId: event.actorId ?? 'system',
            userName: event.actorId ?? 'system',
            ipAddress: event.ipAddress ?? '0.0.0.0',
            beforeValues: event.beforeValues,
            afterValues: event.afterValues,
            metadata: event.requestId
              ? { ...event.metadata, requestId: event.requestId }
              : event.metadata,
          }),
        );
        auditEvents.push({ entityId: event.entityId });
      },
    };
    const repo = new PgRolesRepository(pool!, SEED, okAudit);
    const service = new RolesService(repo);

    const name = `Atomic ${Date.now().toString(36)}`;
    const headBefore = await headSeq(TENANT);
    const created = await service.createRole(TENANT, {
      name,
      permissions: [{ resource: 'student', action: 'read' }],
    });

    const roles = await service.listRoles(TENANT);
    expect(roles.map((r) => r.name)).toContain(name);
    expect(auditEvents.map((e) => e.entityId)).toContain(created.id);
    // Exactly one audit row for this role (no post-hoc double write).
    expect(await countAudit(TENANT, created.id)).toBe(1);
    // PRC-M200: the row is keyed (key_id set) and sits at the advanced chain head.
    const headAfter = await headSeq(TENANT);
    expect(headAfter).toBe(headBefore + 1);
    expect(await keyedRows(TENANT, created.id)).toEqual([
      { keyId: currentAuditChainKey().keyId, chainSeq: headAfter },
    ]);
  });
});
