# DATA — W1-DATA-09 money cents COMPLETE (scholarships + fee boundary leftovers)

**Module / slice:** Scholarship integer minor units + fee UI/server `Math.round` leftovers  
**Branch / tip:** `cursor/w1-data-09-money-complete-56c3` @ `1763387bd9fb8f26717e4951eaca8cf4f05d0a13`  
**Date (UTC):** 2026-09-14  
**Environment:** static SQL + unit tests (`@proctira/common`, `@proctira/backend-scholarship`)

Copy of `docs/audits/templates/ENTERPRISE_DATA_SQL_CHECKLIST.md`.

---

## Finding (PARTIAL residual)

Prior `DATA_W1_DATA_09_MONEY_CENTS.md` closed fees/billing PG mappers only and **waived** scholarship NUMERIC major units. Remaining gaps:

- `scholarship_programs.amount_per_recipient` NUMERIC without cents column
- `pg-scholarship-repository` `Number(bigint)` / `Math.round(Number(amount) * 100)` on disbursement map
- Utilization aggregates summing float major `amount`
- Fee server-action / form leftovers still using `Math.round(x * 100)`

## 1. Schema

| Artifact | Path | Notes |
| -------- | ---- | ----- |
| Base | `db/sql/016_scholarships_schema.sql` | NUMERIC major retained for display compat; header documents cents migrations |
| Disbursement cents | `db/sql/060_scholarship_amount_cents.sql` | Existing `amount_cents BIGINT NOT NULL` |
| Program cents | `db/sql/079_scholarship_program_amount_cents.sql` | **New** `amount_per_recipient_cents BIGINT NOT NULL` + backfill |
| Invariants | Dual-write major + cents; service `assertMajorMatchesCents` on write/pay | ☑ |

## 2. Apply / verify (no Prisma for cert)

| Step | Command / evidence | Pass |
| ---- | ------------------ | ---- |
| Apply | `ensureScholarshipSchema` runs 016 → 060 → 076; `apply-sql.sh` picks `076` by LC sort | ☑ static |
| Seed | N/A (backfill in 076) | ☑ |
| Spot | Unit: `majorUnitsToCents` / `pgIntegerCents` / `pgNumericMajorToCents`; scholarship service cents test | ☑ |
| Multi-board | Not required for money-type gate | — |

## 3. Tenancy & constraints

| Check | Pass | Evidence |
| ----- | ---- | -------- |
| Tenant scoping / RLS | ☑ | Unchanged policies on scholarship tables |
| FK / unique / indexes | ☑ | `scholarship_programs_amount_per_recipient_cents_idx` |
| Domain property / unit tests | ☑ | `packages/shared/common/src/money/cents.test.ts`; scholarship service cents |

## 4. Boundaries closed

| Boundary | Change |
| -------- | ------ |
| DB | Program + disbursement BIGINT cents (source of truth) |
| Repo | `pgIntegerCents` / `pgNumericMajorToCents`; no bare `Number(bigint)` / `Math.round(*100)` |
| Service / API | `amountPerRecipientCents` on entity + responses; write reconciles via `resolveMoneyPair`; financial JSON money validated cent-representable |
| Aggregate / export | Utilization sums `amountCents` → `totalAmountCents` / `disbursedAmountCents` |
| Fee leftovers | `apps/web/src/lib/fees/actions.ts` + fee/transport forms use `majorUnitsToCents` |

## 5. Rollback

| Change | Forward fix / rollback |
| ------ | ---------------------- |
| `076` | Drop `amount_per_recipient_cents` column (or leave unused); dual-write keeps major readable |
| API `*Cents` fields | Additive; clients ignoring cents still see major |

## 6. Honest residuals

| Residual | Notes |
| -------- | ----- |
| Scholarship UI major-unit forms | Deep UI still edits/displays major (`amountPerRecipient`, `familyIncome`); server validates cent-representability. Full cents-first UI rewrite out of scope. |
| NUMERIC major columns retained | Dual-write for compat; cents is ledger/netting source of truth. |
| Admissions `fee_amount NUMERIC` | Out of scholarship scope (same as prior waiver). |

## 5. Sign-off

**Data claim:** ☑ Certified w/ waivers

**Waivers:** Scholarship deep UI remains major-unit display; admissions fee NUMERIC not in this slice.

**Status:** PARTIAL → **COMPLETE** for scholarships + in-scope fee float leftovers.
