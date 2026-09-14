# Enterprise release / ops — W1-OPS-17 replicas

**Slice / PR:** W1-OPS-17 production replica / PDB coherence  
**Branch / tip SHA:** `cursor/aud-w1-ops-17-replicas-56c3` (see tip after push)  
**Base branch:** `main`  
**Date (UTC):** 2026-09-14

## 1. Pre-merge

| Check | Pass | Evidence |
| --- | --- | --- |
| Tip CI all required checks SUCCESS on **this** SHA | ☐ | Path-filtered `Helm Template` after push |
| Migrations listed + apply order | ☑ N/A | No schema changes |
| External providers: sandbox honesty or live secrets | ☑ N/A | Manifest / values only |
| Feature flags / kill switches (if any) | ☑ N/A | |
| Deploy path understood (or N/A docs-only) | ☑ | Helm thin chart + platform + kustomize overlays |
| No secrets / large binary dumps in commit | ☑ | |
| Scoreboard / audits updated | ☑ | `docs/audits/OPS_W1_OPS_17_REPLICAS.md` |

## 2. Merge

| Action | Done |
| --- | --- |
| PR ready (not stale draft) | ☐ |
| Merge strategy noted (squash/rebase) | ☐ |
| Main tip CI watched after merge | ☐ |

## 3. Rollback

| Scenario | Plan / owner |
| --- | --- |
| App regression | Revert tip commit; restore prior replica patches |
| Bad migration | N/A |
| Provider outage | N/A |

## 4. Sign-off

**Ship claim:** ☐ Ready · ☐ Ready w/ waivers · ☑ Not ready (await tip CI)

**Waivers:** none
