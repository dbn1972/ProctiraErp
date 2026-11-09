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

/**
 * Port that writes a real audit row on the mutation's own transaction client
 * through the production keyed path (PRC-M200): `appendAuditEntryOnClient`
 * locks and advances the tenant chain head via the SECURITY DEFINER functions,
 * because the runtime role has no DML on audit_chain_heads (migration 294).
 * Same event mapping as the gateway's StudentTxnAuditPort.
 */
function recordingAudit(seen: StudentTxnAuditEvent[]): StudentTxnAuditPort {
  return {
    async appendAuditInTxn(client: StudentTxnAuditClient, event: StudentTxnAuditEvent) {
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

    const chainBefore = await chainState(tenantId, student.id);
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
    // PRC-M200: the row is keyed (key_id set) and sits at the advanced chain head.
    const chainAfter = await chainState(tenantId, student.id);
    expect(chainAfter.headSeq).toBe(chainBefore.headSeq + 1);
    expect(chainAfter.rows).toEqual([
      { keyId: currentAuditChainKey().keyId, chainSeq: chainAfter.headSeq },
    ]);
  });
});
