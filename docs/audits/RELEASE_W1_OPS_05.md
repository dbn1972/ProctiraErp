# Release ops — W1-OPS-05 path filters COMPLETE

**Slice / PR:** W1-OPS-05 CI path filters  
**Branch / tip SHA:** `cursor/w1-ops-05-paths-complete-56c3` @ `603519fc5e8cf835ed6d4883dc750078c6a9a791` (docs stamp; implementation `b91fb37a510c7cb0bb06089506a7bf5ed9c9f170`)  
**Base branch:** `main`  
**Date (UTC):** 2026-09-14

## 1. Pre-merge

| Check | Pass | Evidence |
| --- | --- | --- |
| Tip CI all required checks SUCCESS on **this** SHA | ☐ | Pending PR tip run |
| Migrations listed + apply order | ☑ N/A | No schema change |
| External providers: sandbox honesty or live secrets | ☑ N/A | CI-only |
| Feature flags / kill switches (if any) | ☑ N/A | |
| Deploy path understood (or N/A docs-only) | ☑ | Docs + CI workflow only; no image deploy |
| No secrets / large binary dumps in commit | ☑ | |
| Scoreboard / audits updated | ☑ | `docs/audits/OPS_W1_OPS_05_COMPLETE.md` |

## 2. Merge

| Action | Done |
| --- | --- |
| PR ready (not stale draft) | ☐ |
| Merge strategy noted (squash/rebase) | ☐ squash expected |
| Main tip CI watched after merge | ☐ |

## 3. Rollback

| Scenario | Plan / owner |
| --- | --- |
| App regression | N/A (CI/docs) |
| Bad migration | N/A |
| Aggregate false fail | Revert tip; restore prior `ci-aggregate-gate.mjs` / `ci.yml` |

## 4. Sign-off

**Ship claim:** ☐ Ready · ☑ Ready w/ waivers (tip CI pending) · ☐ Not ready

**Waivers:** Tip CI SUCCESS not claimed until required checks complete on this SHA.
