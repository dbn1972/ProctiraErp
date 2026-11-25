/**
 * PRC-L147 live proof: tenant_theme_versions has a decommission-only erasure path
 * under dual control (DR48), and the runtime role cannot mutate it directly.
 *
 * db/sql/317: privacy_decommission_erase_theme_versions(offboard job) deletes the
 * bound tenant's branding history only for an in-progress offboard job approved by
 * a second actor, refuses under a legal hold, and enqueues the platform audit event
 * in the same transaction. Any other DELETE is still rejected, and the runtime role
 * is SELECT + INSERT only (append_only class).
 *
 * Skipped unless DATABASE_URL and MIGRATOR_DATABASE_URL are both set.
 */
import { randomUUID } from 'node:crypto';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { PgTenantWipeExecutor } from './domain-anonymizers.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'tenant-theme-decommission.live.test' });
const MIGRATOR_DATABASE_URL = process.env['MIGRATOR_DATABASE_URL']?.trim();
const runtimePool = DATABASE_URL ? new pg.Pool({ connectionString: DATABASE_URL, max: 2 }) : null;
const ownerPool = MIGRATOR_DATABASE_URL
  ? new pg.Pool({ connectionString: MIGRATOR_DATABASE_URL, max: 2 })
  : null;
const live = Boolean(runtimePool && ownerPool);

afterAll(async () => {
  await runtimePool?.end();
  await ownerPool?.end();
});

async function sql(
  pool: pg.Pool,
  tenantId: string,
  text: string,
  params: unknown[] = [],
): Promise<Array<Record<string, unknown>>> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_app_tenant_id($1)`, [tenantId]);
    const res = await client.query(text, params);
    await client.query('COMMIT');
    return res.rows as Array<Record<string, unknown>>;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const owner = (t: string, text: string, params: unknown[] = []) => sql(ownerPool!, t, text, params);
const runtime = (t: string, text: string, params: unknown[] = []) =>
  sql(runtimePool!, t, text, params);

async function codeOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (err) {
    return String((err as { code?: string }).code);
  }
}

/** Tenant with two published theme versions and an in-progress offboard job. */
async function seed(approvedBy: string | null) {
  const tenantId = randomUUID();
  await ensurePgTestTenant(ownerPool!, tenantId);
  for (const revision of [1, 2]) {
    await owner(
      tenantId,
      `INSERT INTO tenant_theme_versions (tenant_id, revision, tokens, published_at, published_by)
       VALUES ($1, $2, '{}'::jsonb, now(), $3)`,
      [tenantId, revision, randomUUID()],
    );
  }
  const jobId = randomUUID();
  await owner(
    tenantId,
    `INSERT INTO privacy_tenant_offboard_jobs (id, tenant_id, status, reason, requested_by)
     VALUES ($1, $2, 'in_progress', 'decommission probe', 'platform-1')`,
    [jobId, tenantId],
  );
  if (approvedBy) {
    await owner(
      tenantId,
      `UPDATE privacy_tenant_offboard_jobs SET approved_by = $2 WHERE id = $1`,
      [jobId, approvedBy],
    );
  }
  return { tenantId, jobId };
}

async function themeRows(tenantId: string): Promise<number> {
  const rows = await owner(
    tenantId,
    `SELECT count(*)::int AS n FROM tenant_theme_versions WHERE tenant_id = $1`,
    [tenantId],
  );
  return Number(rows[0]?.['n']);
}

describe.skipIf(!live)(
  'PRC-L147 tenant_theme_versions decommission erasure (live Postgres)',
  () => {
    it('the runtime role is append-only on tenant_theme_versions', async () => {
      const rows = await runtime(
        randomUUID(),
        `SELECT has_table_privilege('tenant_theme_versions', 'UPDATE') AS u,
              has_table_privilege('tenant_theme_versions', 'DELETE') AS d,
              has_table_privilege('tenant_theme_versions', 'INSERT') AS i`,
      );
      expect(rows[0]).toEqual({ u: false, d: false, i: true });
    });

    it('erases the branding history for a second-actor-approved offboard job, audited', async () => {
      const { tenantId, jobId } = await seed('platform-2');
      const rows = await runtime(
        tenantId,
        `SELECT privacy_decommission_erase_theme_versions($1) AS n`,
        [jobId],
      );
      expect(rows[0]?.['n']).toBe(2);
      expect(await themeRows(tenantId)).toBe(0);
      const audit = await owner(
        tenantId,
        `SELECT entity_type, operation, user_id, actor_kind, metadata
         FROM audit_ingest_queue WHERE tenant_id = $1 AND entity_type = 'tenant_theme_versions'`,
        [tenantId],
      );
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        operation: 'DELETE',
        user_id: 'platform-2',
        actor_kind: 'system:tenant-decommission',
        metadata: expect.objectContaining({
          offboardJobId: jobId,
          requestedBy: 'platform-1',
          approvedBy: 'platform-2',
          rowsDeleted: 2,
        }),
      });
    });

    it('refuses without a second-actor approval and keeps the rows', async () => {
      const { tenantId, jobId } = await seed(null);
      expect(
        await codeOf(
          runtime(tenantId, `SELECT privacy_decommission_erase_theme_versions($1)`, [jobId]),
        ),
      ).toBe('55000');
      expect(await themeRows(tenantId)).toBe(2);
    });

    it('the requester cannot be the approver', async () => {
      const { tenantId, jobId } = await seed(null);
      expect(
        await codeOf(
          owner(
            tenantId,
            `UPDATE privacy_tenant_offboard_jobs SET approved_by = requested_by WHERE id = $1`,
            [jobId],
          ),
        ),
      ).toBe('23514');
    });

    it('refuses while the tenant is on legal hold', async () => {
      const { tenantId, jobId } = await seed('platform-2');
      await owner(tenantId, `UPDATE tenants SET legal_hold = true WHERE id = $1`, [tenantId]);
      expect(
        await codeOf(
          runtime(tenantId, `SELECT privacy_decommission_erase_theme_versions($1)`, [jobId]),
        ),
      ).toBe('23000');
      expect(await themeRows(tenantId)).toBe(2);
    });

    it('a direct DELETE stays rejected, even by the owner with the flag forged', async () => {
      const { tenantId } = await seed('platform-2');
      expect(
        await codeOf(
          runtime(tenantId, `DELETE FROM tenant_theme_versions WHERE tenant_id = $1`, [tenantId]),
        ),
      ).not.toBeNull();
      const client = await ownerPool!.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_app_tenant_id($1)`, [tenantId]);
        await client.query(`SELECT set_config('app.privacy_decommission_erasure', $1, true)`, [
          randomUUID(),
        ]);
        expect(
          await codeOf(
            client.query(`DELETE FROM tenant_theme_versions WHERE tenant_id = $1`, [tenantId]),
          ),
        ).toBe('0A000');
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
      expect(await themeRows(tenantId)).toBe(2);
    });

    it('the tenant wipe erases the history when approved and reports a residual otherwise', async () => {
      const approved = await seed('platform-2');
      const executor = new PgTenantWipeExecutor(runtimePool!);
      const ok = await executor.wipe({
        tenantId: approved.tenantId,
        jobId: approved.jobId,
        reason: 'probe',
      });
      expect(ok.find((r) => r.domain === 'decommission_only')).toMatchObject({
        status: 'completed',
      });
      expect(await themeRows(approved.tenantId)).toBe(0);

      const pending = await seed(null);
      const refused = await executor.wipe({
        tenantId: pending.tenantId,
        jobId: pending.jobId,
        reason: 'probe',
      });
      expect(refused.find((r) => r.domain === 'decommission_only')).toMatchObject({
        status: 'residual',
      });
      expect(await themeRows(pending.tenantId)).toBe(2);
    });
  },
);
