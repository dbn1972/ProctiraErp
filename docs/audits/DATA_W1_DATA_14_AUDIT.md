# DATA — W1-DATA-14 enrollment history + grade-change audit completeness

> **Superseded for closure:** see `docs/audits/DATA_W1_DATA_14_COMPLETE.md`
> (076 harden + `proctira_app` live proofs). This file remains the #219 / 071 note.

**Module / slice:** SIS enrollment lifecycle + gradebook change audit  
**Branch / tip:** `cursor/aud-w1-data-14-audit-completeness-56c3`  
**Date (UTC):** 2026-09-14  
**Environment:** SQL contract + live Postgres proofs (when `DATABASE_URL`)

## Finding

Enrollment status changes and grade score/workflow changes relied on **application-conventional**
inserts into `enrollment_history` / `grade_change_audit`. A raw SQL update or a forgotten service
path could mutate parent rows without an audit trail. `grade_change_audit.grade_entry_id` also
lacked a required FK to `grade_entries`.

## Scope (this PR)

| Artifact | Path | Notes |
| -------- | ---- | ----- |
| Migration | `db/sql/071_enrollment_grade_audit_completeness.sql` | Triggers + append-only + FK + REVOKE |
| Static tests | `tools/tenant-isolation-tests/src/unit/enrollment-grade-audit-completeness.test.ts` | SQL contract |
| Live tests | `packages/shared/database/src/enrollment-grade-audit-completeness.live.test.ts` | Raw DML still writes audit; mutate denied; orphan FK denied |

## Invariants

1. `AFTER INSERT OR UPDATE OF status ON enrollments` always inserts `enrollment_history` (optional GUCs `app.enrollment_history_reason`, `app.enrollment_history_effective_date` enrich the row).
2. `AFTER INSERT OR UPDATE ON grade_entries` inserts `grade_change_audit` when score, letter, workflow status, lock, or publish fields change (optional GUCs `app.grade_change_action`, `app.grade_change_actor_id`).
3. `enrollment_history` and `grade_change_audit` reject UPDATE/DELETE (append-only); `proctira_app` cannot UPDATE/DELETE/TRUNCATE/TRIGGER those tables.
4. `grade_change_audit.grade_entry_id` references `grade_entries(id)` ON DELETE CASCADE (additive; VALIDATE skipped only if orphans exist).

## Non-goals / residuals (honesty)

| Residual | Status |
| -------- | ------ |
| App services may still INSERT a second enrichment audit row after the trigger | **Accepted** — completeness is guaranteed; duplicates are additive noise |
| Superuser / table-owner can disable triggers; defense relies on migrator vs `proctira_app` role split (050) | **Accepted** (same as W1-DATA-08) |
| Pre-071 orphan `grade_change_audit` rows block VALIDATE; constraint remains `NOT VALID` until cleaned | **Honest residual** |
| In-memory enrollment/gradebook stores are out of band of DB triggers | **By design** |

## Apply / verify

```bash
# apply numbered SQL including 071 (psql / tools/scripts/apply-sql.sh — not Prisma)
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/sql/071_enrollment_grade_audit_completeness.sql

# static:
pnpm --filter @proctira/tenant-isolation-tests exec vitest run --config vitest.config.ts \
  src/unit/enrollment-grade-audit-completeness.test.ts

# live (requires DATABASE_URL against migrated DB):
pnpm --filter @proctira/database exec vitest run src/enrollment-grade-audit-completeness.live.test.ts
```

## Rollback

Forward-fix only: drop triggers/functions/constraint via a follow-up migration if needed.
Do not re-grant UPDATE/DELETE on `enrollment_history` / `grade_change_audit` to `proctira_app`.

## Sign-off

**Data claim:** Certified w/ waivers (residuals above).
