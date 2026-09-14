# DATA — W1-DATA-11 platform-global catalog privileges (residual)

**Module / slice:** Runtime least privilege on platform-global (non-RLS) catalogs  
**Branch / tip:** `cursor/aud-w1-data-11-runtime-privs-56c3`  
**Date (UTC):** 2026-09-14  
**Environment:** static contract + optional live Postgres (`DATABASE_URL` as `proctira_app`)

## Finding

`050_app_runtime_role.sql` grants `SELECT, INSERT, UPDATE, DELETE` on **all**
`public` tables to `proctira_app`.

**Already fixed on main (#235 / `072_control_ledger_privileges.sql`):**
`schema_migrations` and `_prisma_migrations` — `REVOKE ALL` from `proctira_app`
(+ `PUBLIC`). Evidence: `docs/audits/DATA_W1_DATA_11_PRIVILEGES.md`.

**Residual (this PR):** platform-global catalogs without `tenant_id` / RLS
(`insights_ui_templates`, `insights_ui_indicators`, `insights_ui_geo_features`,
documented in 021) still had full DML, so runtime could UPDATE/DELETE shared
reference data.

## Scope (this PR)

| Artifact | Path | Notes |
| -------- | ---- | ----- |
| Migration | `db/sql/073_runtime_global_table_privileges.sql` | SELECT+INSERT only on catalogs; re-asserts ledger REVOKE |
| Docs | `db/README.md` | Extends W1-DATA-11 section for catalogs |
| Static tests | `tools/tenant-isolation-tests/src/unit/runtime-global-privs.test.ts` | 073 contract |
| Live tests | `packages/shared/database/src/runtime-global-privs.live.test.ts` | Denied UPDATE/DELETE on catalogs; ledgers still denied |
| Audit | this file | |

## Invariants

1. `proctira_app` has **no** privileges on `schema_migrations` / `_prisma_migrations`
   (072 + idempotent re-assert in 073).
2. `proctira_app` may `SELECT` and `INSERT` the three insights platform catalogs,
   but not `UPDATE` / `DELETE` / `TRUNCATE` / `TRIGGER`.
3. Cross-tenant **read** of catalog content remains (no RLS by design for platform
   reference data) — this finding is privilege **width**, not RLS coverage.
4. Apply order: `072` then `073` (LC_ALL=C); both after `050`.

## Apply / verify

```bash
bash tools/scripts/apply-sql.sh

pnpm --filter @proctira/tenant-isolation-tests exec vitest run \
  --config vitest.config.ts src/unit/runtime-global-privs.test.ts

# live (DATABASE_URL=proctira_app against DB with 072+073):
pnpm --filter @proctira/database exec vitest run src/runtime-global-privs.live.test.ts
```

## Non-goals / residuals (honesty)

| Residual | Status |
| -------- | ------ |
| Re-running 050 alone re-grants ALL DML until 072/073 re-applied | **Accepted** — same pattern as 053 |
| Catalog rows inserted by runtime cannot be deleted by runtime | **Accepted** — cleanup is migrator/ops |
| Other future non-tenant tables need an explicit follow-up REVOKE | **Residual** — 050 default privileges remain name-agnostic |
| `tenants` remains full DML under RLS | **By design** — not a platform-global catalog |

## Rollback

Forward-fix only. Do not widen catalog rights or re-grant ledger SELECT/DML
to `proctira_app`.

## Sign-off

**Data claim:** Certified w/ waivers (residuals above). Ledger half closed by #235;
this PR closes the platform-catalog residual.
