/**
 * PRC-L093 — live end-to-end proof that an outbox redrive reaches the keyed
 * audit trail (audit_log_entries), not only transactional_outbox.redrive_history.
 *
 * Path: PgOutboxStore.requeueFailed (platform-scoped, PLATFORM_WIDE_REDRIVE)
 * -> db/sql/310 trigger enqueues one audit_ingest_queue row per appended
 * history entry, bound to the row's own tenant -> the production drain
 * (createPgQueueSealer + runOnce) seals it into audit_log_entries -> the
 * tenant's keyed chain verifies.
 *
 * As in audit-ingest-drain.live.test.ts, the drain's pending-tenant listing is
 * narrowed to this test's tenants so it never seals other suites' rows.
 * Needs DATABASE_URL (runtime role); skipped without it.
 */
import { randomUUID } from 'node:crypto';

import {
  createAuditIngestDrain,
  currentAuditChainKey,
  PgAuditRepository,
  type QueueSealer,
} from '@proctira/backend-audit';
import { withPgTenant } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { PgOutboxStore, PLATFORM_WIDE_REDRIVE } from '@proctira/queue-abstraction';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { createPgQueueSealer } from './audit-ingest-drain.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'outbox-redrive-audit.live.test' });
const live = Boolean(DATABASE_URL);
const pool = live ? new pg.Pool({ connectionString: DATABASE_URL, max: 4 }) : null;

afterAll(async () => {
  await pool?.end();
});

async function seedFailedRow(tenantId: string): Promise<string> {
  const id = randomUUID();
  await withPgTenant(pool!, tenantId, async (client) => {
    await client.query(
      `INSERT INTO transactional_outbox
         (id, tenant_id, aggregate_type, aggregate_id, event_type, payload, status, attempts)
       VALUES ($1, $2, 'l093_probe', 'agg-1', 'l093.probe', '{}'::jsonb, 'failed', 5)`,
      [id, tenantId],
    );
  });
  return id;
}

describe('outbox redrive is mirrored into the audit trail (live Postgres)', () => {
  it.skipIf(!live)(
    'a platform-wide redrive lands one keyed audit entry per row in each row tenant',
    async () => {
      const tenantA = randomUUID();
      const tenantB = randomUUID();
      await ensurePgTestTenant(pool!, tenantA);
      await ensurePgTestTenant(pool!, tenantB);
      const rowA = await seedFailedRow(tenantA);
      const rowB = await seedFailedRow(tenantB);

      const store = new PgOutboxStore(pool!);
      const redriven = await store.requeueFailed({
        ids: [rowA, rowB],
        actor: 'ops-l093',
        reason: 'broker outage recovered',
        tenantId: PLATFORM_WIDE_REDRIVE,
      });
      expect(redriven.sort()).toEqual([rowA, rowB].sort());

      const ours = new Set<string>([tenantA, tenantB]);
      const real = createPgQueueSealer(pool!);
      const sealer: QueueSealer = {
        ...real,
        async listPendingTenants() {
          return (await real.listPendingTenants()).filter((t) => ours.has(t));
        },
      };
      const errors: unknown[] = [];
      const drain = createAuditIngestDrain({
        sealer,
        key: () => currentAuditChainKey(),
        logger: { info: () => undefined, error: (obj) => errors.push(obj) },
      });
      expect(await drain.runOnce()).toEqual({ tenants: 2, sealed: 2, failures: [] });
      expect(errors).toEqual([]);

      const repo = new PgAuditRepository(pool!);
      for (const [tenantId, rowId] of [
        [tenantA, rowA],
        [tenantB, rowB],
      ] as const) {
        const { rows } = (await withPgTenant(pool!, tenantId, (client) =>
          client.query(
            `SELECT entity_type, entity_id, operation, user_id,
                    metadata->>'action' AS action, metadata->>'reason' AS reason,
                    before_values->>'attempts' AS from_attempts
               FROM audit_log_entries
              WHERE tenant_id = $1 AND entity_id = $2`,
            [tenantId, rowId],
          ),
        )) as { rows: Array<Record<string, string>> };
        expect(rows).toEqual([
          {
            entity_type: 'transactional_outbox',
            entity_id: rowId,
            operation: 'UPDATE',
            user_id: 'ops-l093',
            action: 'outbox.redrive',
            reason: 'broker outage recovered',
            from_attempts: '5',
          },
        ]);
        const verified = await repo.verifyChain(tenantId);
        expect(verified.valid).toBe(true);
        expect(verified.checkedEntries).toBe(1);
      }
    },
  );
});
