/**
 * PRC-L093 — live Postgres red-then-green proof that
 * `transactional_outbox.redrive_history` is append-only.
 *
 * Before db/sql/242: a direct `UPDATE transactional_outbox SET
 * redrive_history = '[]'::jsonb` (or any mutation of an existing entry)
 * succeeds, silently erasing redrive audit history.
 * After 242: shrinking or mutating an existing entry is rejected, while a
 * legitimate append (`redrive_history || jsonb_build_object(...)`, the exact
 * shape OutboxStore.requeueFailed uses) still succeeds.
 *
 * Requires DATABASE_URL as proctira_app against a DB migrated through 101.
 * Optional MIGRATOR_DATABASE_URL (table-owning role) is used to drop/restore
 * the 242 trigger for the red phase; when unset, the red phase is skipped.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = requireLiveDatabaseUrl({
  suite: 'outbox-redrive-history-append-only.live.test',
});
const MIGRATOR_DATABASE_URL = process.env['MIGRATOR_DATABASE_URL'];

const MIGRATION_242 = '242_outbox_redrive_history_append_only.sql';
const TRIGGER_NAME = 'trg_transactional_outbox_redrive_history_append_only';

function load242(): string {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
  return readFileSync(path.join(root, 'db/sql', MIGRATION_242), 'utf8');
}

describe.skipIf(!DATABASE_URL)('PRC-L093 outbox redrive_history append-only (live)', () => {
  let pool: pg.Pool;
  let migrator: pg.Pool | undefined;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    if (MIGRATOR_DATABASE_URL) {
      migrator = new pg.Pool({ connectionString: MIGRATOR_DATABASE_URL });
    }
  });

  afterAll(async () => {
    await pool.end();
    await migrator?.end();
  });

  async function seedOutboxRow(
    client: pg.PoolClient,
    initialHistory: unknown[],
  ): Promise<{ tenantId: string; rowId: string }> {
    const tenantId = randomUUID();
    const rowId = randomUUID();
    const suffix = tenantId.slice(0, 8);
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    await client.query(`SELECT set_config('app.platform_admin', '1', true)`);
    await client.query(
      `INSERT INTO tenants (id, name, slug, status) VALUES ($1, $2, $3, 'active')
       ON CONFLICT (id) DO NOTHING`,
      [tenantId, `l093-${suffix}`, `l093-${suffix}`],
    );
    await client.query(
      `INSERT INTO transactional_outbox (
         id, tenant_id, aggregate_type, aggregate_id, event_type, payload, status, redrive_history
       ) VALUES ($1, $2, 'test_aggregate', 'agg-1', 'test.event', '{}'::jsonb, 'failed', $3::jsonb)`,
      [rowId, tenantId, JSON.stringify(initialHistory)],
    );
    return { tenantId, rowId };
  }

  it.skipIf(!MIGRATOR_DATABASE_URL)(
    'RED: without the trigger, shrinking redrive_history succeeds',
    async () => {
      const m = migrator!;
      try {
        await m.query(`DROP TRIGGER IF EXISTS ${TRIGGER_NAME} ON transactional_outbox`);

        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const { tenantId, rowId } = await seedOutboxRow(client, [
            { at: '2026-01-01T00:00:00Z', actor: 'ops-1', reason: 'retry', fromAttempts: 1 },
            { at: '2026-01-02T00:00:00Z', actor: 'ops-1', reason: 'retry', fromAttempts: 2 },
          ]);
          await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

          // The bug: this UPDATE is accepted and erases both history entries.
          await client.query(
            `UPDATE transactional_outbox SET redrive_history = '[]'::jsonb WHERE id = $1`,
            [rowId],
          );
          const { rows } = await client.query<{ len: number }>(
            `SELECT jsonb_array_length(redrive_history) AS len FROM transactional_outbox WHERE id = $1`,
            [rowId],
          );
          expect(rows[0]!.len).toBe(0);

          await client.query('ROLLBACK');
        } finally {
          client.release();
        }
      } finally {
        await m.query(load242());
      }
    },
  );

  it('GREEN: shrinking or mutating an existing redrive_history entry is rejected', async () => {
    if (migrator) {
      await migrator.query(load242());
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { tenantId, rowId } = await seedOutboxRow(client, [
        { at: '2026-01-01T00:00:00Z', actor: 'ops-1', reason: 'retry', fromAttempts: 1 },
        { at: '2026-01-02T00:00:00Z', actor: 'ops-1', reason: 'retry', fromAttempts: 2 },
      ]);
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

      await client.query('SAVEPOINT sp_shrink');
      await expect(
        client.query(
          `UPDATE transactional_outbox SET redrive_history = '[]'::jsonb WHERE id = $1`,
          [rowId],
        ),
      ).rejects.toThrow(/append-only/i);
      await client.query('ROLLBACK TO SAVEPOINT sp_shrink');

      await client.query('SAVEPOINT sp_mutate');
      await expect(
        client.query(
          `UPDATE transactional_outbox
             SET redrive_history = jsonb_set(redrive_history, '{0,actor}', '"tampered"'::jsonb)
           WHERE id = $1`,
          [rowId],
        ),
      ).rejects.toThrow(/append-only/i);
      await client.query('ROLLBACK TO SAVEPOINT sp_mutate');

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('GREEN: a legitimate append (||) still succeeds and the array grows', async () => {
    if (migrator) {
      await migrator.query(load242());
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { tenantId, rowId } = await seedOutboxRow(client, [
        { at: '2026-01-01T00:00:00Z', actor: 'ops-1', reason: 'retry', fromAttempts: 1 },
      ]);
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

      // Mirrors OutboxStore.requeueFailed's real append shape
      // (packages/shared/queue-abstraction/src/outbox/pg-outbox-store.ts).
      await client.query(
        `UPDATE transactional_outbox
           SET status = 'pending',
               attempts = 0,
               last_error = NULL,
               redrive_history = redrive_history || jsonb_build_object(
                 'at', $2::text, 'actor', $3::text, 'reason', $4::text, 'fromAttempts', 2
               )
         WHERE id = $1`,
        [rowId, '2026-01-03T00:00:00Z', 'ops-2', 'manual redrive'],
      );

      const { rows } = await client.query<{ len: number; last_actor: string }>(
        `SELECT jsonb_array_length(redrive_history) AS len,
                redrive_history -> -1 ->> 'actor' AS last_actor
         FROM transactional_outbox WHERE id = $1`,
        [rowId],
      );
      expect(rows[0]!.len).toBe(2);
      expect(rows[0]!.last_actor).toBe('ops-2');

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('GREEN: updating unrelated columns (status, locked_until) is unaffected', async () => {
    if (migrator) {
      await migrator.query(load242());
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { tenantId, rowId } = await seedOutboxRow(client, []);
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

      await client.query(
        `UPDATE transactional_outbox SET status = 'pending', attempts = 1 WHERE id = $1`,
        [rowId],
      );
      const { rows } = await client.query<{ status: string; attempts: number }>(
        `SELECT status, attempts FROM transactional_outbox WHERE id = $1`,
        [rowId],
      );
      expect(rows[0]).toEqual({ status: 'pending', attempts: 1 });

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
