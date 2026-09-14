# DATA — W1-DATA-14 COMPLETE (enrollment / grade audit completeness)

**Module / slice:** SIS enrollment lifecycle + gradebook change audit  
**Branch / tip:** `cursor/w1-data-14-audit-complete-56c3`  
**Tip SHA:** _(filled after commit)_  
**Date (UTC):** 2026-09-14  
**Environment:** static SQL contract + live Postgres as `proctira_app` (local apply through `076`)

## Finding (REGRESSED)

Enrollment status changes and material grade changes must be **database-enforced**
audit completeness, not application-conventional inserts.

Prior merge `#219` / `071_enrollment_grade_audit_completeness.sql` shipped write
triggers, append-only guards, and `REVOKE` — but left auditor gaps that kept the
finding **REGRESSED**:

| Gap vs tip `main` (pre this PR) | Why it failed the bar |
| --- | --- |
| `grade_change_audit` FK used `ON DELETE CASCADE` | Parent delete can erase audit if append-only triggers are dropped |
| `enrollment_history` → `enrollments` still `ON DELETE CASCADE` (021) | Same erase class |
| Write functions were plain `SECURITY INVOKER` without fixed `search_path` | Search-path / privilege edge cases could skip audit inserts |
| Live suite applied SQL as migrator and only asserted append-only text | Did **not** prove `proctira_app` REVOKE / DROP TRIGGER deny |
| Evidence doc was `DATA_W1_DATA_14_AUDIT.md` only | No COMPLETE pack with tip SHA + residual honesty |

## Scope (this PR)

| Artifact | Path | Notes |
| -------- | ---- | ----- |
| Prior scaffolding (unchanged checksum) | `db/sql/071_enrollment_grade_audit_completeness.sql` | Keep; do not edit applied file |
| Harden residual | `db/sql/076_enrollment_grade_audit_harden.sql` | RESTRICT FKs, SECURITY DEFINER writers, re-assert SELECT/INSERT-only |
| Static tests | `tools/tenant-isolation-tests/src/unit/enrollment-grade-audit-completeness.test.ts` | 071 + 076 contract |
| Live tests | `packages/shared/database/src/enrollment-grade-audit-completeness.live.test.ts` | Runtime role + insert-on-change + mutate deny |
| Prior audit | `docs/audits/DATA_W1_DATA_14_AUDIT.md` | Historical #219 note |
| This COMPLETE pack | this file | Tip SHA + residuals |

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

## Apply / verify

```bash
# migrator apply (includes 071 then 076; do not edit 071)
MIGRATOR_DATABASE_URL=… bash tools/scripts/apply-sql.sh

# static
pnpm --filter @proctira/tenant-isolation-tests exec vitest run \
  --config vitest.config.ts src/unit/enrollment-grade-audit-completeness.test.ts

# live (DATABASE_URL must be proctira_app; optional MIGRATOR_DATABASE_URL re-applies 071/076)
DATABASE_URL=postgresql://proctira_app:…@…/proctira \
  pnpm --filter @proctira/database exec vitest run \
  src/enrollment-grade-audit-completeness.live.test.ts
```

### Evidence this agent run (not production)

| Check | Result |
| --- | --- |
| Static 071+076 contract | **pass** (7 tests) |
| Live as `proctira_app` (local Postgres apply through 076) | **pass** (9 tests): role, privilege matrix, DROP TRIGGER deny, insert-on-change, mutate deny, RESTRICT parent delete, orphan FK deny |
| Production / tip CI on merge commit | **Not claimed** |

## Non-goals / residuals (honesty)

| Residual | Status |
| -------- | ------ |
| App may still INSERT a second enrichment audit row after the trigger | **Accepted** — completeness guaranteed; duplicates are additive noise |
| Superuser / table-owner can disable triggers; defense relies on migrator vs `proctira_app` (050) | **Accepted** (same as W1-DATA-08) |
| Pre-existing orphan `grade_change_audit` rows leave FK `NOT VALID` until cleaned | **Honest residual** |
| In-memory enrollment/gradebook stores are out of band of DB triggers | **By design** |
| `apply-sql.sh` emit_migration_timeout_banner default (`migration-timeouts.sh:62`) breaks banner when sourced without args in some bash builds | **Out of scope** — unrelated W1-DATA-17 tooling; manual apply used for local proof |
| Re-running `050` alone re-grants broad DML until `076` re-applied | **Accepted** — same 050→narrow pattern as 053/075 |

## Rollback

Forward-fix only. Do not re-grant UPDATE/DELETE on `enrollment_history` /
`grade_change_audit` to `proctira_app`. Do not restore `ON DELETE CASCADE` on
audit FKs.

## Sign-off

**Data claim:** Certified w/ waivers (residuals above).  
**Not claimed:** production evidence; tip CI green on merge commit until CI runs.
