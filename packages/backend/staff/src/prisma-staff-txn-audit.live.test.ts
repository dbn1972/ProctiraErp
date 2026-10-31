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
  closeSharedPgPools,
  createPrismaClient,
  getSharedPgPool,
  withPgTenant,
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

/** Port that writes a real audit row on the mutation's own transaction client. */
function recordingAudit(seen: StaffTxnAuditEvent[]): StaffTxnAuditPort {
  return {
    async appendAuditInTxn(client: StaffTxnAuditClient, event: StaffTxnAuditEvent) {
      await client.query(
        `INSERT INTO audit_chain_heads (tenant_id) VALUES ($1::uuid) ON CONFLICT (tenant_id) DO NOTHING`,
        [event.tenantId],
      );
      await client.query(
        `INSERT INTO audit_log_entries (
           id, tenant_id, entity_type, entity_id, operation, user_id, user_name,
           ip_address, occurred_at, before_values, after_values, metadata
         ) VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9::timestamptz,$10::jsonb,$11::jsonb,$12::jsonb)`,
        [
          randomUUID(),
          event.tenantId,
          event.entityType,
          event.entityId,
          event.operation,
          event.actorId ?? 'system',
          event.actorId ?? 'system',
          event.ipAddress ?? '0.0.0.0',
          new Date().toISOString(),
          event.beforeValues == null ? null : JSON.stringify(event.beforeValues),
          event.afterValues == null ? null : JSON.stringify(event.afterValues),
          JSON.stringify(event.metadata),
        ],
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
  });
});
