/**
 * PRC-M209 — live Postgres red-then-green proof that
 * institution_repair_requests status transitions are enforced at the DB
 * layer, and the runtime role's long-standing inability to UPDATE this
 * table (db/sql/106 only granted SELECT, INSERT; PgInfrastructureStore's
 * updateRepairRequestStatus comment and 42501 handling document this
 * "not enabled yet" state explicitly) is closed by db/sql/247.
 *
 * Before db/sql/247: the runtime role (proctira_app) gets 42501 permission
 * denied on ANY UPDATE of institution_repair_requests (matching pg-store.ts's
 * own comment about the current denied state).
 * After 247: the runtime role can UPDATE the status column through the
 * allowed open<->closed transitions, the trigger itself rejects any other
 * status value transition (even as the table owner, bypassing the grant),
 * and the runtime role still cannot UPDATE any other column.
 *
 * Requires DATABASE_URL as proctira_app against a DB migrated through 106.
 * Optional MIGRATOR_DATABASE_URL (table-owning role) is used to apply/revert
 * 247 for the red phase and to prove the trigger itself (not just the
 * grant) rejects invalid transitions; when unset, the red phase and the
 * owner-level trigger check are skipped.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = requireLiveDatabaseUrl({
  suite: 'repair-request-transition-guard.live.test',
});
const MIGRATOR_DATABASE_URL = process.env['MIGRATOR_DATABASE_URL'];

const MIGRATION_247 = '247_institution_repair_request_transition_guard.sql';
const TRIGGER_NAME = 'trg_institution_repair_requests_transition_guard';

function load247(): string {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
  return readFileSync(path.join(root, 'db/sql', MIGRATION_247), 'utf8');
}

describe.skipIf(!DATABASE_URL)('PRC-M209 repair request transition guard (live)', () => {
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

  async function seedRepairRequest(client: pg.PoolClient): Promise<{
    tenantId: string;
    requestId: string;
    institutionId: string;
    infrastructureId: string;
  }> {
    const tenantId = randomUUID();
    const institutionId = randomUUID();
    const infrastructureId = randomUUID();
    const requestId = randomUUID();
    await ensurePgTestTenant(pool, tenantId);
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    await client.query(`SELECT set_config('app.platform_admin', '1', true)`);
    await client.query(
      `INSERT INTO institution_infrastructure (id, tenant_id, institution_id, name, type, capacity, condition)
       VALUES ($1, $2, $3, 'Land fixture', 'LAND', 10, 'Good')`,
      [infrastructureId, tenantId, institutionId],
    );
    await client.query(
      `INSERT INTO institution_repair_requests (
         id, tenant_id, institution_id, infrastructure_id, summary, status
       ) VALUES ($1, $2, $3, $4, 'Leak', 'open')`,
      [requestId, tenantId, institutionId, infrastructureId],
    );
    return { tenantId, requestId, institutionId, infrastructureId };
  }

  it.skipIf(!MIGRATOR_DATABASE_URL)(
    'RED: before 247, proctira_app gets 42501 on any UPDATE of institution_repair_requests',
    async () => {
      const m = migrator!;
      try {
        // 247 may already be applied on this database (idempotent re-apply
        // elsewhere), so revoke the column grant it adds to reproduce the
        // pre-247 denied state.
        await m.query(
          `REVOKE UPDATE (status) ON TABLE institution_repair_requests FROM proctira_app`,
        );

        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const { requestId } = await seedRepairRequest(client);

          await expect(
            client.query(`UPDATE institution_repair_requests SET status = 'closed' WHERE id = $1`, [
              requestId,
            ]),
          ).rejects.toMatchObject({ code: '42501' });

          await client.query('ROLLBACK');
        } catch (err) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw err;
        } finally {
          client.release();
        }
      } finally {
        // Ensure 247 (including the grant) is restored for the GREEN tests
        // below regardless of this test's outcome.
        await m.query(load247());
      }
    },
  );

  it('GREEN: proctira_app can close then reopen through the allowed transitions', async () => {
    if (migrator) await migrator.query(load247());

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { requestId } = await seedRepairRequest(client);

      const closed = await client.query<{ status: string }>(
        `UPDATE institution_repair_requests SET status = 'closed' WHERE id = $1 RETURNING status`,
        [requestId],
      );
      expect(closed.rows[0]!.status).toBe('closed');

      const reopened = await client.query<{ status: string }>(
        `UPDATE institution_repair_requests SET status = 'open' WHERE id = $1 RETURNING status`,
        [requestId],
      );
      expect(reopened.rows[0]!.status).toBe('open');

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('GREEN: a same-status no-op UPDATE succeeds', async () => {
    if (migrator) await migrator.query(load247());

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { requestId } = await seedRepairRequest(client);

      await client.query(`UPDATE institution_repair_requests SET status = 'open' WHERE id = $1`, [
        requestId,
      ]);

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('GREEN: proctira_app still cannot UPDATE any other column (42501)', async () => {
    if (migrator) await migrator.query(load247());

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { requestId } = await seedRepairRequest(client);

      await expect(
        client.query(`UPDATE institution_repair_requests SET summary = 'tampered' WHERE id = $1`, [
          requestId,
        ]),
      ).rejects.toMatchObject({ code: '42501' });

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it.skipIf(!MIGRATOR_DATABASE_URL)(
    'GREEN: the trigger itself rejects an invalid status transition, even for the table owner',
    async () => {
      await migrator!.query(load247());

      const m = migrator!;
      const client = await m.connect();
      try {
        await client.query('BEGIN');
        const { requestId } = await seedRepairRequest(client);

        await expect(
          client.query(`UPDATE institution_repair_requests SET status = 'resolved' WHERE id = $1`, [
            requestId,
          ]),
        ).rejects.toThrow(/invalid status transition/i);

        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    },
  );
});
