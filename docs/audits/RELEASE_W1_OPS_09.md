# Enterprise release / ops checklist — W1-OPS-09

**Slice / PR:** W1-OPS-09 COMPLETE (atomic rollback + single-wave)  
**Branch:** `cursor/w1-ops-09-rollback-complete-56c3`  
**Tip SHA:** `34fa25227f7ff8ceb053ef872d7f23f8a81537a2`  
**Base branch:** `main`  
**Date (UTC):** 2026-09-14

Copy of `docs/audits/templates/ENTERPRISE_RELEASE_OPS_CHECKLIST.md`.

---

## 1. Pre-merge

| Check | Pass | Evidence |
| ----- | ---- | -------- |
| Tip CI all required checks SUCCESS on **this** SHA | ☐ | Parent/merge gate — not claimed here |
| Migrations listed + apply order | ☑ N/A | Docs / workflow / chart only |
| External providers: sandbox honesty or live secrets | ☑ | Rollback apply needs Environment `KUBECONFIG`; dry-run needs none |
| Feature flags / kill switches (if any) | ☑ | `progressiveDelivery.canary.enabled` default false |
| Deploy path understood (or N/A docs-only) | ☑ | Single-wave Helm via `deploy.yml` + `rollback.yml` |
| No secrets / large binary dumps in commit | ☑ | |
| Scoreboard / audits updated | ☑ | `OPS_W1_OPS_09_COMPLETE.md` |

## 2. Merge

| Action | Done |
| ------ | ---- |
| PR ready (not stale draft) | ☐ parent |
| Merge strategy noted (squash/rebase) | ☐ parent |
| Main tip CI watched after merge | ☐ parent |

## 3. Rollback

| Scenario | Plan / owner |
| -------- | ------------ |
| App regression | `rollback.yml` or runbook `docs/runbooks/deploy-rollback.md` (platform/SRE) |
| Bad migration | `docs/runbooks/database-migration-rollback.md` — not image-only |
| Provider outage | Kill switch / sandbox — not Helm rollback |

## 4. Sign-off

**Ship claim:** ☐ Ready · ☑ Ready w/ waivers · ☐ Not ready

**Waivers:** No live cluster rollback or production canary exercise on this tip;
single-wave + dry-run automation closes the finding for the supported deploy mode.
