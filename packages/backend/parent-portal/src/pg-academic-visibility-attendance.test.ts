/**
 * PRC-M534 (failing-first): attendance percentage must be computed via a SQL `COUNT FILTER`
 * aggregate scoped to the student's full active academic period, not an app-side slice of the
 * last 30 `student_attendance` rows (which could span far less than the full period for an
 * active student and silently diverge from the true percentage).
 *
 * Investigation finding (required by FEAT-002.json step 2 before any fix was written): the
 * ledger note says the pre-fix formula "counts excused as non-attended"; the FEAT brief's own
 * wording says it "counts excused absences as if attended". A test against the CURRENT (pre-fix)
 * `summariseAttendance` — unchanged by this PRC, since the brief directs preserving its existing
 * numerator behaviour — with 10 present / 5 excused / 5 absent resolves this: the percentage is
 * 50% (10 attended / 20 marked), i.e. excused is counted in the denominator but NOT the
 * numerator. That is the ledger's framing ("non-attended"), not the brief's ("as if attended") —
 * the brief's wording does not describe what the code does. See
 * `academic-visibility.ts`'s doc comment on `attendancePercentageFromCounts` for the same note.
 */
import { describe, expect, it } from 'vitest';

import { summariseAttendance, type AttendanceDay } from './academic-visibility.js';
import { PgAcademicVisibilityStore } from './pg-academic-visibility-store.js';

const TENANT_A = '00000000-0000-4000-8000-000000000001';
const STUDENT_ID = '00000000-0000-4000-8000-000000000099';

describe('summariseAttendance excused-handling investigation (PRC-M534)', () => {
  it('a 10 present / 5 excused / 5 absent mix resolves to 50% — excused is non-attended, not as-if-attended', () => {
    const days: AttendanceDay[] = [
      ...Array.from({ length: 10 }, (_, i) => ({
        date: `2026-01-${String(i + 1).padStart(2, '0')}`,
        status: 'PRESENT',
        classId: null,
        comment: null,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        date: `2026-02-${String(i + 1).padStart(2, '0')}`,
        status: 'EXCUSED',
        classId: null,
        comment: null,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        date: `2026-03-${String(i + 1).padStart(2, '0')}`,
        status: 'ABSENT',
        classId: null,
        comment: null,
      })),
    ];
    const summary = summariseAttendance(days);
    expect(summary.present).toBe(10);
    expect(summary.excused).toBe(5);
    expect(summary.absent).toBe(5);
    // 10 attended (present+late) / 20 marked (present+absent+late+excused+other) = 50%.
    // If excused were counted as attended (the brief's framing), this would be 15/20 = 75%.
    expect(summary.percentage).toBe(50);
  });
});

describe('PgAcademicVisibilityStore.getAttendance — full-period SQL aggregate (PRC-M534)', () => {
  const PERIOD_START = '2026-01-01';
  const PERIOD_END = '2026-06-30';

  function fakePool() {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const pool = {
      query: async (sql: string, values: unknown[] = []) => {
        calls.push({ sql, values });
        if (/FROM enrollments/.test(sql)) {
          return { rows: [{ start_date: PERIOD_START, end_date: PERIOD_END }] };
        }
        if (/COUNT\(\*\) FILTER/.test(sql)) {
          // 40 PRESENT, 10 ABSENT, 5 LATE, 5 EXCUSED spanning the full period — a count a
          // last-30-rows slice could never reproduce (60 total rows > 30).
          return {
            rows: [
              {
                present_count: '40',
                absent_count: '10',
                late_count: '5',
                excused_count: '5',
                early_departure_count: '0',
                total_count: '60',
              },
            ],
          };
        }
        if (/FROM student_attendance/.test(sql)) {
          // The separate bounded display-list query — unrelated to the percentage calculation.
          return {
            rows: [{ date: '2026-06-30', status: 'PRESENT', class_id: null, comment: null }],
          };
        }
        return { rows: [] };
      },
    };
    return { pool, calls };
  }

  it('the percentage-aggregate query uses COUNT(*) FILTER and is not LIMIT 30-bounded', async () => {
    const { pool, calls } = fakePool();
    const store = new PgAcademicVisibilityStore(pool as never);
    await store.getAttendance(TENANT_A, STUDENT_ID);

    const aggregateCall = calls.find((c) => /COUNT\(\*\) FILTER/.test(c.sql));
    expect(aggregateCall).toBeDefined();
    expect(aggregateCall!.sql).toMatch(/COUNT\(\*\) FILTER/);
    expect(aggregateCall!.sql).not.toMatch(/LIMIT 30/);
    expect(aggregateCall!.sql).toMatch(/date >= \$3::date/);
    expect(aggregateCall!.sql).toMatch(/date <= \$4::date/);
  });

  it('computes the percentage from the full-period aggregate, not the 30-row display slice', async () => {
    const { pool } = fakePool();
    const store = new PgAcademicVisibilityStore(pool as never);
    const result = await store.getAttendance(TENANT_A, STUDENT_ID);

    // 40 present + 5 late (no early departure) over 60 total = 75%.
    // A last-30-rows slice (the pre-fix behaviour) could only ever see <= 30 of these 60 rows,
    // and summariseAttendance over just the 1-row display list the fake pool returns would
    // compute 100% (single PRESENT row) — a materially different, wrong answer.
    expect(result.summary.percentage).toBe(75);
    expect(result.summary.present).toBe(40);
    expect(result.summary.absent).toBe(10);
    expect(result.summary.late).toBe(5);
    expect(result.summary.excused).toBe(5);
  });

  it('student_attendance.status is compared upper-case, matching the AttendanceStatus enum and the 042 CHECK constraint', async () => {
    const { pool, calls } = fakePool();
    const store = new PgAcademicVisibilityStore(pool as never);
    await store.getAttendance(TENANT_A, STUDENT_ID);

    const aggregateCall = calls.find((c) => /COUNT\(\*\) FILTER/.test(c.sql));
    expect(aggregateCall!.sql).toMatch(/status = 'PRESENT'/);
    expect(aggregateCall!.sql).toMatch(/status = 'EXCUSED'/);
    expect(aggregateCall!.sql).not.toMatch(/status = 'present'/);
  });
});
