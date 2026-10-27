/**
 * PRC-M206 (a) — at most one open library fine per loan, on a real, migrated Postgres
 * (runtime app role, RLS enforced).
 *
 * assessFine checked findOpenFineForLoan and then inserted, so two concurrent assessments
 * of the same overdue loan created two open fines. db/sql/266 adds the partial unique index
 * library_fines_open_per_loan_uidx (tenant_id, loan_id) WHERE status = 'open' (the app rule,
 * not a new one: paid/waived fines do not block a later fine); the repository maps its
 * 23505 to ConflictError.
 *
 * Fails closed when CI=true or REQUIRE_LIVE_TESTS=1 and DATABASE_URL is unset (W3-TEST-03).
 */
import { randomUUID } from 'node:crypto';
import { ConflictError } from '@proctira/common';
import { withPgTenant } from '@proctira/database';
import { ensurePgTestStudent, ensurePgTestTenant } from '@proctira/database/test-fixtures';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LibraryService } from './library-service.js';
import { PgLibraryRepository } from './pg-library-repository.js';

// Same contract as @proctira/testing requireLiveDatabaseUrl (not a dependency of this package).
const SUITE = 'fine-open-per-loan.live.test';
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

/** Holds every findOpenFineForLoan caller until `parties` have read (or 2 s pass). */
class BarrierRepository extends PgLibraryRepository {
  private waiting: Array<() => void> = [];

  constructor(
    pool: pg.Pool,
    private readonly parties: number,
  ) {
    super(pool);
  }

  override async findOpenFineForLoan(tenantId: string, loanId: string) {
    const found = await super.findOpenFineForLoan(tenantId, loanId);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 2_000);
      this.waiting.push(() => {
        clearTimeout(timer);
        resolve();
      });
      if (this.waiting.length >= this.parties) {
        const all = this.waiting;
        this.waiting = [];
        all.forEach((go) => go());
      }
    });
    return found;
  }
}

describe.skipIf(!DATABASE_URL)('PRC-M206 one open fine per loan (live)', () => {
  let pool: pg.Pool;
  let repo: PgLibraryRepository;
  let service: LibraryService;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 12 });
    repo = new PgLibraryRepository(pool);
    // No fees ledger: the fine row itself is what is under test.
    service = new LibraryService(repo);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function overdueLoan() {
    const tenantId = randomUUID();
    const studentId = randomUUID();
    await ensurePgTestTenant(pool, tenantId);
    await ensurePgTestStudent(pool, tenantId, studentId);
    const item = await service.createItem(tenantId, { title: 'Overdue Book' });
    const loanId = randomUUID();
    await repo.createLoan({
      id: loanId,
      tenantId,
      itemId: item.id,
      copyId: null,
      barcode: null,
      patronUserId: null,
      studentId,
      checkoutAt: new Date(Date.now() - 20 * 86_400_000),
      dueAt: new Date(Date.now() - 5 * 86_400_000),
      returnedAt: null,
      status: 'checked_out',
    } as never);
    return { tenantId, loanId };
  }

  async function openFines(tenantId: string, loanId: string) {
    const res = await withPgTenant(pool, tenantId, (client) =>
      client.query(
        `SELECT count(*)::int AS n FROM library_fines
          WHERE tenant_id = $1 AND loan_id = $2 AND status = 'open'`,
        [tenantId, loanId],
      ),
    );
    return (res.rows[0] as { n: number }).n;
  }

  it('two concurrent assessments of one overdue loan leave one open fine', async () => {
    const { tenantId, loanId } = await overdueLoan();
    // Both callers pass the open-fine pre-check before either inserts (the race window).
    const racing = new BarrierRepository(pool, 2);
    const racingService = new LibraryService(racing);
    const results = await Promise.allSettled([
      racingService.assessFine(tenantId, 'clerk', { loanId }),
      racingService.assessFine(tenantId, 'clerk', { loanId }),
    ]);
    expect(await openFines(tenantId, loanId)).toBe(1);
    for (const r of results) {
      if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(ConflictError);
    }
  });

  it('a second open fine written past the service check is a ConflictError', async () => {
    const { tenantId, loanId } = await overdueLoan();
    const first = await service.assessFine(tenantId, 'clerk', { loanId });
    await expect(
      repo.createFine({ ...first.fine, id: randomUUID() } as never),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
