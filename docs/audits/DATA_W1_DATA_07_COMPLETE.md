# DATA — W1-DATA-07 COMPLETE (append-only effective versions + payroll reverse/replace)

**Module / slice:** Academic periods, fee structures, staff payroll runs  
**Branch / tip:** `cursor/w1-data-07-dating-complete-56c3` @ `5f211d00`  
**Date (UTC):** 2026-09-14  
**Environment:** SQL contract + focused unit tests (live Postgres optional)

## Finding (PARTIAL residual)

070 added `valid_from`/`valid_to` and durable payroll artifacts, but:

1. Academic (and fee) effective windows remained **mutable via UPDATE**.
2. Monthly payroll exports used **`ON CONFLICT (tenant_id, month) DO UPDATE`**, overwriting posted money/CSV artifacts.

## Closed (COMPLETE)

| Artifact | Path | Notes |
| -------- | ---- | ----- |
| Foundation | `db/sql/070_academic_fee_effective_dating.sql` | Effective columns + payroll artifact columns (unchanged posture; points to 076) |
| Complete | `db/sql/076_w1_data_07_append_only_versions.sql` | Version columns, immutability triggers, non-overlap guards, payroll reverse/replace |
| Academic app | `packages/backend/institution/.../academic-period-service.ts` | Rejects date/code mutation; `supersede()` appends successor |
| Fees app | `packages/backend/fees/...` | `version`/`supersedesId`; `supersedeFeeStructure()` closes prior `valid_to` then INSERTs |
| Payroll store | `packages/backend/staff/src/pg-hr-ops-store.ts` | INSERT-only posted runs; `reverseAndReplacePayrollExport`; no DO UPDATE |
| Prisma | `packages/shared/database/prisma/schema.prisma` | `AcademicPeriod` `@@unique([tenantId, code, version])` + version fields |
| Tests | fees / institution / staff / tenant-isolation-tests | Overlap, supersede, reverse/replace, static SQL contract |

## Invariants

1. **Academic periods:** `start_date`/`end_date`/`valid_*`/`code`/`version` immutable after INSERT; corrections INSERT a higher `version` with non-overlapping window (prior archived).
2. **Fee structures:** `amount_cents`/`valid_from`/identity immutable; `valid_to` may only close/narrow; active windows for the same `(tenant_id, code)` must not overlap.
3. **Payroll:** posted `staff_payroll_runs` rows reject UPDATE/DELETE of money/artifacts/status; corrections INSERT `status='reversal'` then a new `status='posted'` replacement. Current export = latest unreversed posted run.

## Apply / verify

```bash
# apply numbered SQL through 076 (psql / apply-sql — not Prisma for cert path)
pnpm --filter @proctira/backend-fees exec vitest run src/fee-structure-append-only.test.ts src/fee-structure-effective-dating.test.ts
pnpm --filter @proctira/backend-institution exec vitest run src/academic-period/append-only-versions.test.ts src/academic-period/effective-dating.test.ts
pnpm --filter @proctira/backend-staff exec vitest run src/payroll-reverse-replace.test.ts src/payroll-export-store.test.ts
pnpm --filter @proctira/tenant-isolation-tests exec vitest run --config vitest.config.ts src/unit/w1-data-07-append-only.test.ts
```

## Rollback

Forward-fix only: drop 076 triggers/functions/indexes/columns via a follow-up migration if needed. Do not reintroduce `ON CONFLICT DO UPDATE` overwrite of posted payroll runs.

## Residuals (honesty)

| Residual | Status |
| -------- | ------ |
| Live Postgres negative proofs for 076 triggers not claimed in this pack (unit + static SQL contract only) | **Honest residual** |
| Academic `supersede` HTTP route not mounted in this slice (service API + DB guards) | **Accepted** — service/DB bar met |
| Prisma client regenerate required after pull for typed `version`/`supersedesId` | **Ops note** |

## Sign-off

**Data claim:** Certified w/ waivers (residuals above).  
**Status:** W1-DATA-07 **PARTIAL → COMPLETE**.
