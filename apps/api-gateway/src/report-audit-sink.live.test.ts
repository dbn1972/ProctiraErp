/**
 * UAT-SEC-001 / PRC-L340 — live Postgres proof that the gateway's report catalogue audit port
 * (`reportCatalogueAuditPort`, mounted on `reportCataloguePlugin`) persists report events to
 * the keyed `audit_log_entries` chain as the runtime role, under the event's tenant only.
 *
 * Skipped without DATABASE_URL; the W3-TEST-03 live gate provides it.
 */
import { randomUUID } from 'node:crypto';

import { closeSharedPgPools, getSharedPgPool, withPgTenant } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { afterAll, describe, expect, it } from 'vitest';

import { reportCatalogueAuditPort } from './domain-audit-sink.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'report-audit-sink.live.test' });
const live = Boolean(DATABASE_URL);

afterAll(async () => {
  if (live) await closeSharedPgPools();
});

interface Row {
  tenant_id: string;
  entity_type: string;
  entity_id: string;
  operation: string;
  user_id: string;
  metadata: Record<string, unknown>;
  chain_seq: string | number | null;
}

describe('report catalogue audit port (live Postgres)', () => {
  it.skipIf(!live)(
    'persists generate and download-denied events as keyed audit_log_entries rows for the caller tenant',
    async () => {
      const pool = getSharedPgPool()!;
      const caller = randomUUID();
      const other = randomUUID();
      await ensurePgTestTenant(pool, caller);
      await ensurePgTestTenant(pool, other);
      const artifactId = randomUUID();
      const port = reportCatalogueAuditPort();
      expect(port).toBeDefined();

      await port!.record({
        tenantId: caller,
        actorId: 'live-report-admin',
        action: 'report.generate',
        reportKey: 'students_roster',
        artifactId,
        runId: randomUUID(),
        format: 'csv',
      });
      await port!.record({
        tenantId: caller,
        actorId: 'live-report-admin',
        action: 'report.download.denied',
        artifactId,
        reason: 'token_invalid',
      });

      const rows = await withPgTenant(pool, caller, async (client) => {
        const res = await client.query(
          `SELECT tenant_id, entity_type, entity_id, operation, user_id, metadata, chain_seq
             FROM audit_log_entries
            WHERE tenant_id = $1 AND entity_id = $2
            ORDER BY chain_seq`,
          [caller, artifactId],
        );
        return res.rows as Row[];
      });
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.metadata.regulated)).toEqual([
        'report.generate',
        'report.download.denied',
      ]);
      for (const row of rows) {
        expect(row).toMatchObject({
          tenant_id: caller,
          entity_type: 'report_artifact',
          entity_id: artifactId,
          operation: 'CREATE',
          user_id: 'live-report-admin',
        });
        expect(row.chain_seq).not.toBeNull();
      }
      expect(rows[1]!.metadata).toEqual({
        reason: 'token_invalid',
        read: true,
        regulated: 'report.download.denied',
        action: 'download.denied',
      });

      // Nothing is written under another tenant.
      const leaked = await withPgTenant(pool, other, async (client) => {
        const res = await client.query(`SELECT 1 FROM audit_log_entries WHERE entity_id = $1`, [
          artifactId,
        ]);
        return res.rowCount;
      });
      expect(leaked).toBe(0);
    },
  );
});
