# Deep evaluation — board rollup (`GET /reports/board/:boardId/summary`)

| Field          | Value                                                              |
| -------------- | ------------------------------------------------------------------ |
| Audited SHA    | `12fe8de08215f0eac8bb128c06ada49b5462c1f4`                         |
| Date           | 2026-09-18                                                         |
| Requirement    | "Board will see the school-wise performance under them"            |
| Implementation | `apps/api-gateway/src/board-summary.ts` (327 lines), G-809         |
| Mount          | `insightsUiPlugin`, RBAC resource `report` via `PATH_RESOURCE_MAP` |
| Evidence DB    | PostgreSQL 16, 113 domain SQL files, `APPLY_STRICT_FKS=1`          |
| Disposition    | **PARTIAL** — one P0 correctness defect, one P1 capability gap     |

## The good news: the isolation model does not block this

A school is a **row**, not a tenant. Verified in the live catalogue:

- `institutions` carries both `tenant_id` and `board_id`
- `boards` carries `tenant_id`
- both have RLS enabled and FORCED

So the hierarchy is **tenant → boards → institutions**, and board-sees-school is a
natural intra-tenant query. It is not a cross-tenant read and does not conflict with
the RLS posture. This was the main architectural risk and it is absent.

A rollup endpoint already exists and is mounted with RBAC wired.

## P0 — the fee figure ignores the board scope entirely

`board-summary.ts` computes every other metric with an institution filter, but not
fees:

```sql
-- board-summary.ts, fees branch
SELECT COALESCE(SUM(amount_cents), 0)::bigint AS value
  FROM parent_fee_payments
 WHERE status = 'succeeded'
```

No `institution_id` predicate, and no `boardId` parameter. Compare the attendance
branch immediately above it, which does filter:
`WHERE institution_id::text = ANY($1::text[])`.

**Root cause:** `parent_fee_payments` cannot be scoped to a school. Its columns are
`id, invoice_id, tenant_id, payer_user_id, amount_cents, method, status, paid_at,
created_at, idempotency_key` — there is no `institution_id`, and no join to one is
attempted. School attribution would have to traverse
`parent_fee_payments → invoice_id → parent_fee_invoices → student → enrollments →
institution_id`.

**Why this is P0 rather than cosmetic.** `boards.tenant_id` exists, so one tenant can
hold multiple boards. When it does, `feesCollectedCents` returns the **whole
tenant's** collections to **every** board — each board sees the others' money. Even
with a single board per tenant the number is wrong whenever the tenant holds any
institution outside that board, because the other metrics are board-scoped and this
one is not. The response mixes scopes in a single object without signalling it.

It is also silent. There is no indication in the payload that this field has a
different scope from its siblings.

## P1 — `schoolsBreakdown` carries only enrolment

The requirement is school-**wise** performance. The response shape is:

```ts
interface BoardSchoolBreakdown {
  institutionId: string;
  name: string;
  enrolment: number; // the only metric
}
```

Board-level totals include `attendancePercent`, `feesCollectedCents` and
`lmsCompletionPercent`, but the per-school array has none of them. A board can see
how many students each school has, and combined attendance across all schools. It
**cannot compare School A's attendance with School B's**, which is the substance of
the request.

The cheapest part of the fix: attendance is already filtered by `institution_id` and
simply not grouped. Adding `GROUP BY institution_id` yields per-school attendance
with no new joins and no schema change.

## P1 — academic performance is not attributable without a period-correlated join

Attendance is directly attributable (`student_attendance.institution_id` exists).
Marks are not:

| Table                          | `institution_id` |
| ------------------------------ | ---------------- |
| `student_attendance`           | present          |
| `assessment_results`           | **absent**       |
| `grade_entries`                | **absent**       |
| `examination_academic_records` | **absent**       |
| `students`                     | **absent**       |

School membership lives only in `enrollments`
(`student_id, institution_id, grade_id, class_id, academic_period_id, status,
enrolled_at, exited_at`), which is **temporal**.

Both `assessment_results` and `enrollments` carry `academic_period_id`, so this join
is available and I confirmed it plans:

```sql
FROM assessment_results r
JOIN enrollments e
  ON e.student_id = r.student_id
 AND e.academic_period_id = r.academic_period_id
JOIN institutions i ON i.id = e.institution_id
```

Two caveats, both material at board scale:

1. **Performance.** The plan is `Seq Scan on assessment_results` then sort-merge.
   `assessment_results.student_id` is one of the 213 unindexed FK columns recorded in
   the platform gap analysis. Across many schools and multiple years this will not
   hold.
2. **Attribution is a policy decision, not a technical one.** If a student transfers
   mid-year, which school owns the mark? The period-correlated join attributes it to
   the enrolment for that period. A board comparing schools must have this rule
   stated and published, because it changes the rankings and schools will dispute
   them.

## P2 — zeros are indistinguishable from real data

The docstring is explicit: "Missing tables/columns yield zeros — never 500." The
implementation honours it with `catch { return summary }` and
`catch { // leave zeros }` throughout.

Defensible for availability, but a board looking at a dashboard of zeros cannot tell
whether its schools genuinely collected no fees or whether a relation was missing.
For a reporting surface that will inform decisions about schools, the payload needs a
per-metric status or a partial-data flag.

## P2 — LMS average silently includes unattributed rows

```sql
WHERE institution_id IS NULL OR institution_id::text = ANY($1::text[])
```

The `IS NULL` branch pulls rows belonging to no institution into **every** board's
average, so boards are compared on a figure that includes shared or orphaned data.
Not grouped per school either.

## Gap matrix

| Capability                      | Evidence                                                                               | Status      | Gap                                    | Impact                                                              | Priority | Effort |
| ------------------------------- | -------------------------------------------------------------------------------------- | ----------- | -------------------------------------- | ------------------------------------------------------------------- | -------- | ------ |
| Board sees its schools          | `institutions.board_id`, RLS forced, endpoint mounted                                  | implemented | —                                      | —                                                                   | —        | —      |
| Per-school enrolment            | `schoolsBreakdown.enrolment`                                                           | implemented | —                                      | —                                                                   | —        | —      |
| Board fee total is board-scoped | fees query has no institution predicate; `parent_fee_payments` has no `institution_id` | **absent**  | figure is tenant-wide                  | boards see each other's collections; wrong number even single-board | **P0**   | M      |
| Per-school attendance           | filtered but not grouped                                                               | absent      | no `GROUP BY institution_id`           | cannot compare schools                                              | P1       | S      |
| Per-school fees                 | no attribution path                                                                    | absent      | needs invoice→student→enrollment join  | cannot compare schools                                              | P1       | M      |
| Per-school academic performance | no `institution_id` on any marks table                                                 | absent      | needs period-correlated join + indexes | the core of the request                                             | P1       | M      |
| Transfer attribution rule       | undefined                                                                              | absent      | no stated policy                       | disputed rankings                                                   | P1       | S      |
| Partial-data signalling         | zeros on any failure                                                                   | partial     | indistinguishable from real zeros      | decisions on false data                                             | P2       | S      |
| LMS per-school + scope          | `institution_id IS NULL` included                                                      | partial     | unattributed rows in every board       | skewed comparison                                                   | P2       | S      |

## Acceptance criteria

**P0** — `feesCollectedCents` reflects only institutions belonging to the requested
board. A test with two boards in one tenant proves each board sees only its own
collections, and a board holding zero institutions returns zero rather than the
tenant total.

**P1-1** — `schoolsBreakdown` carries `attendancePercent` per school, proven by a
fixture where two schools have deliberately different attendance.

**P1-2** — `schoolsBreakdown` carries an academic metric per school via the
period-correlated join, with the transfer-attribution rule documented in the
endpoint's docstring and the response.

**P1-3** — `assessment_results.student_id` and `enrollments.student_id` are indexed,
with the query plan no longer showing a sequential scan on `assessment_results`.

**P2** — the response distinguishes "metric unavailable" from "metric is zero".

## What I did not verify

- The endpoint has not been called against seeded multi-school data; findings come
  from reading the implementation and proving the SQL plans in the live catalogue.
- No UI was opened, so how a board consumes `schoolsBreakdown` today is unassessed.
- Performance at realistic board volume was not measured; the sequential scan is
  from `EXPLAIN` on an empty table, so the plan may differ once populated.
- Whether boards in this deployment are genuinely multi-tenant or one-board-per-tenant
  in practice. The P0 severity depends on that, and the schema permits multiple.
