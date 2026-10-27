/**
 * PRC-L130 — per-tenant catalog identity (ISBN, item barcode) on a real, migrated Postgres
 * (runtime app role, RLS enforced).
 *
 * library_items had no unique on isbn or barcode (009, 039), so a duplicate create or a
 * repeated ISBN import landed a second catalog row. db/sql/266 adds partial unique
 * indexes (tenant_id, isbn) / (tenant_id, barcode) for non-empty values; create and
 * import normalise the ISBN first, and the repository maps 23505 to ConflictError.
 *
 * Fails closed when CI=true or REQUIRE_LIVE_TESTS=1 and DATABASE_URL is unset (W3-TEST-03).
 */
import { randomUUID } from 'node:crypto';
import { ConflictError } from '@proctira/common';
import { withPgTenant } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LibraryService } from './library-service.js';
import { PgLibraryRepository } from './pg-library-repository.js';

// Same contract as @proctira/testing requireLiveDatabaseUrl (not a dependency of this package).
const SUITE = 'catalog-identity-unique.live.test';
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

describe.skipIf(!DATABASE_URL)('PRC-L130 catalog identity uniqueness (live)', () => {
  let pool: pg.Pool;
  let service: LibraryService;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 12 });
    // Default ISBN lookup = offline stub catalog (never the network).
    service = new LibraryService(new PgLibraryRepository(pool));
  });

  afterAll(async () => {
    await pool.end();
  });

  async function tenant() {
    const tenantId = randomUUID();
    await ensurePgTestTenant(pool, tenantId);
    return tenantId;
  }

  async function rows(tenantId: string, column: 'isbn' | 'barcode', value: string) {
    const res = await withPgTenant(pool, tenantId, (client) =>
      client.query(
        `SELECT count(*)::int AS n FROM library_items WHERE tenant_id = $1 AND ${column} = $2`,
        [tenantId, value],
      ),
    );
    return (res.rows[0] as { n: number }).n;
  }

  it('a duplicate ISBN create (same ISBN, different formatting) is 409 with one row', async () => {
    const tenantId = await tenant();
    await service.createItem(tenantId, { title: 'Book A', isbn: '9780000000017' });
    await expect(
      service.createItem(tenantId, { title: 'Book A again', isbn: '978-0-00-000001-7' }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await rows(tenantId, 'isbn', '9780000000017')).toBe(1);
  });

  it('a repeated ISBN import is 409 with one row', async () => {
    const tenantId = await tenant();
    await service.importFromIsbn(tenantId, '9780134685991');
    await expect(service.importFromIsbn(tenantId, '978-0134685991')).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(await rows(tenantId, 'isbn', '9780134685991')).toBe(1);
  });

  it('concurrent creates of one ISBN leave one row', async () => {
    const tenantId = await tenant();
    await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        service.createItem(tenantId, { title: `Race ${i}`, isbn: '9780000000024' }),
      ),
    );
    expect(await rows(tenantId, 'isbn', '9780000000024')).toBe(1);
  });

  it('a duplicate item barcode is 409; the same ISBN in another tenant is allowed', async () => {
    const tenantId = await tenant();
    await service.createItem(tenantId, { title: 'Barcoded', barcode: 'LIB-0001' });
    await expect(
      service.createItem(tenantId, { title: 'Barcoded again', barcode: 'LIB-0001' }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await rows(tenantId, 'barcode', 'LIB-0001')).toBe(1);

    const other = await tenant();
    await service.createItem(other, { title: 'Book A', isbn: '9780000000017' });
    await service.createItem(other, { title: 'Barcoded', barcode: 'LIB-0001' });
  });
});
