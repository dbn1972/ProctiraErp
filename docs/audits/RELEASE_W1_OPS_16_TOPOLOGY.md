# Enterprise release / ops — W1-OPS-16 topology

**Slice / PR:** W1-OPS-16 canonical in-process gateway topology  
**Branch / tip SHA:** `cursor/aud-w1-ops-16-topology-56c3` (see git tip)  
**Base branch:** `main`  
**Date (UTC):** 2026-09-14

## 1. Pre-merge

| Check                                               | Pass | Evidence |
| --------------------------------------------------- | ---- | -------- |
| Tip CI all required checks SUCCESS on **this** SHA  | ☐    | Pending after push |
| Migrations listed + apply order                     | ✅   | N/A — docs/Helm/k8s/compose/deploy only |
| External providers: sandbox honesty or live secrets | ✅   | N/A |
| Feature flags / kill switches (if any)              | ✅   | `topology.mode` + `*Service.enabled` |
| Deploy path understood (or N/A docs-only)           | ✅   | Canonical = `proctira-service` / in-process gateway; split = lab |
| No secrets / large binary dumps in commit           | ✅   | |
| Scoreboard / audits updated                         | ✅   | `OPS_W1_OPS_16_TOPOLOGY.md` |

## 2. Merge

| Action                               | Done |
| ------------------------------------ | ---- |
| PR ready (not stale draft)           | ☐    |
| Merge strategy noted (squash/rebase) | squash |
| Main tip CI watched after merge      | ☐    |

## 3. Rollback

| Scenario        | Plan / owner |
| --------------- | ------------ |
| App regression  | Revert commit; re-enable split only via lab overlay / explicit Helm flags |
| Bad migration   | N/A |
| Provider outage | N/A |

## 4. Sign-off

**Ship claim:** ☐ Ready · ☐ Ready w/ waivers · ☐ Not ready

**Waivers:** Tip CI not yet observed on this branch tip.
