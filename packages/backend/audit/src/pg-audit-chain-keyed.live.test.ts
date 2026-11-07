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
 *   8. audit_ingest_queue / audit_chain_cutover tenant_id is uuid with a
 *      validated FK to tenants(id): an unknown tenant uuid is rejected, and the
 *      runtime role bound to tenant B cannot see tenant A's rows.
 *   9. Upgrade over a pre-seeded chain (UAT-DB-003): running 295 as the
 *      NOBYPASSRLS migrator records cut-over = head seq for tenants whose
 *      legacy unkeyed chain predates 291, restores FORCE RLS, keeps the first
 *      boundary on re-run, and the keyed verifier accepts the legacy rows.
 *  10. Drain tenant listing (UAT-DB-002): in platform scope the runtime role
 *      gets pending tenant ids + counts from audit_ingest_pending_tenants(),
 *      while queued rows stay visible only to their own tenant.
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
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { withPgTenant, withPlatformScope, type PgQueryable } from '@proctira/database';
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

/** Text of migration 295, run verbatim by the upgrade case (UAT-DB-003). */
function load295(): string {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
  return readFileSync(path.join(root, 'db/sql', '295_audit_chain_cutover_seed.sql'), 'utf8');
}
/**
 * Seed a fresh tenant with a LEGACY unkeyed sha256 chain of `length` rows, the
 * shape main wrote before 291 (key_id NULL, head advanced by the writer). Runs
 * as the owner bound to the tenant; the 296 linkage trigger stays enabled, so
 * every row must extend the head it sees. Returns the tenant id.
 */
async function seedLegacyChain(length: number): Promise<string> {
  const tenantId = randomUUID();
  await ensurePgTestTenant(ownerPool!, tenantId);
  await asOwner(tenantId, async (client) => {
    let prevHash: string | null = null;
    for (let n = 1; n <= length; n += 1) {
      const row = input(tenantId, n);
      const hash = computeEntryHash(
        {
          id: row.id,
          tenantId: row.tenantId,
          entityType: row.entityType,
          entityId: row.entityId,
          operation: row.operation,
          userId: row.userId,
          userName: row.userName,
          ipAddress: row.ipAddress,
          timestamp: row.timestamp,
          beforeValues: row.beforeValues,
          afterValues: row.afterValues,
          metadata: row.metadata,
        },
        prevHash,
      );
      await client.query(
        `INSERT INTO audit_log_entries (
           id, tenant_id, entity_type, entity_id, operation, user_id, user_name,
           ip_address, occurred_at, before_values, after_values, metadata,
           chain_seq, prev_hash, entry_hash, key_id
         ) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14,$15,NULL)`,
        [
          row.id,
          row.tenantId,
          row.entityType,
          row.entityId,
          row.operation,
          row.userId,
          row.userName,
          row.ipAddress,
          row.timestamp,
          JSON.stringify(row.beforeValues),
          JSON.stringify(row.afterValues),
          JSON.stringify(row.metadata),
          n,
          prevHash,
          hash,
        ],
      );
      await client.query(
        `INSERT INTO audit_chain_heads (tenant_id, head_seq, head_hash) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id) DO UPDATE SET head_seq = EXCLUDED.head_seq, head_hash = EXCLUDED.head_hash`,
        [tenantId, n, hash],
      );
      prevHash = hash;
    }
  });
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
    'queue and cut-over tenant_id are uuid with a validated tenants FK; RLS hides other tenants (W1-DATA-06)',
    async () => {
      // Catalog: both tables carry a validated FK on a uuid tenant_id (291/293).
      const fks = await ownerPool!.query<{ tbl: string; validated: boolean; type: string }>(
        `SELECT c.conrelid::regclass::text AS tbl, c.convalidated AS validated,
                a.atttypid::regtype::text AS type
           FROM pg_constraint c
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
          WHERE c.contype = 'f'
            AND c.confrelid = 'public.tenants'::regclass
            AND a.attname = 'tenant_id'
            AND c.conrelid::regclass::text IN ('audit_chain_cutover', 'audit_ingest_queue')
          ORDER BY 1`,
      );
      expect(fks.rows).toEqual([
        { tbl: 'audit_chain_cutover', validated: true, type: 'uuid' },
        { tbl: 'audit_ingest_queue', validated: true, type: 'uuid' },
      ]);

      const tenantA = randomUUID();
      const tenantB = randomUUID();
      await ensurePgTestTenant(ownerPool!, tenantA);
      await ensurePgTestTenant(ownerPool!, tenantB);
      const enqueue = (client: PgQueryable, tenantId: string) =>
        client.query(
          `INSERT INTO audit_ingest_queue
             (tenant_id, entity_type, entity_id, operation, actor_kind, dedupe_key)
           VALUES ($1, 'demo', 'd1', 'CREATE', 'system:test', $2)`,
          [tenantId, randomUUID()],
        );

      // Tenant A: one queued row (runtime role) and one cut-over row (owner,
      // the only writer of the cut-over).
      await withPgTenant(runtimePool!, tenantA, (client) => enqueue(client, tenantA));
      await asOwner(tenantA, (client) =>
        client.query(`INSERT INTO audit_chain_cutover (tenant_id, cutover_seq) VALUES ($1, 7)`, [
          tenantA,
        ]),
      );

      const countForA = async (client: PgQueryable, table: string) => {
        const res = await client.query(
          `SELECT count(*)::text AS n FROM ${table} WHERE tenant_id = $1`,
          [tenantA],
        );
        return Number((res.rows[0] as { n: string }).n);
      };
      const visible = (tenantId: string) =>
        withPgTenant(runtimePool!, tenantId, async (client) => [
          await countForA(client, 'audit_ingest_queue'),
          await countForA(client, 'audit_chain_cutover'),
        ]);
      expect(await visible(tenantA)).toEqual([1, 1]);
      // Runtime role bound to tenant B cannot see tenant A's rows.
      expect(await visible(tenantB)).toEqual([0, 0]);

      // A tenant uuid with no tenants row is rejected by the FK, not stored.
      const ghost = randomUUID();
      await expect(
        withPgTenant(runtimePool!, ghost, (client) => enqueue(client, ghost)),
      ).rejects.toThrow(/audit_ingest_queue_tenant_fk|foreign key/i);
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

  it.skipIf(!live)(
    '295 run as the NOBYPASSRLS migrator records cut-over = head seq over a pre-seeded legacy chain (UAT-DB-003)',
    async () => {
      // Two tenants whose chains predate 291: legacy unkeyed rows, no cut-over.
      const lengths = [3, 2];
      const tenants: string[] = [];
      for (const length of lengths) tenants.push(await seedLegacyChain(length));

      const migration = load295();
      const client = await ownerPool!.connect();
      // PgAuditRepository on this one transaction (a PoolClient would be taken
      // for a pool by withPlatformScope).
      const tx: PgQueryable = {
        query: (text: string, params?: unknown[]) => client.query(text, params),
      } as PgQueryable;
      const cutoverOf = async (tenantId: string) => {
        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
        const res = await client.query<{ cutover_seq: string }>(
          `SELECT cutover_seq FROM audit_chain_cutover WHERE tenant_id = $1`,
          [tenantId],
        );
        return res.rows.map((r) => Number(r.cutover_seq));
      };
      try {
        // As apply-sql runs it: the migrator (owner, NOSUPERUSER NOBYPASSRLS)
        // in one transaction with no tenant or platform GUC bound. Rolled back
        // below so the shared live database keeps its own cut-over state.
        await client.query('BEGIN');
        const role = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
          `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
        );
        expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
        await client.query(migration);

        // The FORCE lift is restored on every table it touched.
        const forced = await client.query<{ relname: string; forced: boolean }>(
          `SELECT relname, relforcerowsecurity AS forced FROM pg_class
            WHERE oid = ANY (ARRAY['public.tenants', 'public.audit_chain_heads',
                                   'public.audit_log_entries', 'public.audit_log_archive',
                                   'public.audit_chain_cutover']::regclass[])
            ORDER BY relname`,
        );
        expect(forced.rows).toEqual(
          [
            'audit_chain_cutover',
            'audit_chain_heads',
            'audit_log_archive',
            'audit_log_entries',
            'tenants',
          ].map((relname) => ({ relname, forced: true })),
        );

        const repo = new PgAuditRepository(tx);
        for (const [i, tenantId] of tenants.entries()) {
          expect(await cutoverOf(tenantId)).toEqual([lengths[i]]);
          const verified = await repo.verifyChain(tenantId);
          expect(verified.valid).toBe(true);
          expect(verified.brokenAt).toBeNull();
          expect(verified.checkedEntries).toBe(lengths[i]);
          expect(verified.headSeq).toBe(lengths[i]);
        }

        // After the upgrade the next row is keyed and lands above the boundary;
        // a re-run of 295 keeps the first cut-over instead of moving it forward.
        const first = tenants[0]!;
        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [first]);
        await appendAuditEntryOnClient(tx, input(first, lengths[0]! + 1));
        await client.query(migration);
        expect(await cutoverOf(first)).toEqual([lengths[0]]);
        const after = await repo.verifyChain(first);
        expect(after.valid).toBe(true);
        expect(after.checkedEntries).toBe(lengths[0]! + 1);
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
    },
  );

  it.skipIf(!live)(
    'platform-scope pending-tenant listing returns only tenant id + count; queued rows stay tenant-private (UAT-DB-002)',
    async () => {
      const tenantA = randomUUID();
      const tenantB = randomUUID();
      await ensurePgTestTenant(ownerPool!, tenantA);
      await ensurePgTestTenant(ownerPool!, tenantB);
      const enqueue = (tenantId: string, n: number) =>
        withPgTenant(runtimePool!, tenantId, async (client) => {
          for (let i = 0; i < n; i += 1) {
            await client.query(
              `INSERT INTO audit_ingest_queue
                 (tenant_id, entity_type, entity_id, operation, actor_kind, dedupe_key)
               VALUES ($1, 'demo', 'd1', 'CREATE', 'system:test', $2)`,
              [tenantId, randomUUID()],
            );
          }
        });
      await enqueue(tenantA, 2);
      await enqueue(tenantB, 1);

      // The drain's platform scope (runtime role, app.platform_admin='1', no
      // tenant bound).
      const platform = await withPlatformScope(runtimePool!, async (client) => {
        const listing = (await client.query('SELECT * FROM audit_ingest_pending_tenants()')) as {
          fields: Array<{ name: string }>;
          rows: Array<{ tenant_id: string; pending_count: string }>;
        };
        const direct = (await client.query(
          `SELECT count(*)::int AS n FROM audit_ingest_queue WHERE tenant_id = ANY ($1::uuid[])`,
          [[tenantA, tenantB]],
        )) as { rows: Array<{ n: number }> };
        const guc = (await client.query(
          `SELECT coalesce(current_setting('app.tenant_id', true), '') AS t`,
        )) as { rows: Array<{ t: string }> };
        return {
          columns: listing.fields.map((f) => f.name),
          rows: listing.rows,
          direct: direct.rows[0]!.n,
          guc: guc.rows[0]!.t,
        };
      });
      // Only the tenant id and the count leave the definer.
      expect(platform.columns).toEqual(['tenant_id', 'pending_count']);
      const ours = platform.rows
        .filter((r) => r.tenant_id === tenantA || r.tenant_id === tenantB)
        .map((r) => ({ tenantId: r.tenant_id, pending: Number(r.pending_count) }))
        .sort((x, y) => x.tenantId.localeCompare(y.tenantId));
      expect(ours).toEqual(
        [
          { tenantId: tenantA, pending: 2 },
          { tenantId: tenantB, pending: 1 },
        ].sort((x, y) => x.tenantId.localeCompare(y.tenantId)),
      );
      // Platform scope still reads no queued content, and the listing leaves
      // the caller's tenant GUC unbound.
      expect(platform.direct).toBe(0);
      expect(platform.guc).toBe('');

      // A tenant-bound session sees only its own queue rows.
      const asA = await withPgTenant(runtimePool!, tenantA, async (client) => {
        const res = (await client.query(
          `SELECT count(*)::int AS total,
                  count(*) FILTER (WHERE tenant_id = $1)::int AS other
             FROM audit_ingest_queue WHERE tenant_id = ANY ($2::uuid[])`,
          [tenantB, [tenantA, tenantB]],
        )) as { rows: Array<{ total: number; other: number }> };
        return res.rows[0];
      });
      expect(asA).toEqual({ total: 2, other: 0 });

      // A tenant session cannot call the platform listing.
      await expect(
        withPgTenant(runtimePool!, tenantA, (client) =>
          client.query('SELECT * FROM audit_ingest_pending_tenants()'),
        ),
      ).rejects.toThrow(/platform context required/);
    },
  );
});
