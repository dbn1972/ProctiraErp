/**
 * PRC-M389 — theme revision allocation on a real, migrated Postgres (runtime app role,
 * RLS enforced). insertThemeVersion read the tenant's max revision and then wrote
 * max + 1, so parallel publishes minted the same revision. After the fix it allocates
 * under a per-tenant transaction advisory lock, and db/sql/263's partial unique index
 * (tenant_id, (data->>'revision')::int) WHERE collection = 'tenant.theme_versions' makes a
 * duplicate revision impossible even for a writer that bypasses the repository.
 *
 * Fails closed when CI=true or REQUIRE_LIVE_TESTS=1 and DATABASE_URL is unset (W3-TEST-03).
 */
import { randomUUID } from 'node:crypto';
import { withPgTenant } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgTenantRepository } from './pg-tenant-repository.js';
import type { ThemeTokens } from './schemas.js';

// Same contract as @proctira/testing requireLiveDatabaseUrl (not a dependency of this package).
const SUITE = 'theme-revision-concurrency.live.test';
const DATABASE_URL = process.env['DATABASE_URL']?.trim() || undefined;
const liveRequired =
  process.env['ALLOW_LIVE_TEST_SKIP'] !== '1' &&
  (process.env['REQUIRE_LIVE_TESTS'] === '1' ||
    process.env['CI'] === 'true' ||
    process.env['CI'] === '1');
if (!DATABASE_URL && liveRequired) {
  throw new Error(`[W3-TEST-03] Live suite "${SUITE}" has no DATABASE_URL.`);
}
if (!DATABASE_URL) console.warn(`WARNING: [W3-TEST-03] ${SUITE} skipped (no DATABASE_URL).`);

const tokens = { colors: { primary: '#123456' } } as unknown as ThemeTokens;

describe.skipIf(!DATABASE_URL)('PRC-M389 theme revision allocation (live)', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 12 });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('ten parallel publishes get revisions exactly 1..10', async () => {
    const tenantId = randomUUID();
    await ensurePgTestTenant(pool, tenantId);
    const repo = new PgTenantRepository(pool);

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        repo.insertThemeVersion({ tenantId, tokens, publishedBy: 'admin' }),
      ),
    );

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const listed = await repo.listThemeVersions(tenantId);
    expect(listed.map((v) => v.revision).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  it('a direct duplicate-revision document insert is rejected with 23505', async () => {
    const tenantId = randomUUID();
    await ensurePgTestTenant(pool, tenantId);
    const repo = new PgTenantRepository(pool);
    const v1 = await repo.insertThemeVersion({ tenantId, tokens, publishedBy: 'admin' });

    const dup = withPgTenant(pool, tenantId, (client) =>
      client.query(
        `INSERT INTO control_plane_documents (collection, id, tenant_id, data)
         VALUES ('tenant.theme_versions', $1, $2, $3::jsonb)`,
        [
          randomUUID(),
          tenantId,
          JSON.stringify({ ...v1, id: randomUUID(), publishedAt: new Date() }),
        ],
      ),
    );
    await expect(dup).rejects.toMatchObject({ code: '23505' });
  });
});
