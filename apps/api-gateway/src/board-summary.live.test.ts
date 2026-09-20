/**
 * G-809 board summary — live Postgres scope proof.
 *
 * The fee rollup previously summed `parent_fee_payments` with no institution
 * predicate. Because `boards.tenant_id` permits several boards per tenant, every
 * board was shown the whole tenant's collections, including other boards'.
 *
 * A single-board or single-school fixture cannot detect that: an unscoped SUM and
 * a correctly scoped one are identical when N=1. This suite therefore builds TWO
 * boards in ONE tenant, with two schools under board A and one under board B, and
 * asserts each board sees only its own money.
 *
 * Skips when DATABASE_URL is unset; the live gate provides it.
 */
import { randomUUID } from 'node:crypto';
import { getSharedPgPool, withPgTenant } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getBoardSummary } from './board-summary.js';

const DATABASE_URL = process.env['DATABASE_URL'];
const describeLive = DATABASE_URL ? describe : describe.skip;

const TENANT = randomUUID();
const BOARD_A = randomUUID();
const BOARD_B = randomUUID();
const SCHOOL_A1 = randomUUID();
const SCHOOL_A2 = randomUUID();
const SCHOOL_B1 = randomUUID();

/** Board A collects 10000 + 20000. Board B collects 70000. Tenant-wide is 100000. */
const EXPECTED_A = 30_000;
const EXPECTED_B = 70_000;
const TENANT_WIDE = 100_000;

describeLive('G-809 board summary fee scope (live Postgres)', () => {
  beforeAll(async () => {
    const pool = getSharedPgPool();
    if (!pool) throw new Error('shared pg pool unavailable');

    const area = randomUUID();
    const grade = randomUUID();
    const period = randomUUID();
    const classes = [randomUUID(), randomUUID(), randomUUID()];
    const students = [randomUUID(), randomUUID(), randomUUID()];
    const invoices = [randomUUID(), randomUUID(), randomUUID()];
    const schools = [SCHOOL_A1, SCHOOL_A2, SCHOOL_B1];
    const amounts = [10_000, 20_000, 70_000];

    // `tenants` is platform-scoped and RLS refuses a tenant-bound insert, so use
    // the shared fixture helper rather than hand-rolling a platform scope.
    await ensurePgTestTenant(pool, TENANT);

    await withPgTenant(pool, TENANT, async (tx) => {
      await tx.query(
        `INSERT INTO geographic_areas (id, tenant_id, name, code, level, path, lft, rgt)
         VALUES ($1, $2, 'Fee scope area', $3, 1, 'fee-scope', 1, 2)`,
        [area, TENANT, `FS-${TENANT.slice(0, 6)}`],
      );
      await tx.query(
        `INSERT INTO grades (id, tenant_id, name, code, "order")
         VALUES ($1, $2, 'Grade 5', $3, 5)`,
        [grade, TENANT, `G5-${TENANT.slice(0, 6)}`],
      );
      await tx.query(
        `INSERT INTO academic_periods (id, tenant_id, name, code, start_date, end_date, valid_from, valid_to)
         VALUES ($1, $2, 'FY scope', $3,
                 current_date - 200, current_date + 100, current_date - 200, current_date + 100)`,
        [period, TENANT, `FY-${TENANT.slice(0, 6)}`],
      );
      await tx.query(
        `INSERT INTO boards (id, tenant_id, name, code, type, status)
         VALUES ($1, $3, 'Board A', $4, 'STATE', 'active'),
                ($2, $3, 'Board B', $5, 'STATE', 'active')`,
        [BOARD_A, BOARD_B, TENANT, `BA-${TENANT.slice(0, 6)}`, `BB-${TENANT.slice(0, 6)}`],
      );

      for (let i = 0; i < 3; i += 1) {
        const board = i < 2 ? BOARD_A : BOARD_B;
        await tx.query(
          `INSERT INTO institutions
             (id, tenant_id, name, code, board_id, area_id, type, sector, ownership, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'school', 'private', 'private', 'active')`,
          [schools[i], TENANT, `School ${i}`, `SC${i}-${TENANT.slice(0, 6)}`, board, area],
        );
        await tx.query(
          `INSERT INTO classes (id, tenant_id, institution_id, grade_id, academic_period_id, name, capacity)
           VALUES ($1, $2, $3, $4, $5, $6, 40)`,
          [classes[i], TENANT, schools[i], grade, period, `C${i}`],
        );
        await tx.query(
          `INSERT INTO students (id, tenant_id, first_name, last_name, date_of_birth, gender)
           VALUES ($1, $2, 'Stu', $3, '2012-01-01', 'other')`,
          [students[i], TENANT, `S${i}`],
        );
        // enrollments_enrolled_requires_class: ENROLLED rows must carry a class.
        await tx.query(
          `INSERT INTO enrollments
             (id, tenant_id, student_id, institution_id, grade_id, class_id,
              academic_period_id, status, enrolled_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'ENROLLED', now() - interval '60 days')`,
          [randomUUID(), TENANT, students[i], schools[i], grade, classes[i], period],
        );
        await tx.query(
          `INSERT INTO parent_fee_invoices (id, tenant_id, student_id, title, amount_cents, status)
           VALUES ($1, $2, $3, $4, $5, 'paid')`,
          [invoices[i], TENANT, students[i], `Term ${i}`, amounts[i]],
        );
        await tx.query(
          `INSERT INTO parent_fee_payments
             (id, tenant_id, invoice_id, payer_user_id, amount_cents, method, status, paid_at)
           VALUES ($1, $2, $3, $4, $5, 'sandbox', 'succeeded', now() - interval '10 days')`,
          [randomUUID(), TENANT, invoices[i], `payer-${i}`, amounts[i]],
        );
      }
    });
  });

  afterAll(async () => {
    const pool = getSharedPgPool();
    if (!pool) return;
    // Best-effort teardown. TENANT is unique per run, so anything left behind is
    // tenant-isolated and cannot affect another suite or another assertion.
    //
    // Two rows deliberately resist deletion and that is correct behaviour, not a
    // defect to work around:
    //   - enrollment_history is written by a trigger and holds an FK to enrollments
    //   - it is append-only, with SELECT-only grants for proctira_app, so the app
    //     role cannot DELETE from it at all (42501)
    // Attempting to force either would mean asking for privileges the runtime is
    // deliberately denied, so the parent rows are simply left in place.
    await withPgTenant(pool, TENANT, async (tx) => {
      const attempt = async (sql: string, params: unknown[]) => {
        try {
          await tx.query(sql, params);
        } catch {
          // append-only or FK-protected; see note above
        }
      };
      await attempt(
        `DELETE FROM parent_fee_payments WHERE invoice_id IN
           (SELECT id FROM parent_fee_invoices WHERE tenant_id = $1)`,
        [TENANT],
      );
      for (const t of [
        'parent_fee_invoices',
        'classes',
        'students',
        'institutions',
        'boards',
        'academic_periods',
        'grades',
        'geographic_areas',
      ]) {
        await attempt(`DELETE FROM ${t} WHERE tenant_id = $1`, [TENANT]);
      }
    });
  });

  it('attributes each payment to the board that owns the school', async () => {
    const a = await getBoardSummary(BOARD_A, TENANT, {});
    const b = await getBoardSummary(BOARD_B, TENANT, {});

    expect(a.feesCollectedCents).toBe(EXPECTED_A);
    expect(b.feesCollectedCents).toBe(EXPECTED_B);

    // The defect returned the tenant-wide total to both boards. Assert explicitly
    // so a regression reproduces as this message rather than a bare mismatch.
    expect(a.feesCollectedCents).not.toBe(TENANT_WIDE);
    expect(b.feesCollectedCents).not.toBe(TENANT_WIDE);
    expect(a.feesCollectedCents + b.feesCollectedCents).toBe(TENANT_WIDE);
  });

  it('counts only its own schools', async () => {
    const a = await getBoardSummary(BOARD_A, TENANT, {});
    const b = await getBoardSummary(BOARD_B, TENANT, {});
    expect(a.schools).toBe(2);
    expect(b.schools).toBe(1);
    expect(a.schoolsBreakdown.map((s) => s.institutionId).sort()).toEqual(
      [SCHOOL_A1, SCHOOL_A2].sort(),
    );
    expect(b.schoolsBreakdown.map((s) => s.institutionId)).toEqual([SCHOOL_B1]);
  });

  it('returns zero rather than the tenant total for a board with no schools', async () => {
    const summary = await getBoardSummary(randomUUID(), TENANT, {});
    expect(summary.schools).toBe(0);
    expect(summary.feesCollectedCents).toBe(0);
    expect(summary.feesCollectedCents).not.toBe(TENANT_WIDE);
  });
});
