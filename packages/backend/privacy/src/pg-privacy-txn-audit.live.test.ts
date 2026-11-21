/**
 * PRC-M013 (B07, Topic 5 Option A — PII export / privacy): a privacy erasure
 * state transition (approve/reject via /transition, execute, legal-hold block,
 * stalled-release) must write its durable audit row in the SAME database
 * transaction as the transition. A forced audit-append failure must roll the
 * state change back, so a crash between "erasure state committed" and "audit
 * written" can never leave an unaudited durable privacy-lifecycle mutation.
 *
 * Failing-first contract: on the BASE source the Pg privacy repository takes no
 * audit port and the service audits post-hoc, in a separate write, so forcing
 * the audit to throw still leaves the state change committed → the rollback
 * assertions fail. After the fix the throwing port rolls the transition back
 * (erasure row unchanged) and a succeeding port commits exactly one audit row
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
  getSharedPgPool,
  withPgTenant,
  type PgQueryable,
} from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { afterAll, describe, expect, it } from 'vitest';

import { PgPrivacyRepository } from './pg-privacy-repository.js';
import type {
  PrivacyTxnAuditClient,
  PrivacyTxnAuditEvent,
  PrivacyTxnAuditPort,
} from './privacy-repository.js';
import { PrivacyService } from './privacy-service.js';
import { RecordingSubjectAnonymizer } from './subject-anonymizer.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'pg-privacy-txn-audit.live.test' });
const pool = DATABASE_URL ? getSharedPgPool() : null;
const live = Boolean(DATABASE_URL) && pool !== null;

/** Port that always throws — simulates an audit failure inside the mutation txn. */
const throwingAudit: PrivacyTxnAuditPort = {
  async appendAuditInTxn() {
    throw new Error('forced privacy audit failure');
  },
};

/**
 * Port that writes a real audit row on the mutation's own transaction client
 * through the production keyed path (PRC-M200): `appendAuditEntryOnClient`
 * locks and advances the tenant chain head via the SECURITY DEFINER functions,
 * because the runtime role has no DML on audit_chain_heads (migration 294).
 * Same event mapping as the gateway's PrivacyTxnAuditPort.
 */
function recordingAudit(seen: PrivacyTxnAuditEvent[]): PrivacyTxnAuditPort {
  return {
    async appendAuditInTxn(client: PrivacyTxnAuditClient, event: PrivacyTxnAuditEvent) {
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

describe.skipIf(!live)(
  'PgPrivacyRepository same-transaction erasure audit (PRC-M013, live)',
  () => {
    afterAll(async () => {
      await closeSharedPgPools();
    });

    /** Seed an erasure request directly (no audit port) and return its id. */
    async function seedErasure(
      tenantId: string,
      status: 'requested' | 'approved',
    ): Promise<string> {
      const repo = new PgPrivacyRepository(pool!);
      const created = await repo.createErasureRequest({
        id: randomUUID(),
        tenantId,
        subjectType: 'student',
        subjectId: randomUUID(),
        status: 'requested',
        requestType: 'erasure',
        reason: 'test',
        requestedBy: 'seed',
        reviewedBy: null,
        statusReason: null,
        completedAt: null,
      });
      if (status === 'approved') {
        await repo.updateErasureRequest(created.id, tenantId, { status: 'approved' });
      }
      return created.id;
    }

    async function statusOf(tenantId: string, id: string): Promise<string | null> {
      return withPgTenant(pool!, tenantId, async (client) => {
        const res = await client.query(
          `SELECT status FROM privacy_erasure_requests WHERE id = $1 AND tenant_id = $2`,
          [id, tenantId],
        );
        const row = res.rows[0] as { status?: string } | undefined;
        return row?.status ?? null;
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

    it('rolls a /transition status change back when the in-transaction audit append fails', async () => {
      const tenantId = randomUUID();
      await ensurePgTestTenant(pool!, tenantId);
      const id = await seedErasure(tenantId, 'requested');

      const service = new PrivacyService(new PgPrivacyRepository(pool!, throwingAudit));
      await expect(
        service.transitionErasureRequest(id, tenantId, 'under_review', 'u1', 'ok', {
          ipAddress: '10.0.0.1',
        }),
      ).rejects.toThrow(/forced privacy audit failure/);

      // The transition must NOT have committed: the audit failure rolled it back.
      expect(await statusOf(tenantId, id)).toBe('requested');
      expect(await countAudit(tenantId, id)).toBe(0);
    });

    it('rolls an execute (status flip + job insert) back when the audit append fails', async () => {
      const tenantId = randomUUID();
      await ensurePgTestTenant(pool!, tenantId);
      const id = await seedErasure(tenantId, 'approved');

      const service = new PrivacyService(new PgPrivacyRepository(pool!, throwingAudit), {
        anonymizer: new RecordingSubjectAnonymizer(),
      });
      await expect(
        service.executeErasure(id, tenantId, 'u1', { ipAddress: '10.0.0.1' }),
      ).rejects.toThrow(/forced privacy audit failure/);

      // Still `approved`: the status flip + job insert + audit rolled back together.
      expect(await statusOf(tenantId, id)).toBe('approved');
      expect(await countAudit(tenantId, id)).toBe(0);
    });

    it('commits the /transition AND exactly one audit row atomically on success', async () => {
      const tenantId = randomUUID();
      await ensurePgTestTenant(pool!, tenantId);
      const id = await seedErasure(tenantId, 'requested');

      const chainBefore = await chainState(tenantId, id);
      const seen: PrivacyTxnAuditEvent[] = [];
      const service = new PrivacyService(new PgPrivacyRepository(pool!, recordingAudit(seen)));
      const updated = await service.transitionErasureRequest(
        id,
        tenantId,
        'under_review',
        'u1',
        'ok',
        {
          ipAddress: '10.0.0.1',
        },
      );

      expect(updated.status).toBe('under_review');
      expect(seen.map((e) => e.entityId)).toContain(id);
      // Exactly one audit row for this erasure id (no post-hoc double write).
      expect(await countAudit(tenantId, id)).toBe(1);
      // PRC-M200: the row is keyed (key_id set) and sits at the advanced chain head.
      const chainAfter = await chainState(tenantId, id);
      expect(chainAfter.headSeq).toBe(chainBefore.headSeq + 1);
      expect(chainAfter.rows).toEqual([
        { keyId: currentAuditChainKey().keyId, chainSeq: chainAfter.headSeq },
      ]);
    });
  },
);
