/**
 * PRC-M013 (B07, Topic 5 Option A — staff): a staff PII mutation
 * (update / offboard / delete) must write its durable audit row in the SAME
 * database transaction as the mutation. A forced audit-append failure must roll
 * the staff change back, so a crash between "staff committed" and "audit
 * written" can never leave an unaudited durable staff mutation.
 *
 * Failing-first contract: on the BASE source the Prisma staff repository takes
 * no audit port and the service audits (at best) post-hoc, in a separate write,
 * so forcing the audit to throw still leaves the staff change committed → the
 * rollback assertions fail. After the fix the throwing port rolls the mutation
 * back (staff row unchanged) and a succeeding port commits exactly one audit row
 * atomically.
 *
 * Runs as the non-owner runtime role so RLS is real. Skipped without DATABASE_URL.
 */
import { randomUUID } from 'node:crypto';

import {
  appendAuditEntryOnClient,
  currentAuditChainKey,
  toCreateAuditLogInput,
} from '@proctira/backend-audit';
import {
  closeSharedPgPools,
  createPrismaClient,
  getSharedPgPool,
  withPgTenant,
  type PgQueryable,
} from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { afterAll, describe, expect, it } from 'vitest';

import { PrismaStaffRepository } from './prisma-staff-repository.js';
import type {
  StaffTxnAuditClient,
  StaffTxnAuditEvent,
  StaffTxnAuditPort,
} from './staff-repository.js';
import { StaffService } from './staff-service.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'prisma-staff-txn-audit.live.test' });
const pool = DATABASE_URL ? getSharedPgPool() : null;
const live = Boolean(DATABASE_URL) && pool !== null;

/** Port that always throws — simulates an audit failure inside the mutation txn. */
const throwingAudit: StaffTxnAuditPort = {
  async appendAuditInTxn() {
    throw new Error('forced staff audit failure');
  },
};

/**
 * Port that writes a real audit row on the mutation's own transaction client
 * through the production keyed path (PRC-M200): `appendAuditEntryOnClient`
 * locks and advances the tenant chain head via the SECURITY DEFINER functions,
 * because the runtime role has no DML on audit_chain_heads (migration 294).
 * Same event mapping as the gateway's StaffTxnAuditPort.
 */
function recordingAudit(seen: StaffTxnAuditEvent[]): StaffTxnAuditPort {
  return {
    async appendAuditInTxn(client: StaffTxnAuditClient, event: StaffTxnAuditEvent) {
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
      seen.push(event);
    },
  };
}

describe.skipIf(!live)('PrismaStaffRepository same-transaction audit (PRC-M013, live)', () => {
  const prisma = DATABASE_URL ? createPrismaClient({ datasourceUrl: DATABASE_URL }) : null;

  afterAll(async () => {
    await prisma?.$disconnect();
    await closeSharedPgPools();
  });

  async function newStaff(service: StaffService, tenantId: string) {
    return service.create(tenantId, {
      firstName: 'Txn',
      lastName: 'Audit',
      dateOfBirth: '1980-01-01',
      identityNumber: `TA-${randomUUID().slice(0, 8)}`,
      contactPhone: '+15550000000',
      contactEmail: null,
      position: 'Teacher',
      customData: null,
    });
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

  /** PRC-M200: the tenant chain head and this entity's keyed audit rows. */
  async function chainState(
    tenantId: string,
    entityId: string,
  ): Promise<{ headSeq: number; rows: Array<{ keyId: string | null; chainSeq: number }> }> {
    return withPgTenant(pool!, tenantId, async (client) => {
      const head = await client.query(
        `SELECT head_seq FROM audit_chain_heads WHERE tenant_id = $1`,
        [tenantId],
      );
      const rows = await client.query(
        `SELECT key_id, chain_seq FROM audit_log_entries
          WHERE tenant_id = $1 AND entity_id = $2`,
        [tenantId, entityId],
      );
      const headRow = head.rows[0] as { head_seq: string | number } | undefined;
      return {
        headSeq: Number(headRow?.head_seq ?? 0),
        rows: (rows.rows as Array<{ key_id: string | null; chain_seq: string | number }>).map(
          (r) => ({
            keyId: r.key_id,
            chainSeq: Number(r.chain_seq),
          }),
        ),
      };
    });
  }

  it('rolls a staff UPDATE back when the in-transaction audit append fails', async () => {
    const tenantId = randomUUID();
    await ensurePgTestTenant(pool!, tenantId);
    // Seed the row with a repo that has no port (plain create, no audit).
    const seed = new StaffService(new PrismaStaffRepository(prisma!));
    const staff = await newStaff(seed, tenantId);

    const service = new StaffService(new PrismaStaffRepository(prisma!, throwingAudit));
    await expect(
      service.update(
        tenantId,
        staff.id,
        { position: 'Principal' },
        { actorId: 'u1', ipAddress: null, requestId: null },
      ),
    ).rejects.toThrow(/forced staff audit failure/);

    // The update must NOT have committed: the audit failure rolled the txn back.
    const after = await seed.getById(tenantId, staff.id);
    expect(after.position).toBe('Teacher');
    expect(await countAudit(tenantId, staff.id)).toBe(0);
  });

  it('rolls a staff OFFBOARD back when the in-transaction audit append fails', async () => {
    const tenantId = randomUUID();
    await ensurePgTestTenant(pool!, tenantId);
    const seed = new StaffService(new PrismaStaffRepository(prisma!));
    const staff = await newStaff(seed, tenantId);

    const service = new StaffService(new PrismaStaffRepository(prisma!, throwingAudit));
    await expect(
      service.offboard(tenantId, staff.id, { effectiveDate: '2026-01-01', reason: 'x' }, 'u1'),
    ).rejects.toThrow(/forced staff audit failure/);

    const status = await seed.getOffboardStatus(tenantId, staff.id);
    expect(status.offboardStatus).toBe('active');
    expect(status.employmentStatus).toBe('ACTIVE');
    expect(await countAudit(tenantId, staff.id)).toBe(0);
  });

  it('rolls a staff DELETE back when the in-transaction audit append fails', async () => {
    const tenantId = randomUUID();
    await ensurePgTestTenant(pool!, tenantId);
    const seed = new StaffService(new PrismaStaffRepository(prisma!));
    const staff = await newStaff(seed, tenantId);

    const service = new StaffService(new PrismaStaffRepository(prisma!, throwingAudit));
    await expect(
      service.delete(tenantId, staff.id, { actorId: 'u1', ipAddress: null, requestId: null }),
    ).rejects.toThrow(/forced staff audit failure/);

    // Still readable (not soft-deleted): the delete rolled back.
    const after = await seed.getById(tenantId, staff.id);
    expect(after.id).toBe(staff.id);
    expect(await countAudit(tenantId, staff.id)).toBe(0);
  });

  it('commits the staff UPDATE AND exactly one audit row atomically on success', async () => {
    const tenantId = randomUUID();
    await ensurePgTestTenant(pool!, tenantId);
    const seed = new StaffService(new PrismaStaffRepository(prisma!));
    const staff = await newStaff(seed, tenantId);

    const chainBefore = await chainState(tenantId, staff.id);
    const seen: StaffTxnAuditEvent[] = [];
    const service = new StaffService(new PrismaStaffRepository(prisma!, recordingAudit(seen)));
    const updated = await service.update(
      tenantId,
      staff.id,
      { position: 'Principal' },
      { actorId: 'u1', ipAddress: '10.0.0.1', requestId: 'req-1' },
    );

    expect(updated.position).toBe('Principal');
    expect(seen.map((e) => e.entityId)).toContain(staff.id);
    // Exactly one audit row for this staff id (no post-hoc double write).
    expect(await countAudit(tenantId, staff.id)).toBe(1);
    // PRC-M200: the row is keyed (key_id set) and sits at the advanced chain head.
    const chainAfter = await chainState(tenantId, staff.id);
    expect(chainAfter.headSeq).toBe(chainBefore.headSeq + 1);
    expect(chainAfter.rows).toEqual([
      { keyId: currentAuditChainKey().keyId, chainSeq: chainAfter.headSeq },
    ]);
  });
});
