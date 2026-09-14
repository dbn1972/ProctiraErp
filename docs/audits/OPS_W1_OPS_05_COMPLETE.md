# OPS — W1-OPS-05 CI path filters (COMPLETE)

**Module / slice:** CI path filtering — no silent skip for db/sql, tools, docs, infra  
**Branch / tip:** `cursor/w1-ops-05-paths-complete-56c3` @ `44d3f3d22183ef27b5d9dd946f094e6e24ad5187`  
**Date (UTC):** 2026-09-14  
**Base:** fresh `origin/main`  
**Prior PARTIAL:** `#98` (aggregate), `#181` (db/tools/docs filters), `#195` (infra residual)

## Finding (PARTIAL → COMPLETE)

Path filters previously allowed `db/**`, `tools/**`, `docs/**`, and infrastructure-only
changes to skip applicable validation (SQL apply/gates, tool tests, integration /
tenant-isolation). Aggregate coverage was also corrupted on main when later always-on
gates (`codeowners`, `runtime-table-privileges`, `runtime-role-gate`) were merged into a
single object / job body — fail-closed skips for those jobs stopped evaluating, and the
aggregate unit suite no longer parsed.

## Scope (this PR)

| Artifact | Path | Notes |
| -------- | ---- | ----- |
| Path filters | `.github/workflows/ci.yml` `detect-changes` | `db/**`/`tools/**`/`docs/**` → shared (+ backend where needed); infra → job ifs |
| Split always-on jobs | `runtime-table-privileges` + `runtime-role-gate` | Restore separate CI jobs after merge damage |
| Aggregate | `tools/scripts/ci-aggregate-gate.mjs` | Separate always-on gate entries; infra/shared require code chain |
| Matrix gate | `tools/scripts/check-ci-path-filters.mjs` (+ `.test.mjs`) | Fail closed if filters/job ifs regress |
| Aggregate tests | `tools/scripts/ci-aggregate-gate.test.mjs` | Syntax fix + docs/shared + infra proofs |
| Docs | `.github/README.md`, this audit | Documented matrix |

## Path → validation matrix

| Changed path | dorny buckets | Jobs that must run (or always-on) |
| --- | --- | --- |
| `db/**` (incl. `db/sql`) | `backend`, `shared` | lint→unit→build→dod→tenant-isolation; **integration** (Prisma migrate + `apply-sql.sh` + live FK/SQL proofs); always-on SQL gates |
| `tools/**` | `shared` (+ explicit backend globs for scripts/dod/tenant-isolation) | code chain; tool scripts covered by turbo/always-on gates |
| `docs/**` | `shared` | code chain — **not** a proven skip |
| `infrastructure/**`, `Dockerfile*`, `docker-compose*.yml` | `infra` | code chain + **integration**; aggregate treats infra like code for skip proof |

Always-on (skip never proven): `restore-drill-evidence`, `prisma-sql-drift`, `strict-tenant-fks`, `tenant-id-indexes`, `migration-timeouts`, `codeowners-gate`, `runtime-table-privileges`, `runtime-role-gate`.

## Evidence

```bash
node --test tools/scripts/check-ci-path-filters.test.mjs tools/scripts/ci-aggregate-gate.test.mjs
node tools/scripts/check-ci-path-filters.mjs
```

`ci-aggregate` runs the same matrix + aggregate unit suite before evaluating job results.

## Non-goals / residuals (honesty)

| Residual | Status |
| -------- | ------ |
| Standalone `definition-of-done.yml` path list still omits pure `db/**` / `docs/**` / infra | **Accepted** — main CI DoD job is triggered via shared/infra filters |
| Helm Template / restore-drill / mobile workflows keep their own path lists | **Out of scope** — covered by W1-OPS-21 / OPS-12 / mobile items |
| Tip CI green on this SHA | Proven only after required checks succeed on the tip commit |
| Turbo `--filter` still selects packages by merge-base; empty turbo graph can no-op package tasks while job still runs | **Accepted** — job presence is fail-closed; W1-OPS-22 owns merge-base selection |

## Rollback

Reverting this tip re-opens silent skips for docs/db/tools/infra and re-collapses
always-on aggregate entries. Do not drop matrix globs from `detect-changes` without
updating `check-ci-path-filters.mjs`.

## Sign-off

**Ops claim:** Path filters + aggregate fail-closed for db/sql, tools, docs, infra.  
**Status:** W1-OPS-05 **COMPLETE** (PARTIAL cleared).
