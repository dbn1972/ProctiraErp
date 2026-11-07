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

import { closeSharedPgPools, getSharedPgPool, withPgTenant } from '@proctira/database';
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

/** Port that writes a real audit row on the mutation's own transaction client. */
function recordingAudit(seen: PrivacyTxnAuditEvent[]): PrivacyTxnAuditPort {
  return {
    async appendAuditInTxn(client: PrivacyTxnAuditClient, event: PrivacyTxnAuditEvent) {
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
    });
  },
);
