/**
 * Live Postgres proof of the gateway audit ingest drain (PRC-M200, UAT-DB-002).
 *
 * Drives the production QueueSealer (`createPgQueueSealer`) through the drain
 * engine's `runOnce` as the runtime role (DATABASE_URL, e.g. proctira_app):
 *
 *   listPendingTenants -> withPlatformScope + audit_ingest_pending_tenants()
 *   withTenant         -> lockHead / loadPending / seal under the tenant GUC
 *
 * Two fresh tenants get queue rows; one `runOnce` must seal them all, a second
 * finds nothing for them, and each tenant's keyed chain verifies. The real
 * pending-tenant listing is called on every tick, but its result is narrowed
 * to this test's tenants so the drain never seals rows other suites enqueued
 * on the shared database. Skipped without DATABASE_URL.
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
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { createPgQueueSealer } from './audit-ingest-drain.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'audit-ingest-drain.live.test' });
const live = Boolean(DATABASE_URL);
const pool = live ? new pg.Pool({ connectionString: DATABASE_URL, max: 4 }) : null;

afterAll(async () => {
  await pool?.end();
});

async function enqueue(tenantId: string, n: number): Promise<void> {
  await withPgTenant(pool!, tenantId, async (client) => {
    for (let i = 0; i < n; i += 1) {
      await client.query(
        `INSERT INTO audit_ingest_queue
           (tenant_id, entity_type, entity_id, operation, actor_kind, dedupe_key)
         VALUES ($1, 'drain-probe', $2, 'CREATE', 'system:test', $3)`,
        [tenantId, `probe-${i}`, randomUUID()],
      );
    }
  });
}

describe('gateway audit ingest drain (live Postgres)', () => {
  it.skipIf(!live)(
    'runOnce lists pending tenants in platform scope, seals their queue rows and the keyed chain verifies',
    async () => {
      const tenantA = randomUUID();
      const tenantB = randomUUID();
      await ensurePgTestTenant(pool!, tenantA);
      await ensurePgTestTenant(pool!, tenantB);
      await enqueue(tenantA, 3);
      await enqueue(tenantB, 1);

      const ours = new Set<string>([tenantA, tenantB]);
      const listings: string[][] = [];
      const real = createPgQueueSealer(pool!);
      const sealer: QueueSealer = {
        ...real,
        async listPendingTenants() {
          const all = await real.listPendingTenants();
          listings.push(all);
          return all.filter((t) => ours.has(t));
        },
      };
      const errors: unknown[] = [];
      const drain = createAuditIngestDrain({
        sealer,
        key: () => currentAuditChainKey(),
        logger: { info: () => undefined, error: (obj) => errors.push(obj) },
      });

      const first = await drain.runOnce();
      // The production listing (platform scope, runtime role) saw both tenants.
      expect(listings[0]).toEqual(expect.arrayContaining([tenantA, tenantB]));
      expect(first).toEqual({ tenants: 2, sealed: 4, failures: [] });
      expect(errors).toEqual([]);

      const second = await drain.runOnce();
      expect(listings[1]).not.toContain(tenantA);
      expect(listings[1]).not.toContain(tenantB);
      expect(second).toEqual({ tenants: 0, sealed: 0, failures: [] });

      const repo = new PgAuditRepository(pool!);
      for (const [tenantId, n] of [
        [tenantA, 3],
        [tenantB, 1],
      ] as const) {
        const unsealed = (await withPgTenant(pool!, tenantId, (client) =>
          client.query(
            `SELECT count(*)::int AS n FROM audit_ingest_queue
              WHERE tenant_id = $1 AND sealed_at IS NULL`,
            [tenantId],
          ),
        )) as { rows: Array<{ n: number }> };
        expect(unsealed.rows[0]!.n).toBe(0);
        const verified = await repo.verifyChain(tenantId);
        expect(verified.valid).toBe(true);
        expect(verified.brokenAt).toBeNull();
        expect(verified.checkedEntries).toBe(n);
        expect(verified.headSeq).toBe(n);
      }
    },
  );
});
