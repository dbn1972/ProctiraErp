/**
 * PRC-L169 (live Postgres) — exclusive verification under concurrency, re-check tick locking and
 * DR4-8 (claim + COMMIT before network checks; one short write per result).
 *
 * Skipped without DATABASE_URL. Rows are platform-owned `tenant.domains` documents.
 */
import { randomUUID } from 'node:crypto';

import { getSharedPgPool, withPlatformScope } from '@proctira/database';
import { afterAll, describe, expect, it } from 'vitest';

import {
  DOMAIN_RECHECK_LOCK_KEY,
  DOMAIN_VERIFICATION_TTL_MS,
  domainHostLockKey,
  runDomainRecheckTick,
} from './custom-domain-verification.js';
import { PgTenantRepository } from './pg-tenant-repository.js';
import type { DomainEntity } from './tenant-repository.js';

const pool = getSharedPgPool();
const created: string[] = [];

function domainRow(tenantId: string, domain: string, extra: Partial<DomainEntity> = {}) {
  const id = randomUUID();
  created.push(id);
  return {
    id,
    tenantId,
    domain,
    primary: false,
    verified: false,
    createdAt: new Date(),
    verificationToken: 'tok',
    ...extra,
  } satisfies DomainEntity;
}

/** Advisory locks currently held for a text key (single-int4 form: low half in objid). */
async function advisoryLocksHeld(key: string): Promise<number> {
  const res = await pool!.query(
    `SELECT count(*)::int AS c FROM pg_locks
      WHERE locktype = 'advisory' AND objsubid = 1
        AND objid = ((hashtext($1)::bigint) & 4294967295)::oid`,
    [key],
  );
  return Number((res.rows[0] as { c: number }).c);
}

afterAll(async () => {
  if (!pool || created.length === 0) return;
  await withPlatformScope(pool, (client) =>
    client.query(
      `DELETE FROM control_plane_documents WHERE collection = 'tenant.domains' AND id = ANY($1)`,
      [created],
    ),
  );
});

describe('PgTenantRepository custom-domain verification (live, PRC-L169)', () => {
  it.skipIf(!pool)(
    'concurrent verification of one hostname by two tenants: exactly one wins',
    async () => {
      const repo = new PgTenantRepository(pool!);
      const host = `race-${randomUUID().slice(0, 8)}.example.org`;
      const a = domainRow(randomUUID(), host);
      const b = domainRow(randomUUID(), host);
      await repo.addDomain(a);
      await repo.addDomain(b);
      const now = new Date();
      const until = new Date(now.getTime() + DOMAIN_VERIFICATION_TTL_MS);
      const [ra, rb] = await Promise.all([
        repo.verifyDomainExclusive(a.tenantId, a.id, now, until),
        repo.verifyDomainExclusive(b.tenantId, b.id, now, until),
      ]);
      expect([ra.status, rb.status].sort()).toEqual(['conflict', 'verified']);
      const rows = await repo.findDomainsByHostname(host);
      expect(rows.filter((d) => d.verified)).toHaveLength(1);
      expect(await advisoryLocksHeld(domainHostLockKey(host))).toBe(0);
    },
  );

  it.skipIf(!pool)(
    'a current verification blocks another tenant; a lapsed one is cleared',
    async () => {
      const repo = new PgTenantRepository(pool!);
      const host = `lapse-${randomUUID().slice(0, 8)}.example.org`;
      const a = domainRow(randomUUID(), host);
      const b = domainRow(randomUUID(), host);
      await repo.addDomain(a);
      await repo.addDomain(b);
      const t0 = new Date();
      await repo.verifyDomainExclusive(
        a.tenantId,
        a.id,
        t0,
        new Date(t0.getTime() + DOMAIN_VERIFICATION_TTL_MS),
      );
      expect((await repo.verifyDomainExclusive(b.tenantId, b.id, t0, t0)).status).toBe('conflict');
      // Wrong owner never verifies.
      expect((await repo.verifyDomainExclusive(b.tenantId, a.id, t0, t0)).status).toBe('not_found');
      const later = new Date(t0.getTime() + DOMAIN_VERIFICATION_TTL_MS + 1000);
      const res = await repo.verifyDomainExclusive(
        b.tenantId,
        b.id,
        later,
        new Date(later.getTime() + DOMAIN_VERIFICATION_TTL_MS),
      );
      expect(res.status).toBe('verified');
      const rows = await repo.findDomainsByHostname(host);
      expect(rows.filter((d) => d.verified).map((d) => d.tenantId)).toEqual([b.tenantId]);
    },
  );

  it.skipIf(!pool)(
    'two concurrent re-check ticks: one claims, the other skips; no advisory lock survives',
    async () => {
      const repo = new PgTenantRepository(pool!);
      const host = `tick-${randomUUID().slice(0, 8)}.example.org`;
      const old = new Date(Date.now() - 8 * 24 * 3600 * 1000);
      await repo.addDomain(
        domainRow(randomUUID(), host, {
          verified: true,
          verifiedAt: old,
          verificationExpiresAt: new Date(Date.now() + 3600 * 1000),
        }),
      );
      let checks = 0;
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      let lockedDuringFirst = 0;
      const checker = {
        check: async () => {
          checks += 1;
          return true;
        },
      };
      // Tick 1 holds the recheck xact lock (on its own pooled client) until tick 2 has tried.
      const first = runDomainRecheckTick({
        repository: repo,
        checker,
        onLocked: async () => {
          lockedDuringFirst = await advisoryLocksHeld(DOMAIN_RECHECK_LOCK_KEY);
          await held;
        },
      });
      // Give tick 1 time to take the lock.
      for (let i = 0; i < 50 && lockedDuringFirst === 0; i += 1) {
        await new Promise((r) => setTimeout(r, 20));
      }
      const second = await runDomainRecheckTick({ repository: repo, checker });
      release();
      const firstResult = await first;
      expect(lockedDuringFirst).toBe(1);
      expect(second.ran).toBe(false);
      expect(firstResult.ran).toBe(true);
      expect(checks).toBe(firstResult.checked);
      expect(await advisoryLocksHeld(DOMAIN_RECHECK_LOCK_KEY)).toBe(0);
    },
  );

  it.skipIf(!pool)(
    'DR4-8: claims are committed before network checks, which run with no lock held',
    async () => {
      const repo = new PgTenantRepository(pool!);
      const host = `dr48-${randomUUID().slice(0, 8)}.example.org`;
      const old = new Date(Date.now() - 8 * 24 * 3600 * 1000);
      const row = domainRow(randomUUID(), host, {
        verified: true,
        verifiedAt: old,
        verificationExpiresAt: new Date(Date.now() + 3600 * 1000),
      });
      await repo.addDomain(row);
      const observed: Array<{ claimVisible: boolean; recheckLocks: number }> = [];
      const checker = {
        check: async (domain: string) => {
          if (domain !== host) return true;
          // Another connection sees the committed claim; the recheck lock is gone.
          const res = await withPlatformScope(pool!, (client) =>
            client.query(
              `SELECT data->>'recheckClaimedAt' AS c FROM control_plane_documents
                WHERE collection = 'tenant.domains' AND id = $1`,
              [row.id],
            ),
          );
          observed.push({
            claimVisible: Boolean((res.rows[0] as { c: string | null }).c),
            recheckLocks: await advisoryLocksHeld(DOMAIN_RECHECK_LOCK_KEY),
          });
          return false;
        },
      };
      const result = await runDomainRecheckTick({ repository: repo, checker });
      expect(result.ran).toBe(true);
      expect(observed).toEqual([{ claimVisible: true, recheckLocks: 0 }]);
      const after = (await repo.findDomainsByHostname(host))[0]!;
      expect(after.verified).toBe(false);
      expect(after.recheckClaimedAt ?? null).toBeNull();
    },
  );
});
