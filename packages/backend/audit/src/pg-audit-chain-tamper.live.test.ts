/**
 * Live Postgres proof that the audit hash chain is tamper-evident (G-913).
 *
 * `audit-hash.ts` claims the chain detects any edit, deletion or re-ordering
 * "even by a DBA who disabled the append-only trigger". That is the module's
 * central integrity guarantee and it cannot be proven against an in-memory
 * store, because the claim is specifically about someone with database-level
 * privileges defeating the trigger.
 *
 * Two connections are used:
 *   - the runtime pool (`DATABASE_URL`, e.g. `proctira_app`) writes and verifies
 *   - an owner pool (`MIGRATOR_DATABASE_URL`) plays the hostile DBA
 *
 * `audit_log_entries` has FORCE ROW LEVEL SECURITY, which applies to the table
 * owner as well. A non-superuser DBA therefore sees **no rows at all** until it
 * binds `app.tenant_id` — asserted directly below, because it is a real defence
 * layer independent of the append-only trigger. Every tampering statement here
 * binds the GUC first and asserts `rowCount`, so a silent zero-row no-op can
 * never be mistaken for a passing tamper test.
 *
 * Skipped unless both connection strings are set. Only ever run this against a
 * disposable database: the trigger is briefly disabled and restored.
 */
import { randomUUID } from 'node:crypto';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import type { CreateAuditLogInput } from './audit-repository.js';
import { PgAuditRepository } from './pg-audit-repository.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'pg-audit-chain-tamper.live.test' });
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

function entry(tenantId: string, n: number): CreateAuditLogInput {
  return {
    id: randomUUID(),
    tenantId,
    entityType: 'chain-probe',
    entityId: `probe-${n}`,
    operation: 'UPDATE',
    userId: randomUUID(),
    userName: `probe-user-${n}`,
    ipAddress: '203.0.113.7',
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, n)),
    beforeValues: { seq: n - 1 },
    afterValues: { seq: n },
    metadata: { probe: true },
  };
}

/** Fresh tenant per test so chain sequences never collide across runs. */
async function seedChain(length: number): Promise<{ tenantId: string; repo: PgAuditRepository }> {
  const tenantId = randomUUID();
  await ensurePgTestTenant(ownerPool!, tenantId);
  const repo = new PgAuditRepository(runtimePool!);
  for (let n = 1; n <= length; n += 1) {
    await repo.create(entry(tenantId, n));
  }
  return { tenantId, repo };
}

/**
 * Run `fn` on the owner connection as a DBA scoped to `tenantId`, with the
 * append-only trigger disabled. Binding `app.tenant_id` is required because
 * FORCE RLS applies to the owner too. The trigger is always restored.
 */
async function asHostileDba<T>(
  tenantId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await ownerPool!.connect();
  try {
    await client.query('SELECT set_config($1, $2, false)', ['app.tenant_id', tenantId]);
    await client.query('ALTER TABLE audit_log_entries DISABLE TRIGGER trg_audit_log_append_only');
    return await fn(client);
  } finally {
    await client
      .query('ALTER TABLE audit_log_entries ENABLE TRIGGER trg_audit_log_append_only')
      .catch(() => undefined);
    client.release();
  }
}

describe('audit hash chain tamper-evidence (live Postgres)', () => {
  it.skipIf(!live)('an untampered chain verifies clean', async () => {
    const { tenantId, repo } = await seedChain(4);

    const result = await repo.verifyChain(tenantId);

    expect(result.valid).toBe(true);
    expect(result.brokenAt).toBeNull();
    expect(result.checkedEntries).toBe(4);
    expect(result.headSeq).toBe(4);
    expect(result.headHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it.skipIf(!live)(
    'FORCE RLS hides audit rows from the owner until a tenant GUC is bound',
    async () => {
      const { tenantId } = await seedChain(2);
      const client = await ownerPool!.connect();
      try {
        // A superuser (or BYPASSRLS) connection is exempt from FORCE RLS, so this
        // property is only observable for a normal owner/migrator role. CI uses
        // such a role; a developer pointing MIGRATOR_DATABASE_URL at `postgres`
        // would not, and must not get a false failure.
        const { rows } = await client.query<{ exempt: boolean }>(
          `SELECT (rolsuper OR rolbypassrls) AS exempt FROM pg_roles WHERE rolname = current_user`,
        );
        const rlsExempt = rows[0]?.exempt === true;

        const blind = await client.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM audit_log_entries WHERE tenant_id = $1',
          [tenantId],
        );
        expect(blind.rows[0]!.n).toBe(rlsExempt ? 2 : 0);

        // Same connection, same query, once the tenant is bound.
        await client.query('SELECT set_config($1, $2, false)', ['app.tenant_id', tenantId]);
        const scoped = await client.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM audit_log_entries WHERE tenant_id = $1',
          [tenantId],
        );
        expect(scoped.rows[0]!.n).toBe(2);
      } finally {
        client.release();
      }
    },
  );

  it.skipIf(!live)(
    'the append-only trigger blocks UPDATE and DELETE even for the table owner',
    async () => {
      const { tenantId } = await seedChain(2);
      const client = await ownerPool!.connect();
      try {
        await client.query('SELECT set_config($1, $2, false)', ['app.tenant_id', tenantId]);

        await expect(
          client.query(`UPDATE audit_log_entries SET user_name = 'tampered' WHERE tenant_id = $1`, [
            tenantId,
          ]),
        ).rejects.toThrow();

        await expect(
          client.query(`DELETE FROM audit_log_entries WHERE tenant_id = $1`, [tenantId]),
        ).rejects.toThrow();
      } finally {
        client.release();
      }
    },
  );

  it.skipIf(!live)(
    'a hostile DBA who disables the trigger and edits a row is still detected',
    async () => {
      const { tenantId, repo } = await seedChain(3);
      expect((await repo.verifyChain(tenantId)).valid).toBe(true);

      await asHostileDba(tenantId, async (client) => {
        const updated = await client.query(
          `UPDATE audit_log_entries SET user_name = 'tampered-by-dba'
            WHERE tenant_id = $1 AND chain_seq = 2`,
          [tenantId],
        );
        // Guard: a zero-row no-op must never look like a successful tamper test.
        expect(updated.rowCount).toBe(1);
      });

      const result = await repo.verifyChain(tenantId);

      expect(result.valid).toBe(false);
      expect(result.brokenAt).not.toBeNull();
      expect(result.brokenAt?.reason).toBe('hash-mismatch');
      expect(result.brokenAt?.chainSeq).toBe(2);
      // Everything before the tampered entry still verified.
      expect(result.checkedEntries).toBe(1);
    },
  );

  it.skipIf(!live)('a deleted middle entry is detected as a sequence gap', async () => {
    const { tenantId, repo } = await seedChain(3);

    await asHostileDba(tenantId, async (client) => {
      const deleted = await client.query(
        `DELETE FROM audit_log_entries WHERE tenant_id = $1 AND chain_seq = 2`,
        [tenantId],
      );
      expect(deleted.rowCount).toBe(1);
    });

    const result = await repo.verifyChain(tenantId);

    expect(result.valid).toBe(false);
    expect(result.brokenAt?.reason).toBe('sequence-gap');
    expect(result.brokenAt?.chainSeq).toBe(3);
  });

  it.skipIf(!live)('chain verification is scoped per tenant', async () => {
    const a = await seedChain(2);
    const b = await seedChain(2);

    await asHostileDba(a.tenantId, async (client) => {
      const updated = await client.query(
        `UPDATE audit_log_entries SET user_name = 'tampered'
          WHERE tenant_id = $1 AND chain_seq = 1`,
        [a.tenantId],
      );
      expect(updated.rowCount).toBe(1);
    });

    // Tenant A is broken; tenant B must be unaffected.
    expect((await a.repo.verifyChain(a.tenantId)).valid).toBe(false);
    expect((await b.repo.verifyChain(b.tenantId)).valid).toBe(true);
  });
});
