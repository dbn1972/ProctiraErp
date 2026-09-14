# DATA — W1-DATA-11 global control ledger privileges

**Module / slice:** Runtime DB role privileges on migrator control tables  
**Branch / tip:** `cursor/aud-w1-data-11-privileges-56c3`  
**Date (UTC):** 2026-09-14  
**Environment:** static contract + optional live Postgres (`DATABASE_URL` = `proctira_app`)

## Finding

Global control tables — especially `schema_migrations` and `_prisma_migrations` —
inherited **full runtime DML/SELECT** from `050_app_runtime_role.sql`
(`GRANT … ON ALL TABLES IN SCHEMA public TO proctira_app`). Application
connections could therefore read and rewrite migration history.

## Scope (this PR)

| Artifact | Path | Notes |
| -------- | ---- | ----- |
| Migration | `db/sql/072_control_ledger_privileges.sql` | `REVOKE ALL` on control ledgers from `proctira_app` + `PUBLIC` |
| Bootstrap docs | `db/bootstrap/README.md` | Role privilege matrix for ledgers |
| Operator docs | `db/README.md` | W1-DATA-11 section |
| Static tests | `tools/tenant-isolation-tests/src/unit/control-ledger-privileges.test.ts` | SQL + docs contract |
| Live tests | `packages/shared/database/src/control-ledger-privileges.live.test.ts` | Catalog + denied SELECT/INSERT |
| Audit | this file | Checklist evidence |

## Invariants

1. `proctira_app` has **no** table privileges on `schema_migrations` or `_prisma_migrations` (when present).
2. Migrator/`proctira` (table owner via `MIGRATOR_DATABASE_URL`) retains ledger writes for `apply-sql.sh` and Prisma.
3. Domain DML grants from `050` remain for tenant tables; `053`/`069` immutability narrowing is unchanged.
4. New migrator-only tables require an additive `REVOKE` (default privileges from `050` still grant DML by name-agnostic rule).

## Apply / verify

```bash
# apply numbered SQL including 072 (psql / apply-sql.sh as migrator — not Prisma for this file)
bash tools/scripts/apply-sql.sh

# static
pnpm --filter @proctira/tenant-isolation-tests exec vitest run \
  --config vitest.config.ts src/unit/control-ledger-privileges.test.ts

# live (DATABASE_URL must be proctira_app against a DB that applied 072)
pnpm --filter @proctira/database exec vitest run src/control-ledger-privileges.live.test.ts

# spot-check
psql "$DATABASE_URL" -c \
  "SELECT has_table_privilege('proctira_app','schema_migrations','SELECT');"
# expect f
```

## Non-goals / residuals (honesty)

| Residual | Status |
| -------- | ------ |
| `050` still uses `GRANT … ON ALL TABLES` + default privileges; 072 is a post-grant narrow | **Accepted** — same pattern as 053; changing 050 would churn older installs |
| If `_prisma_migrations` is created *after* 072, re-apply 072 (or a follow-up REVOKE) | **Honest residual** — normal order is Prisma → `apply-sql.sh` |
| Fees `ensureFeesSchema` still attempts `CREATE TABLE schema_migrations` under runtime URL | **Out of scope / residual** — fails closed without schema `CREATE`; production must use migrator apply |
| Superuser can still grant privileges back | **Accepted** — defense relies on role split + no app CONNECT as migrator |
| Other non-tenant domain tables (e.g. `tenants`, insights UI) remain runtime-accessible under RLS | **By design** — not migration ledgers |

## Rollback

Forward-fix only: do not re-grant `SELECT`/`INSERT`/`UPDATE`/`DELETE` on
`schema_migrations` or `_prisma_migrations` to `proctira_app`. If a temporary
break-glass read is required, use the migrator role, not the app runtime URL.

## Sign-off

**Data claim:** Certified w/ waivers (residuals above).
