# DATA — W1-DATA-14 COMPLETE (enrollment / grade audit completeness)

**Module / slice:** SIS enrollment lifecycle + gradebook change audit  
**Branch / tip:** `cursor/w1-data-14-single-audit-writer-56c3`  
**Date (UTC):** 2026-09-14  
**Environment:** static SQL contract + app single-writer regression fix

## Finding (REGRESSED → CLOSED)

Enrollment status changes and material grade changes must be **database-enforced**
audit completeness, not application-conventional inserts.

Prior work (`071` / `080`) shipped write triggers, append-only guards, and
`REVOKE` — but the application still called `createHistoryEntry` /
`extras.appendAudit` on the Postgres path, producing **duplicate** audit rows
(trigger + app INSERT).

## Scope (this PR — single audit writer)

| Artifact | Path | Notes |
| -------- | ---- | ----- |
| Harden SQL (unchanged checksum) | `db/sql/080_enrollment_grade_audit_harden.sql` | Prefer triggers; do not rewrite |
| Prior scaffolding | `db/sql/071_enrollment_grade_audit_completeness.sql` | Keep; do not edit |
| Enrollment PG repo | `packages/backend/student/src/enrollment/pg-enrollment-repository.ts` | Sets GUCs then mutates; `createHistoryEntry` no-op |
| Enrollment service | `packages/backend/student/src/enrollment/enrollment-service.ts` | Skips app history when `writesHistoryViaDatabase` |
| Gradebook PG repo + extras | `pg-gradebook-repository.ts`, `extras-store.ts` | GUCs on mutate; `appendAudit` no-op on PG |
| Gradebook service | `gradebook-service.ts` | Skips `persistGradeChange` when DB writes audit |
| Unit proofs | `pg-enrollment-single-audit-writer.test.ts`, `pg-gradebook-single-audit-writer.test.ts` | GUC + zero history/audit INSERTs |
| This COMPLETE pack | this file | Regression closure |

## Invariants

1. `AFTER INSERT OR UPDATE OF status ON enrollments` always inserts `enrollment_history`
   (optional GUCs `app.enrollment_history_reason`, `app.enrollment_history_effective_date`).
2. `AFTER INSERT OR UPDATE ON grade_entries` inserts `grade_change_audit` on material
   score / letter / workflow / lock / publish changes (optional GUCs
   `app.grade_change_action`, `app.grade_change_actor_id`).
3. Write functions are `SECURITY DEFINER` with `SET search_path = public`.
4. `enrollment_history` and `grade_change_audit` reject UPDATE/DELETE (append-only);
   `proctira_app` is **SELECT + INSERT only** (no UPDATE/DELETE/TRUNCATE/TRIGGER).
5. Parent FKs are `ON DELETE RESTRICT` so audit trails are not CASCADE-erased.
6. Runtime cannot `DROP` the completeness / append-only triggers (non-owner).
7. **Single writer (app):** On Postgres, the application does **not** INSERT a second
   enrichment row. `PgEnrollmentRepository.writesHistoryViaDatabase` /
   `PgGradebookRepository.writesAuditViaDatabase` are true; services skip app
   inserts and pass actor/reason via transaction-local GUCs in the same txn as
   the mutate. In-memory repositories keep writing history/audit in-app.

## Apply / verify

```bash
# migrator apply (includes 071 then 080; do not edit 071/080)
MIGRATOR_DATABASE_URL=… bash tools/scripts/apply-sql.sh

# static SQL contract
pnpm --filter @proctira/tenant-isolation-tests exec vitest run \
  --config vitest.config.ts src/unit/enrollment-grade-audit-completeness.test.ts

# live (DATABASE_URL must be proctira_app)
DATABASE_URL=postgresql://proctira_app:…@…/proctira \
  pnpm --filter @proctira/database exec vitest run \
  src/enrollment-grade-audit-completeness.live.test.ts

# app single-writer unit proofs
pnpm --filter @proctira/backend-student exec vitest run \
  src/enrollment/pg-enrollment-single-audit-writer.test.ts \
  src/enrollment/enrollment-service.test.ts
pnpm --filter @proctira/backend-gradebook exec vitest run \
  src/pg-gradebook-single-audit-writer.test.ts \
  src/gradebook-service.test.ts
```

### Evidence this agent run (not production)

| Check | Result |
| --- | --- |
| `@proctira/backend-student` enrollment single-writer + service + property | **pass** (42 tests) |
| `@proctira/backend-gradebook` single-writer + service | **pass** (14 tests) |
| Production / tip CI on merge commit | **Not claimed** |

## Non-goals / residuals (honesty)

| Residual | Status |
| -------- | ------ |
| App duplicate INSERT on PG path | **CLOSED** — service skips; PG `createHistoryEntry` / `appendAudit` no-op |
| Superuser / table-owner can disable triggers; defense relies on migrator vs `proctira_app` (050) | **Accepted** (same as W1-DATA-08) |
| Pre-existing orphan `grade_change_audit` rows leave FK `NOT VALID` until cleaned | **Honest residual** |
| In-memory enrollment/gradebook stores are out of band of DB triggers | **By design** — still write history/audit in-app |
| Re-running `050` alone re-grants broad DML until `080` re-applied | **Accepted** — same 050→narrow pattern as 053/075 |

## Rollback

Forward-fix only. Do not re-grant UPDATE/DELETE on `enrollment_history` /
`grade_change_audit` to `proctira_app`. Do not restore `ON DELETE CASCADE` on
audit FKs. Do not re-enable app-side INSERT on the PG path without removing
trigger writers.

## Sign-off

**Data claim:** Certified w/ waivers (residuals above); single-writer regression closed in app.  
**Not claimed:** production evidence; tip CI green on merge commit until CI runs.
