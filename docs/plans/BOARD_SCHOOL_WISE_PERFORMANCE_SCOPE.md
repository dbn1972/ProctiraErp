# Scope — board sees school-wise performance

Requirement: a board views performance **per school** for the schools under it.

Current state and evidence: `docs/audits/modules/board-rollup_DEEP_EVAL_2026-09-18.md`.
Audited at `12fe8de08215f0eac8bb128c06ada49b5462c1f4`.

Not an architectural change. A school is a row (`institutions.board_id`), the
endpoint exists and is RBAC-wired, and the board-level metrics are already computed.
The work is correcting one scope defect and moving metrics from the aggregate into
the per-school array.

## Stage 0 — decide the attribution rule first

**Blocking, and not a technical decision.** Everything downstream encodes it.

If a student is enrolled at School A for term 1 and School B for term 2, which
school owns a term-1 mark, and which owns a fee paid in term 2?

Recommended: attribute to the enrolment active in the mark's or payment's
`academic_period_id`. It is defensible, matches the available join, and is stable
when a student later transfers. Whatever is chosen must be written into the endpoint
docstring and surfaced in the response, because boards will use these numbers to
compare schools and schools will contest them.

Do not start stage 2 or 3 before this is settled.

## Stage 1 — fix the fee scope defect (P0)

Independent of everything else. Ship first.

`feesCollectedCents` currently sums `parent_fee_payments WHERE status='succeeded'`
with no institution predicate, so it returns the whole tenant's collections to every
board. `parent_fee_payments` has no `institution_id`, hence no filter was possible.

Two options:

| Option                 | Change                                                                                 | Trade-off                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| A. Join to attribution | `payments → invoice_id → parent_fee_invoices → student → enrollments → institution_id` | No schema change; adds a 4-table join to a rollup                                            |
| B. Denormalise         | Add `institution_id` to `parent_fee_invoices`, populated at invoice creation           | Faster reads; needs a migration and a backfill, and a second source of truth to keep correct |

Prefer **A** first, because it is correct immediately and reveals the real query cost
before committing to a denormalisation. Revisit B only if A measures too slow.

Interim safety: if neither lands quickly, the field must not silently return a
tenant-wide number. Return `null` with a reason rather than a wrong figure — a board
acting on another board's revenue is worse than a board seeing "unavailable".

**Done when:** two boards in one tenant each see only their own collections; a board
with zero institutions returns zero, not the tenant total.

## Stage 2 — per-school attendance (P1, smallest real win)

`student_attendance.institution_id` already exists and the query already filters on
it. It simply is not grouped.

```sql
-- add institution_id to the projection and GROUP BY it,
-- then fold the result into schoolsBreakdown rather than a single scalar
SELECT institution_id::text AS institution_id,
       COUNT(*) FILTER (WHERE status IN ('PRESENT','LATE','EARLY_DEPARTURE'))::float AS present_like,
       COUNT(*)::float AS total
  FROM student_attendance
 WHERE institution_id::text = ANY($1::text[])
 GROUP BY institution_id
```

No schema change, no new join, no migration. Keep the board-level
`attendancePercent` as the weighted roll-up of the per-school rows so existing
consumers do not break.

**Done when:** a fixture with two schools at deliberately different attendance
returns distinct per-school percentages, and the board total equals the weighted
average of them.

## Stage 3 — per-school academic performance (P1, the substance)

Marks carry no `institution_id`. `students` does not either. Attribution exists only
via `enrollments`, which is temporal. The period-correlated join is available and
plans correctly:

```sql
FROM assessment_results r
JOIN enrollments e
  ON e.student_id = r.student_id
 AND e.academic_period_id = r.academic_period_id
JOIN institutions i ON i.id = e.institution_id
WHERE i.board_id = $1
GROUP BY i.id
```

Prerequisites before this is usable at board scale:

1. Index `assessment_results.student_id` and `enrollments.student_id`. Both are among
   the 213 unindexed FK columns. Without them the plan sequential-scans
   `assessment_results`.
2. Decide which metric a board actually compares on — subject-wise average, pass
   rate, distribution, or year-on-year delta. A single "average score" across
   different assessment schemes is not comparable between schools and will mislead.
   This needs the product decision, not just the query.

**Done when:** per-school academic figures appear in `schoolsBreakdown`, the plan
shows index scans rather than a sequential scan on `assessment_results`, and the
attribution rule from stage 0 is documented in the response.

## Stage 4 — make partial data visible (P2)

Today any missing relation yields zeros, by design ("never 500"). A board cannot
distinguish "these schools collected nothing" from "the query failed".

Add a per-metric status so the payload carries `available` / `unavailable` alongside
each figure. Keep the never-500 behaviour; only stop zeros from impersonating data.

**Done when:** a request against a database missing `student_attendance` returns
attendance marked unavailable rather than `0`.

## Stage 5 — correct the LMS comparison (P2)

`WHERE institution_id IS NULL OR institution_id = ANY(...)` pulls unattributed rows
into every board's average, so boards are compared partly on shared data. Group per
school and decide explicitly whether null-institution rows are excluded or reported
separately. Excluding them is the defensible default for a comparison.

## Sequence

```text
0 attribution rule  (blocking, product decision)
 ├─ 1 fee scope defect   (P0, independent, ship first)
 ├─ 2 per-school attendance  (P1, no schema change)
 ├─ 3 per-school academics   (P1, needs 0 + indexes + metric decision)
 ├─ 4 partial-data signalling (P2)
 └─ 5 LMS scope correction    (P2)
```

Stage 1 is independent and highest severity — do it regardless of the rest. Stage 2
delivers visible school-wise comparison for the least work. Stage 3 is the real
requirement and the most expensive.

## Explicit non-goals

- No change to the tenant/board/institution hierarchy. It already supports this.
- No cross-tenant reads. Boards and institutions are intra-tenant rows.
- No new endpoint. `GET /reports/board/:boardId/summary` is extended, not replaced.
- No denormalisation of marks onto `institution_id` unless stage 3 measures too slow
  with indexes in place.

## Verification standard

Every stage needs a fixture with **at least two schools under one board** and
**two boards in one tenant**. A single-school fixture cannot detect either the scope
defect or a missing `GROUP BY` — both pass trivially when N=1, which is how the fee
defect survived until now.
