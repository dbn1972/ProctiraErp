# DATA — W1-DATA-06 COMPLETE (strict tenant FKs)

**Module / slice:** `tenant_id → tenants(id)` create + VALIDATE + repair  
**Branch / tip:** `cursor/w1-data-06-fk-complete-56c3`  
**Date (UTC):** 2026-09-14  
**Environment:** static gate + CI live Postgres catalog after `apply-sql.sh`

## Finding (PARTIAL residual)

PR #201 shipped CREATE (`021b`) + VALIDATE (`068`) and a static CI workflow
gate, but three residuals remained:

1. **`APPLY_STRICT_FKS` defaulted OFF** — production/CI had to remember the flag.
2. **`068` could be ledger-recorded as a no-op** when `021b` was skipped
   (VALIDATE loop found nothing; `schema_migrations` still recorded the file).
3. **Later validation was skippable** — enabling strict FKs after a no-op `068`
   applied `021b` (NOT VALID) but skipped `068` (checksum match), leaving
   unvalidated FKs forever.

## Scope (this PR)

| Artifact | Path | Notes |
| -------- | ---- | ----- |
| Default ON | `tools/scripts/apply-sql.sh` | Unset → `1` when `CI=true` or `NODE_ENV=production`; explicit `0` opts out |
| Gated VALIDATE | `apply-sql.sh` `is_strict_fk_file` | `068` + `076` gated with `021a`/`021b` (no silent no-op ledger) |
| Repair | `db/sql/082_repair_strict_tenant_fk_validate.sql` | Create missing FKs, VALIDATE, `RAISE EXCEPTION` on leftovers |
| Static + live gate | `tools/scripts/check-strict-tenant-fks.mjs` | Workflow posture + `--live --require-live` catalog proof |
| CI | `.github/workflows/ci.yml`, `restore-drill.yml` | Live catalog step after `APPLY_STRICT_FKS=1` apply |
| Onboard | `tools/scripts/setup-live-db-and-onboard.sh` | Same live proof |
| Docs | `db/README.md`, runbook, this audit | Operator-facing COMPLETE claim |

## Invariants

1. Production / CI create + VALIDATE + repair unless explicitly opted out.
2. `068` / `076` are never applied (or ledger-recorded) when create is skipped.
3. Prior no-op `068` installs are repaired by `076` on the next strict apply.
4. Live `pg_catalog` proof: **zero** `tenant_id → tenants(id)` FKs with
   `convalidated = false`, and no uuid `tenant_id` base table missing such an FK.

## Apply / verify

```bash
# Fresh / prod path (default ON under CI=true or NODE_ENV=production)
APPLY_STRICT_FKS=1 APPLY_SEEDS=1 \
  MIGRATOR_DATABASE_URL=postgresql://… \
  bash tools/scripts/apply-sql.sh

# Static posture
pnpm check:strict-tenant-fks
pnpm check:strict-tenant-fks:test

# Live catalog (after apply)
MIGRATOR_DATABASE_URL=postgresql://… \
  pnpm check:strict-tenant-fks -- --live --require-live
```

## Residuals (honesty)

| Residual | Status |
| -------- | ------ |
| Local unit fixtures may set `APPLY_STRICT_FKS=0` for ad-hoc tenant UUIDs | **Accepted** — production default remains ON |
| Migrator VALIDATE under FORCE RLS may be visibility-scoped | **Accepted** — same class as W1-DATA-15 / 072; NOT VALID still blocks new dangling writes; full-scan VALIDATE needs BYPASSRLS/superuser |
| Historical orphan `tenant_id` rows block VALIDATE until cleaned | **Operator** — repair fails closed until repaired |
| Editing `068` content was avoided (checksum ledger); repair is forward `076` | **By design** — W1-DATA-05 fail-closed |

## Rollback

Forward-fix: `ALTER TABLE … DROP CONSTRAINT <table>_tenant_fk` per table.
Do not delete `schema_migrations` rows for `068`/`076` to “undo”.

## Sign-off

**Data claim:** Certified w/ waivers (residuals above).  
**Status:** PARTIAL → **COMPLETE**.
