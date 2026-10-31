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

import { withPgTenant } from '@proctira/database';
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
        // Write a real audit row on the SAME client/txn as the mutation.
        await client.query(
          `INSERT INTO audit_log_entries (
             id, tenant_id, entity_type, entity_id, operation, user_id, user_name,
             ip_address, occurred_at, before_values, after_values, metadata
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb)`,
          [
            randomUUID(),
            event.tenantId,
            event.entityType,
            event.entityId,
            event.operation,
            event.actorId ?? 'system',
            event.actorId ?? 'system',
            event.ipAddress ?? '0.0.0.0',
            new Date(),
            event.beforeValues == null ? null : JSON.stringify(event.beforeValues),
            event.afterValues == null ? null : JSON.stringify(event.afterValues),
            JSON.stringify(event.metadata),
          ],
        );
        auditEvents.push({ entityId: event.entityId });
      },
    };
    const repo = new PgRolesRepository(pool!, SEED, okAudit);
    const service = new RolesService(repo);

    const name = `Atomic ${Date.now().toString(36)}`;
    const created = await service.createRole(TENANT, {
      name,
      permissions: [{ resource: 'student', action: 'read' }],
    });

    const roles = await service.listRoles(TENANT);
    expect(roles.map((r) => r.name)).toContain(name);
    expect(auditEvents.map((e) => e.entityId)).toContain(created.id);
    // Exactly one audit row for this role (no post-hoc double write).
    expect(await countAudit(TENANT, created.id)).toBe(1);
  });
});
