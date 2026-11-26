/**
 * PRC-L098: ETL pipeline events and failure alerts land in the real
 * `transactional_outbox` table (as the runtime role, RLS enforced), where the
 * outbox relay publishes them. Skipped without DATABASE_URL (required in CI).
 */
import { randomUUID } from 'node:crypto';

import {
  ETL_PIPELINE_FAILURE_ALERT_TYPE,
  OutboxAdminNotifier,
  OutboxPipelineEventPublisher,
} from '@proctira/backend-etl';
import { withPgTenant } from '@proctira/database';
import { PgOutboxStore } from '@proctira/queue-abstraction';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

const liveTestsRequired =
  process.env.ALLOW_LIVE_TEST_SKIP !== '1' &&
  (process.env.REQUIRE_LIVE_TESTS === '1' || process.env.CI === 'true' || process.env.CI === '1');
const DATABASE_URL = process.env.DATABASE_URL?.trim();
if (!DATABASE_URL && liveTestsRequired) {
  throw new Error('[W3-TEST-03] etl-outbox-events.live.test has no DATABASE_URL');
}
const pool = DATABASE_URL ? new pg.Pool({ connectionString: DATABASE_URL, max: 2 }) : null;

describe.skipIf(!pool)('ETL outbox events (live) — PRC-L098', () => {
  const tenant = randomUUID();
  const pipelineId = randomUUID();
  const executionId = randomUUID();

  afterAll(async () => {
    await pool?.end();
  });

  it('writes the lifecycle event and the failure alert as pending published rows', async () => {
    await withPgTenant(pool!, tenant, (c) =>
      c.query(
        `INSERT INTO tenants (id, name, slug, config, status)
         VALUES ($1::uuid, $2, $3, '{}'::jsonb, 'active') ON CONFLICT (id) DO NOTHING`,
        [tenant, `ETL ${tenant.slice(0, 8)}`, `etl-${tenant}`],
      ),
    );
    const store = new PgOutboxStore(pool!);
    await new OutboxPipelineEventPublisher(store).publish({
      type: 'pipeline.execution.failed',
      timestamp: new Date('2026-09-09T07:00:00.000Z'),
      tenantId: tenant,
      pipelineId,
      executionId,
      payload: { pipelineName: 'Nightly', error: 'boom', attempt: 2, retriesExhausted: true },
    });
    await new OutboxAdminNotifier(store).notifyFinalFailure({
      pipelineId,
      pipelineName: 'Nightly',
      tenantId: tenant,
      executionId,
      totalAttempts: 2,
      lastError: 'boom',
      failedAt: new Date('2026-09-09T07:00:01.000Z'),
    });

    const rows = await withPgTenant(pool!, tenant, async (c) => {
      const res = await c.query(
        `SELECT event_type, aggregate_type, aggregate_id, status, payload, metadata
           FROM transactional_outbox WHERE tenant_id = $1::uuid ORDER BY event_type`,
        [tenant],
      );
      return res.rows as Array<Record<string, unknown>>;
    });
    expect(rows.map((r) => r['event_type'])).toEqual([
      'etl.pipeline.execution.failed',
      ETL_PIPELINE_FAILURE_ALERT_TYPE,
    ]);
    for (const row of rows) {
      expect(row).toMatchObject({
        aggregate_type: 'etl_pipeline',
        aggregate_id: pipelineId,
        status: 'pending',
      });
      expect(row['metadata']).toMatchObject({ dispatchMode: 'publish' });
    }
    expect(rows[0]!['payload']).toMatchObject({ type: 'pipeline.execution.failed', executionId });
    expect(rows[1]!['payload']).toMatchObject({ executionId, lastError: 'boom' });

    // Another tenant cannot read these rows (RLS).
    const other = await withPgTenant(pool!, randomUUID(), async (c) => {
      const res = await c.query(`SELECT 1 FROM transactional_outbox WHERE aggregate_id = $1`, [
        pipelineId,
      ]);
      return res.rows.length;
    });
    expect(other).toBe(0);
  });
});
