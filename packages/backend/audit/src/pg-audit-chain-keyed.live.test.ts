/**
 * Live Postgres proof of the PRC-M200 keyed HMAC audit chain (migrations
 * 291-296). The existing `pg-audit-chain-tamper.live.test` proves the legacy
 * unkeyed sha256 chain is tamper-evident; this suite proves the keyed upgrade:
 *
 *   1. A forged unkeyed sha256 row inserted ABOVE the per-tenant cut-over by a
 *      hostile DBA (who recomputes the unkeyed chain forward) is rejected by
 *      `verifyChain`, because above the cut-over a row must carry a keyed HMAC
 *      under a secret the database never sees (no key => no MAC).
 *   2. The runtime role (DATABASE_URL, proctira_app) cannot UPDATE
 *      audit_chain_heads directly after migration 294 — the only write path is
 *      the SECURITY DEFINER functions.
 *   3. The linkage trigger (296) rejects a chained insert whose prev_hash does
 *      not match the current head.
 *   4. The runtime role cannot INSERT/UPDATE audit_chain_cutover (294): the
 *      tamper boundary is immutable at runtime.
 *   5. 20 concurrent same-tenant appends produce one contiguous chain seq 1..20
 *      (the head FOR UPDATE lock serialises writers).
 *   6. The definer functions bind every call to the GUC tenant: a cross-tenant
 *      lock_head / append / seal raises 42501, including a mixed-case uuid
 *      argument (DR4-7 case-insensitive compare).
 *   7. Sealing a queue row twice raises (double-seal guard) and leaves exactly
 *      one chain entry for it.
 *
 * Two connections are used, matching the tamper suite:
 *   - the runtime pool (`DATABASE_URL`, e.g. proctira_app) writes + verifies
 *   - an owner pool (`MIGRATOR_DATABASE_URL`) plays the hostile DBA / migrator
 *
 * Skipped unless both connection strings are set. Only ever run this against a
 * disposable database: triggers are briefly disabled and the cut-over table is
 * written directly through the owner connection.
 */
import { randomUUID } from 'node:crypto';

import { withPgTenant } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { computeEntryHash } from './audit-hash.js';
import type { CreateAuditLogInput } from './audit-repository.js';
import { PgAuditRepository } from './pg-audit-repository.js';
import { appendAuditEntryOnClient, currentAuditChainKey } from './txn-mutation-audit.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'pg-audit-chain-keyed.live.test' });
const MIGRATOR_DATABASE_URL = process.env['MIGRATOR_DATABASE_URL']?.trim();

const runtimePool = DATABASE_URL ? new pg.Pool({ connectionString: DATABASE_URL, max: 8 }) : null;
const ownerPool = MIGRATOR_DATABASE_URL
  ? new pg.Pool({ connectionString: MIGRATOR_DATABASE_URL, max: 2 })
  : null;

const live = Boolean(runtimePool && ownerPool);

afterAll(async () => {
  await runtimePool?.end();
  await ownerPool?.end();
});

function input(tenantId: string, n: number): CreateAuditLogInput {
  return {
    id: randomUUID(),
    tenantId,
    entityType: 'keyed-chain-probe',
    entityId: `probe-${n}`,
    operation: 'UPDATE',
    userId: randomUUID(),
    userName: `probe-user-${n}`,
    ipAddress: '203.0.113.9',
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, n)),
    beforeValues: { seq: n - 1 },
    afterValues: { seq: n },
    metadata: { probe: true },
  };
}

/**
 * Seed a fresh tenant with a keyed chain of `length` rows through the runtime
 * write path (appendAuditEntryOnClient -> audit_chain_lock_head /
 * audit_chain_append), each inside its own tenant transaction. A fresh tenant
 * has no audit_chain_cutover row, so cut-over is 0 and the whole chain is keyed.
 */
async function seedKeyedChain(length: number): Promise<string> {
  const tenantId = randomUUID();
  await ensurePgTestTenant(ownerPool!, tenantId);
  for (let n = 1; n <= length; n += 1) {
    await withPgTenant(runtimePool!, tenantId, (client) =>
      appendAuditEntryOnClient(client, input(tenantId, n)),
    );
  }
  return tenantId;
}

/** Run `fn` as the owning DBA scoped to `tenantId` (FORCE RLS needs the GUC). */
async function asOwner<T>(
  tenantId: string | null,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await ownerPool!.connect();
  try {
    if (tenantId) {
      await client.query('SELECT set_config($1, $2, false)', ['app.tenant_id', tenantId]);
    }
    return await fn(client);
  } finally {
    client.release();
  }
}

describe('PRC-M200 keyed audit chain (live Postgres)', () => {
  it.skipIf(!live)('a fully keyed chain verifies clean under the runtime key', async () => {
    const tenantId = await seedKeyedChain(3);
    const repo = new PgAuditRepository(runtimePool!);

    const result = await repo.verifyChain(tenantId);

    expect(result.valid).toBe(true);
    expect(result.brokenAt).toBeNull();
    expect(result.checkedEntries).toBe(3);
    expect(result.headSeq).toBe(3);
    // Rows are keyed under the currently-configured key (dev fallback in tests).
    expect(currentAuditChainKey().keyId).toBeTruthy();
  });

  it.skipIf(!live)(
    'a forged UNKEYED sha256 row above the cut-over is rejected by the keyed verifier',
    async () => {
      // Fresh tenant: cut-over 0, so EVERY row must be keyed.
      const tenantId = await seedKeyedChain(2);
      const repo = new PgAuditRepository(runtimePool!);
      expect((await repo.verifyChain(tenantId)).valid).toBe(true);

      // Hostile DBA appends a chain_seq=3 row signed only with the UNKEYED
      // sha256 (the best a DBA without the HMAC secret can do), linking it to
      // the real head so the linkage trigger would otherwise accept it. The
      // trigger is disabled so the insert lands; the keyed verifier must still
      // reject it because seq 3 > cut-over 0 requires a keyed HMAC.
      const forgedId = randomUUID();
      await asOwner(tenantId, async (client) => {
        const head = await client.query<{ head_seq: string; head_hash: string | null }>(
          `SELECT head_seq, head_hash FROM audit_chain_heads WHERE tenant_id = $1`,
          [tenantId],
        );
        const prevHash = head.rows[0]!.head_hash;
        const seq = Number(head.rows[0]!.head_seq) + 1;
        const occurredAt = new Date(Date.UTC(2026, 0, 2, 0, 0, 0));
        const forged: CreateAuditLogInput = {
          ...input(tenantId, seq),
          id: forgedId,
          timestamp: occurredAt,
        };
        const unkeyedHash = computeEntryHash(
          {
            id: forged.id,
            tenantId: forged.tenantId,
            entityType: forged.entityType,
            entityId: forged.entityId,
            operation: forged.operation,
            userId: forged.userId,
            userName: forged.userName,
            ipAddress: forged.ipAddress,
            timestamp: forged.timestamp,
            beforeValues: forged.beforeValues,
            afterValues: forged.afterValues,
            metadata: forged.metadata,
          },
          prevHash,
        );

        await client.query(
          'ALTER TABLE audit_log_entries DISABLE TRIGGER audit_chain_validate_linkage_trg',
        );
        try {
          const inserted = await client.query(
            `INSERT INTO audit_log_entries (
               id, tenant_id, entity_type, entity_id, operation, user_id, user_name,
               ip_address, occurred_at, before_values, after_values, metadata,
               chain_seq, prev_hash, entry_hash, key_id
             ) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14,$15,NULL)`,
            [
              forged.id,
              forged.tenantId,
              forged.entityType,
              forged.entityId,
              forged.operation,
              forged.userId,
              forged.userName,
              forged.ipAddress,
              forged.timestamp,
              JSON.stringify(forged.beforeValues),
              JSON.stringify(forged.afterValues),
              JSON.stringify(forged.metadata),
              seq,
              prevHash,
              unkeyedHash,
            ],
          );
          expect(inserted.rowCount).toBe(1);
        } finally {
          await client
            .query('ALTER TABLE audit_log_entries ENABLE TRIGGER audit_chain_validate_linkage_trg')
            .catch(() => undefined);
        }
      });

      const result = await repo.verifyChain(tenantId);
      expect(result.valid).toBe(false);
      // The unkeyed row sits at seq 3 (above cut-over 0) with key_id NULL.
      expect(result.brokenAt?.chainSeq).toBe(3);
    },
  );

  it.skipIf(!live)(
    'the runtime role cannot UPDATE audit_chain_heads directly (294 revoke)',
    async () => {
      const tenantId = await seedKeyedChain(1);
      await expect(
        withPgTenant(runtimePool!, tenantId, (client) =>
          client.query(`UPDATE audit_chain_heads SET head_seq = 0 WHERE tenant_id = $1`, [
            tenantId,
          ]),
        ),
      ).rejects.toThrow(/permission denied|insufficient_privilege/i);
    },
  );

  it.skipIf(!live)(
    'the linkage trigger (296) rejects a chained insert with a wrong prev_hash',
    async () => {
      const tenantId = await seedKeyedChain(2);
      // Direct insert of a seq=3 row whose prev_hash does not match the head.
      await asOwner(tenantId, async (client) => {
        await expect(
          client.query(
            `INSERT INTO audit_log_entries (
               id, tenant_id, entity_type, entity_id, operation, user_id, user_name,
               ip_address, occurred_at, before_values, after_values, metadata,
               chain_seq, prev_hash, entry_hash, key_id
             ) VALUES ($1::uuid,$2,'x','x','UPDATE',$3,'n','0.0.0.0',now(),
                       NULL,NULL,NULL,3,'deadbeef','feedface','dev')`,
            [randomUUID(), tenantId, randomUUID()],
          ),
        ).rejects.toThrow(/prev_hash does not match|linkage/i);
      });
    },
  );

  it.skipIf(!live)(
    'the runtime role cannot INSERT or UPDATE audit_chain_cutover (294 revoke)',
    async () => {
      const tenantId = await seedKeyedChain(1);
      await expect(
        withPgTenant(runtimePool!, tenantId, (client) =>
          client.query(
            `INSERT INTO audit_chain_cutover (tenant_id, cutover_seq) VALUES ($1, 999)`,
            [tenantId],
          ),
        ),
      ).rejects.toThrow(/permission denied|insufficient_privilege/i);
    },
  );

  it.skipIf(!live)(
    '20 concurrent same-tenant appends produce one contiguous chain (seq 1..20)',
    async () => {
      const tenantId = randomUUID();
      await ensurePgTestTenant(ownerPool!, tenantId);

      await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          withPgTenant(runtimePool!, tenantId, (client) =>
            appendAuditEntryOnClient(client, input(tenantId, i + 1)),
          ),
        ),
      );

      const repo = new PgAuditRepository(runtimePool!);
      const result = await repo.verifyChain(tenantId);
      expect(result.valid).toBe(true);
      expect(result.headSeq).toBe(20);
      expect(result.checkedEntries).toBe(20);

      // The sequence is dense 1..20 with no gaps or duplicates.
      const seqs = await withPgTenant(runtimePool!, tenantId, (client) =>
        client.query<{ chain_seq: string }>(
          `SELECT chain_seq FROM audit_log_entries WHERE tenant_id = $1 ORDER BY chain_seq`,
          [tenantId],
        ),
      );
      expect(seqs.rows.map((r) => Number(r.chain_seq))).toEqual(
        Array.from({ length: 20 }, (_, i) => i + 1),
      );
    },
  );

  it.skipIf(!live)(
    'cross-tenant definer calls raise 42501, including a mixed-case uuid (DR4-7)',
    async () => {
      const tenantA = await seedKeyedChain(1);
      const tenantB = randomUUID();
      await ensurePgTestTenant(ownerPool!, tenantB);

      // Bound to tenant A, but call the definer with tenant B's id -> 42501.
      await expect(
        withPgTenant(runtimePool!, tenantA, (client) =>
          client.query(`SELECT head_seq FROM audit_chain_lock_head($1)`, [tenantB]),
        ),
      ).rejects.toThrow(/does not match bound tenant|42501|insufficient_privilege/i);

      await expect(
        withPgTenant(runtimePool!, tenantA, (client) =>
          client.query(
            `SELECT chain_seq FROM audit_chain_append(
               $1,$2,'x','x','UPDATE',$3,'n','0.0.0.0',now(),
               NULL,NULL,NULL,'abc','dev')`,
            [tenantB, randomUUID(), randomUUID()],
          ),
        ),
      ).rejects.toThrow(/does not match bound tenant|42501|insufficient_privilege/i);

      // DR4-7: a mixed-case variant of the bound tenant must still be accepted
      // (case-insensitive compare), proving the guard is not a plain string
      // match that a mixed-case uuid could bypass. lock_head on the upper-cased
      // bound id succeeds; the real cross-tenant id above still fails.
      await withPgTenant(runtimePool!, tenantA, async (client) => {
        const upper = tenantA.toUpperCase();
        const ok = await client.query(`SELECT head_seq FROM audit_chain_lock_head($1)`, [upper]);
        expect(ok.rowCount).toBe(1);
      });
    },
  );

  it.skipIf(!live)(
    'double-seal of a queue row raises and leaves exactly one chain entry',
    async () => {
      const tenantId = randomUUID();
      await ensurePgTestTenant(ownerPool!, tenantId);

      // Enqueue a system-origin row through the runtime role (append_only).
      const dedupeKey = randomUUID();
      await withPgTenant(runtimePool!, tenantId, (client) =>
        client.query(
          `INSERT INTO audit_ingest_queue
             (tenant_id, entity_type, entity_id, operation, user_id, actor_kind,
              user_name, ip_address, occurred_at, before_values, after_values,
              metadata, dedupe_key)
           VALUES ($1,'demo','d1','CREATE',NULL,'system:test','system','0.0.0.0',
                   now(), NULL, NULL, NULL, $2)`,
          [tenantId, dedupeKey],
        ),
      );

      const queueId = await withPgTenant(runtimePool!, tenantId, async (client) => {
        const res = await client.query<{ id: string }>(
          `SELECT id FROM audit_ingest_queue WHERE tenant_id = $1 AND dedupe_key = $2`,
          [tenantId, dedupeKey],
        );
        return res.rows[0]!.id;
      });

      const key = currentAuditChainKey();
      // First seal succeeds.
      const firstSeq = await withPgTenant(runtimePool!, tenantId, async (client) => {
        const res = await client.query<{ chain_seq: string }>(
          `SELECT chain_seq FROM audit_ingest_seal($1,$2,$3,$4,$5)`,
          [tenantId, queueId, randomUUID(), 'a'.repeat(64), key.keyId],
        );
        return Number(res.rows[0]!.chain_seq);
      });
      expect(firstSeq).toBe(1);

      // Second seal of the same row raises (double-seal guard, 23514).
      await expect(
        withPgTenant(runtimePool!, tenantId, (client) =>
          client.query(`SELECT chain_seq FROM audit_ingest_seal($1,$2,$3,$4,$5)`, [
            tenantId,
            queueId,
            randomUUID(),
            'b'.repeat(64),
            key.keyId,
          ]),
        ),
      ).rejects.toThrow(/already sealed|23514/i);

      // Exactly one chain entry exists for this tenant.
      const count = await withPgTenant(runtimePool!, tenantId, (client) =>
        client.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM audit_log_entries WHERE tenant_id = $1`,
          [tenantId],
        ),
      );
      expect(Number(count.rows[0]!.n)).toBe(1);
    },
  );
});
