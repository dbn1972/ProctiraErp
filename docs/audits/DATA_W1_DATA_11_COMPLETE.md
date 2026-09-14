# DATA — W1-DATA-11 COMPLETE (classified runtime privileges)

**Module / slice:** Runtime DB role privilege classification (PARTIAL → COMPLETE)  
**Branch / tip:** `cursor/w1-data-11-privs-complete-56c3`  
**Date (UTC):** 2026-09-14  
**Environment:** static catalog gate + apply-sql sync (+ optional live Postgres as `proctira_app`)

## Finding (residual after #235 / #238)

`050_app_runtime_role.sql` granted `SELECT, INSERT, UPDATE, DELETE` on **all**
current public tables and installed `ALTER DEFAULT PRIVILEGES … ON TABLES` so
**every future** public table also inherited full runtime DML. Migrations
`072` / `075` only `REVOKE`d a hard-coded list (ledgers + three insights
catalogs). Any new migrator-only or platform-global table silently regained
full DML until another hand-written REVOKE shipped.

## Done when (this PR)

| Criterion | Evidence |
| --------- | -------- |
| Runtime grants explicitly classified per table | `db/runtime-table-privileges.json` (denied / select_insert / append_only / dml) |
| Blanket TABLE DEFAULT PRIVILEGES removed | `050` no longer grants TABLE defaults; `076` + sync `REVOKE` defaults |
| Catalog gate rejects unauthorized current or future privilege | `pnpm check:runtime-table-privileges` + CI job `runtime-table-privileges` |

## Scope

| Artifact | Path | Notes |
| -------- | ---- | ----- |
| Catalog | `db/runtime-table-privileges.json` | Source of truth — every public table |
| Migration | `db/sql/084_runtime_privilege_classification.sql` | Revoke defaults + classified grants |
| Role split | `db/sql/050_app_runtime_role.sql` | Drop TABLE DEFAULT PRIVILEGES; keep sequence defaults |
| Apply hook | `tools/scripts/apply-runtime-table-privileges.sh` | Re-sync after every `apply-sql.sh` |
| CI gate | `tools/scripts/check-runtime-table-privileges.mjs` | Unclassified CREATE TABLE → fail |
| Aggregate | `tools/scripts/ci-aggregate-gate.mjs` + `ci.yml` | Required always-on job |
| Prior halves | `072` / `075` | Unchanged; superseded for posture by 076+sync |
| Audit | this file | |

### Privilege classes

| Class | Privileges | Examples |
| ----- | ---------- | -------- |
| `denied` | none | `schema_migrations`, `_prisma_migrations` |
| `select_insert` | SELECT, INSERT | `insights_ui_templates`, `insights_ui_indicators`, `insights_ui_geo_features` |
| `append_only` | SELECT, INSERT | fee/audit/transcript/enrollment/grade ledgers (053/069/071) |
| `dml` | SELECT, INSERT, UPDATE, DELETE | Normal tenant/domain tables under RLS |

## Invariants

1. No `ALTER DEFAULT PRIVILEGES … GRANT … ON TABLES TO proctira_app` in tip `050`.
2. Every `CREATE TABLE` in `db/sql/` + Prisma migrations is listed in the catalog
   (ledgers always required even if created outside numbered SQL).
3. `apply-sql.sh` always ends with privilege sync (strip all → grant by class).
4. Unclassified future tables fail CI before merge; even if applied locally without
   the gate, sync REVOKEs ALL and grants nothing until classified.
5. Sequence `USAGE, SELECT` defaults remain (IDENTITY/serial INSERT); table DML never defaults.

## Apply / verify

```bash
bash tools/scripts/apply-sql.sh   # includes privilege sync

pnpm check:runtime-table-privileges
pnpm check:runtime-table-privileges:test

pnpm --filter @proctira/tenant-isolation-tests exec vitest run \
  --config vitest.config.ts src/unit/runtime-global-privs.test.ts

# live (DATABASE_URL=proctira_app after apply through 076 + sync):
pnpm --filter @proctira/database exec vitest run src/runtime-global-privs.live.test.ts
```

## Prior status

| PR | Scope | Status |
| -- | ----- | ------ |
| #235 / `072` | Control ledger REVOKE | Closed (half) |
| #238 / `075` | Platform catalog narrow | Closed (residual half) |
| This PR / `076` | Classification + gate | **COMPLETE** |

## Non-goals / residuals (honesty)

| Residual | Status |
| -------- | ------ |
| Editing `050` changes sha256; existing ledgers fail-closed until checksum adopt / re-bootstrap | Documented — fresh CI OK; ops re-adopt NULL/mismatch per W1-DATA-05 |
| `050` still `GRANT … ON ALL TABLES` for bootstrap until sync runs later in the same apply | Accepted — sync is authoritative |
| Superuser can re-grant outside the catalog | Accepted — defense is role split + CI gate |

## Rollback

Forward-fix only. Do not restore TABLE `DEFAULT PRIVILEGES` for `proctira_app`.
To widen a table's class, edit `db/runtime-table-privileges.json` and re-run
`apply-sql.sh` (or `apply-runtime-table-privileges.sh`).

## Sign-off

**Data claim:** Certified — W1-DATA-11 PARTIAL→COMPLETE.
