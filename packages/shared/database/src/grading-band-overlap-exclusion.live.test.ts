/**
 * PRC-L555 — grading-scale bands of one scale cannot overlap, on a real, migrated Postgres
 * (runtime app role, RLS enforced).
 *
 * grading_scale_bands only had CHECK (min_percent <= max_percent) (db/sql/003), so a scale
 * could carry overlapping bands and a percentage could map to two grades. db/sql/270 adds
 * grading_scale_bands_no_overlap_excl EXCLUDE USING gist
 *   (grading_scale_id WITH =, numrange(min_percent, max_percent, '[]') WITH &&).
 * Bands are closed intervals (a score equal to max_percent is in the band), so touching
 * bands overlap and contiguous bands are written as e.g. 0–39.99 / 40–100.
 *
 * Fails closed when CI=true or REQUIRE_LIVE_TESTS=1 and DATABASE_URL is unset (W3-TEST-03).
 */
import { randomUUID } from 'node:crypto';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withPgTenant } from './pg-tenant.js';
import { ensurePgTestTenant } from './test-fixtures.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'grading-band-overlap-exclusion.live.test' });

describe.skipIf(!DATABASE_URL)('PRC-L555 grading band overlap exclusion (live)', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function scale() {
    const tenantId = randomUUID();
    await ensurePgTestTenant(pool, tenantId);
    const scaleId = randomUUID();
    const otherScaleId = randomUUID();
    await withPgTenant(pool, tenantId, async (client) => {
      const boardId = randomUUID();
      await client.query(
        `INSERT INTO boards (id, tenant_id, name, code, type) VALUES ($1, $2, 'Board', $3, 'STATE')`,
        [boardId, tenantId, `B-${boardId.slice(0, 8)}`],
      );
      for (const [id, code] of [
        [scaleId, 'PCT'],
        [otherScaleId, 'PCT2'],
      ]) {
        await client.query(
          `INSERT INTO grading_scales (id, tenant_id, board_id, code, name) VALUES ($1, $2, $3, $4, $4)`,
          [id, tenantId, boardId, code],
        );
      }
    });
    return { tenantId, scaleId, otherScaleId };
  }

  function band(tenantId: string, scaleId: string, label: string, min: number, max: number) {
    return withPgTenant(pool, tenantId, (client) =>
      client.query(
        `INSERT INTO grading_scale_bands (tenant_id, grading_scale_id, label, min_percent, max_percent)
         VALUES ($1, $2, $3, $4, $5)`,
        [tenantId, scaleId, label, min, max],
      ),
    );
  }

  it('an overlapping band in the same scale is rejected with 23P01', async () => {
    const fx = await scale();
    await band(fx.tenantId, fx.scaleId, 'B', 60, 79.99);
    await expect(band(fx.tenantId, fx.scaleId, 'A', 75, 100)).rejects.toMatchObject({
      code: '23P01',
    });
    // Closed bounds: a band starting exactly at another's max overlaps it.
    await expect(band(fx.tenantId, fx.scaleId, 'C', 40, 60)).rejects.toMatchObject({
      code: '23P01',
    });
  });

  it('contiguous bands, and the same range in another scale, are accepted', async () => {
    const fx = await scale();
    await band(fx.tenantId, fx.scaleId, 'B', 60, 79.99);
    await band(fx.tenantId, fx.scaleId, 'A', 80, 100);
    await band(fx.tenantId, fx.scaleId, 'C', 40, 59.99);
    await band(fx.tenantId, fx.otherScaleId, 'X', 60, 100);
  });
});
