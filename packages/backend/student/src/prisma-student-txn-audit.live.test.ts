/**
 * PRC-M013 (B07, Topic 5 Option A — student PII): a student PII mutation
 * (update / delete) must write its durable audit row in the SAME database
 * transaction as the mutation. A forced audit-append failure must roll the
 * student change back, so a crash between "student committed" and "audit
 * written" can never leave an unaudited durable student PII mutation.
 *
 * Failing-first contract: on the BASE source the Prisma student repository takes
 * no audit port and the student PII mutation is audited (at best) post-hoc, in a
 * separate transaction (the gateway domain-audit-sink), so forcing the audit to
 * throw still leaves the student change committed → the rollback assertions fail.
 * After the fix the throwing port rolls the mutation back (student row unchanged)
 * and a succeeding port commits exactly one audit row atomically.
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

import { PrismaStudentRepository } from './prisma-student-repository.js';
import type {
  StudentTxnAuditClient,
  StudentTxnAuditEvent,
  StudentTxnAuditPort,
} from './student-repository.js';
import { StudentService } from './student-service.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'prisma-student-txn-audit.live.test' });
const pool = DATABASE_URL ? getSharedPgPool() : null;
const live = Boolean(DATABASE_URL) && pool !== null;

/** Port that always throws — simulates an audit failure inside the mutation txn. */
const throwingAudit: StudentTxnAuditPort = {
  async appendAuditInTxn() {
    throw new Error('forced student audit failure');
  },
};

/** Port that writes a real audit row on the mutation's own transaction client. */
function recordingAudit(seen: StudentTxnAuditEvent[]): StudentTxnAuditPort {
  return {
    async appendAuditInTxn(client: StudentTxnAuditClient, event: StudentTxnAuditEvent) {
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

describe.skipIf(!live)('PrismaStudentRepository same-transaction audit (PRC-M013, live)', () => {
  const prisma = DATABASE_URL ? createPrismaClient({ datasourceUrl: DATABASE_URL }) : null;

  afterAll(async () => {
    await prisma?.$disconnect();
    await closeSharedPgPools();
  });

  async function newStudent(service: StudentService, tenantId: string) {
    return service.create(tenantId, {
      firstName: 'Txn',
      lastName: 'Audit',
      dateOfBirth: '2010-01-01',
      gender: 'other',
      nationalId: `TA-${randomUUID().slice(0, 8)}`,
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

  it('rolls a student UPDATE back when the in-transaction audit append fails', async () => {
    const tenantId = randomUUID();
    await ensurePgTestTenant(pool!, tenantId);
    // Seed the row with a repo that has no port (plain create, no audit).
    const seed = new StudentService(new PrismaStudentRepository(prisma!));
    const student = await newStudent(seed, tenantId);

    const service = new StudentService(new PrismaStudentRepository(prisma!, throwingAudit));
    await expect(
      service.update(
        tenantId,
        student.id,
        { lastName: 'Changed' },
        {},
        { actorId: 'u1', ipAddress: null, requestId: null },
      ),
    ).rejects.toThrow(/forced student audit failure/);

    // The update must NOT have committed: the audit failure rolled the txn back.
    const after = await seed.getById(tenantId, student.id);
    expect(after.lastName).toBe('Audit');
    expect(await countAudit(tenantId, student.id)).toBe(0);
  });

  it('rolls a student DELETE back when the in-transaction audit append fails', async () => {
    const tenantId = randomUUID();
    await ensurePgTestTenant(pool!, tenantId);
    const seed = new StudentService(new PrismaStudentRepository(prisma!));
    const student = await newStudent(seed, tenantId);

    const service = new StudentService(new PrismaStudentRepository(prisma!, throwingAudit));
    await expect(
      service.delete(tenantId, student.id, { actorId: 'u1', ipAddress: null, requestId: null }),
    ).rejects.toThrow(/forced student audit failure/);

    // Still readable (not soft-deleted): the delete rolled back.
    const after = await seed.getById(tenantId, student.id);
    expect(after.id).toBe(student.id);
    expect(await countAudit(tenantId, student.id)).toBe(0);
  });

  it('commits the student UPDATE AND exactly one audit row atomically on success', async () => {
    const tenantId = randomUUID();
    await ensurePgTestTenant(pool!, tenantId);
    const seed = new StudentService(new PrismaStudentRepository(prisma!));
    const student = await newStudent(seed, tenantId);

    const seen: StudentTxnAuditEvent[] = [];
    const service = new StudentService(new PrismaStudentRepository(prisma!, recordingAudit(seen)));
    const updated = await service.update(
      tenantId,
      student.id,
      { lastName: 'Changed' },
      {},
      { actorId: 'u1', ipAddress: '10.0.0.1', requestId: 'req-1' },
    );

    expect(updated.lastName).toBe('Changed');
    expect(seen.map((e) => e.entityId)).toContain(student.id);
    // Exactly one audit row for this student id (no post-hoc double write).
    expect(await countAudit(tenantId, student.id)).toBe(1);
  });
});
