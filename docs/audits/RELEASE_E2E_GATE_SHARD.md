# Enterprise release / ops checklist

**Slice / PR:** E2E backend-ready live gate sharding (G-401 / G-706)
**Branch / tip SHA:** `cursor/e2e-gate-timeout-13e1` (tip recorded at authoring; merge proof is the PR check run, not this file)
**Base branch:** `main`
**Date (UTC):** 2026-09-27

Copy of `docs/audits/templates/ENTERPRISE_RELEASE_OPS_CHECKLIST.md`.

---

## 1. Pre-merge

| Check                                               | Pass | Evidence                                                                                                                                                                                                   |
| --------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tip CI all required checks SUCCESS on **this** SHA  | ☐    | Not claimed here. Merge only after `CI Aggregate (Required)` and `E2E backend-ready live gate (G-401 / G-706)` are SUCCESS on the same tip.                                                                |
| Migrations listed + apply order                     | ☑    | No schema change. The gate still runs Prisma migrate deploy, then `tools/scripts/apply-sql.sh` (`APPLY_STRICT_FKS=1`, `APPLY_SEEDS=1`), then the multi-board onboard script, on each shard's own Postgres. |
| External providers: sandbox honesty or live secrets | ☑    | Unchanged. HS256 cookies (`JWT_SECRET`), local Postgres and Redis. No live IdP.                                                                                                                            |
| Feature flags / kill switches (if any)              | ☑    | None. `PLAYWRIGHT_SHARD` is set only by the shard jobs.                                                                                                                                                    |
| Deploy path understood (or N/A docs-only)           | ☑    | Workflow-only. No image deploy.                                                                                                                                                                            |
| No secrets / large binary dumps in commit           | ☑    | Workflow, harness, Playwright reporter config, docs.                                                                                                                                                       |
| Scoreboard / audits updated                         | ☑    | This note. No product score claim.                                                                                                                                                                         |

## 2. Merge

| Action                               | Done                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------- |
| PR ready (not stale draft)           | ☐                                                                      |
| Merge strategy noted (squash/rebase) | ☐ Squash, only when both required checks above are SUCCESS on the tip. |
| Main tip CI watched after merge      | ☐                                                                      |

## 3. Rollback

| Scenario        | Plan / owner                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| App regression  | Revert the squash commit. The previous single job is the workflow on `main` before this change. No data migration to reverse. |
| Bad migration   | N/A — no migration in this slice.                                                                                             |
| Provider outage | N/A — no provider change. Gate still fails closed if the gateway does not become healthy.                                     |

## 4. Sign-off

**Ship claim:** ☐ Ready · ☐ Ready w/ waivers · ☑ Not ready (until tip checks succeed)

**False-claim ban:** ☑ Tip SHA + Done-when cited — no Wave‑N / N/N COMPLETE claim from docs-only or stale ledger

**Waivers:** Branch protection contents were not readable with this token (HTTP 403). The required check string is preserved on the non-matrix aggregator. `CI Aggregate` in `ci.yml` does not `needs` this workflow.

**Why four shards:** Run [36284769618](https://github.com/dbn1972/ProctiraErp/actions/runs/36284769618) took 42.7 minutes. Run [36305756098](https://github.com/dbn1972/ProctiraErp/actions/runs/36305756098) was cancelled at 45 minutes during `e2e/a11y-axe.spec.ts` before `44-students-360-write-smoke.spec.ts`. Setup before the harness on that run was about two minutes; the harness itself was the ~43 minutes. Each shard keeps `timeout-minutes: 45` so retries (`retries: 2` in CI, 90s test timeout) still have room. Specs are not removed or skipped.
