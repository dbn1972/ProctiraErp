# OPS — W1-OPS-05 CI path filters (COMPLETE)

**Module / slice:** CI path filtering — no silent skip for db/sql, tools, docs, infra  
**Branch / tip:** `cursor/w1-ops-05-paths-complete-56c3` @ `603519fc5e8cf835ed6d4883dc750078c6a9a791` (docs stamp; implementation `b91fb37a510c7cb0bb06089506a7bf5ed9c9f170`)  
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

---

## Re-audit regression fix (2026-09-14) — duplicate `runtime-role-gate`

Pinned `origin/main` @ `29fcc1be` redefined / reconfirmed **W1-OPS-05 REGRESSED**:
`.github/workflows/ci.yml` defined sibling job key `runtime-role-gate` twice
(privilege-catalog body + real role-gate body). YAML mapping uniqueness made the
required aggregate graph untrustworthy.

| Fix | Path |
| --- | ---- |
| Remove duplicate job (keep `runtime-table-privileges` + single role gate) | `.github/workflows/ci.yml` |
| Fail closed on any duplicate job keys | `tools/scripts/check-ci-path-filters.mjs` |
| Fail closed if `runtime-role-gate:` appears more than once | `tools/scripts/check-runtime-role-gate.mjs` |

```bash
node --test tools/scripts/check-ci-path-filters.test.mjs tools/scripts/check-runtime-role-gate.test.mjs
node tools/scripts/check-ci-path-filters.mjs
# Pre-fix tip content must fail:
# findDuplicateWorkflowJobKeys(origin/main ci.yml) → runtime-role-gate ×2
```
